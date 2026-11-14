const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const UnsubscribedEmail = require('../models/UnsubscribedEmail');
const TopUpRequest = require('../models/TopUpRequest');
const CryptoWithdrawalRequest = require('../models/CryptoWithdrawalRequest');
const PaymentWalletSettings = require('../models/PaymentWalletSettings');
const cryptoAssets = require('../utils/crypto-assets');
const { paymentWallets, defaultPaymentWalletAddresses } = require('../utils/payment-wallets');
const { createPaymentQr } = require('../utils/payment-qr');
const { isValidWalletAddress } = require('../assets/js/crypto-address-validation');
const { normalizeAmount, parseAmount } = require('../utils/amounts');
const {
  validateSmtpConfig,
  validateSiteUrl,
  sendWelcomeEmail,
  sendPasswordResetEmail
} = require('../utils/email');
const { ensureAuthenticated, ensureAdmin, forwardAuthenticated } = require('../config/auth');

const v1AccountCutoff = new Date('2026-10-18T00:00:00.000Z');

const publicPaths = [
  '/',
  '/about',
  '/wallet',
  '/card',
  '/term-and-condition',
  '/privacy-policy',
  '/refund-policy'
];

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

router.use((req, res, next) => {
  if (publicPaths.includes(req.path) || req.path === '/llms.txt') {
    res.removeHeader('X-Robots-Tag');
  }
  next();
});

function getPaymentWalletSettings() {
  return PaymentWalletSettings.findById('primary')
    .lean()
    .exec()
    .then(settings => ({
      ...defaultPaymentWalletAddresses,
      ...(settings && settings.addresses)
    }));
}

function renderPaymentPage(req, res, next, view, walletKey) {
  return getPaymentWalletSettings()
    .then(async paymentWalletAddresses => {
      const paymentWalletQr = await createPaymentQr(paymentWalletAddresses[walletKey]);
      return res.render(view, {
        user: req.user,
        paymentWalletAddresses,
        paymentWalletQr
      });
    })
    .catch(next);
}

function isValidCsrfToken(suppliedToken, storedToken) {
  return (
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken))
  );
}

function getRequestLocale(req) {
  const languages = (req.get('Accept-Language') || '')
    .split(',')
    .map(language => language.split(';')[0].trim())
    .filter(Boolean);

  for (const language of languages) {
    try {
      const [locale] = Intl.NumberFormat.supportedLocalesOf([language]);
      if (locale) return locale;
    } catch (error) {
      // Ignore invalid language tags and try the next browser preference.
    }
  }

  return 'en-US';
}

function formatCurrency(value, locale) {
  const decimal = value == null ? '0' : value.toString();
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(decimal);
  if (!parts) {
    throw new Error(`Unable to format aggregated currency value: ${decimal}`);
  }

  const negative = parts[1] === '-';
  let digits = parts[2] + (parts[3] || '');
  const scale = (parts[3] || '').length - Number(parts[4] || 0);
  if (scale > 2) {
    const divisor = 10n ** BigInt(scale - 2);
    let cents = BigInt(digits);
    const remainder = cents % divisor;
    cents /= divisor;
    if (remainder * 2n >= divisor) cents += 1n;
    digits = cents.toString();
  } else if (scale < 2) {
    digits += '0'.repeat(2 - scale);
  }

  const cents = BigInt(digits);
  const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(cents / 100n);
  const fractional = (cents % 100n).toString().padStart(2, '0');
  const decimalSeparator = new Intl.NumberFormat(locale)
    .formatToParts(1.1)
    .find(part => part.type === 'decimal').value;
  return `${negative ? '-$' : '$'}${whole}${decimalSeparator}${fractional}`;
}

function maskCardNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) {
    return 'XXXX XXXX XXXX XXXX';
  }

  return `•••• •••• •••• ${digits.slice(-4)}`;
}

function hasIssuedCard(value) {
  return String(value || '').replace(/\D/g, '').length >= 4;
}

function isV1Account(account) {
  if (account.category === 'admin' || account.date == null) {
    return false;
  }

  const createdAt = new Date(account.date);
  return Number.isFinite(createdAt.getTime()) && createdAt < v1AccountCutoff;
}

function isV2Account(account) {
  if (account.category === 'admin' || account.date == null) {
    return false;
  }

  const createdAt = new Date(account.date);
  return Number.isFinite(createdAt.getTime()) && createdAt >= v1AccountCutoff;
}

router.get('/robots.txt', (req, res) => {
  const siteUrl = req.app.locals.siteUrl || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send([
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /dashboard',
    'Disallow: /profile',
    'Disallow: /users/',
    'Disallow: /checkout',
    'Disallow: /card-top-up',
    'Disallow: /withdrawal',
    'Disallow: /earnings',
    'Disallow: /history',
    'Disallow: /carding',
    'Disallow: /deposit-success',
    'Disallow: /withdrawal-success',
    'Disallow: /select-coin-',
    'Disallow: /bit-pay',
    'Disallow: /ether-pay',
    'Disallow: /usdt-',
    'Disallow: /ltc-pay',
    `Sitemap: ${siteUrl}/sitemap.xml`,
    ''
  ].join('\n'));
});

router.get('/sitemap.xml', (req, res) => {
  const siteUrl = req.app.locals.siteUrl || `${req.protocol}://${req.get('host')}`;
  const urls = publicPaths.map(route => (
    `  <url><loc>${escapeXml(`${siteUrl}${route}`)}</loc></url>`
  ));
  res
    .type('application/xml')
    .send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
});

router.get('/llms.txt', (req, res) => {
  const siteUrl = req.app.locals.siteUrl || `${req.protocol}://${req.get('host')}`;
  res.type('text/plain').send([
    '# Cardsequel',
    '',
    '> Cardsequel provides online-wallet cash card services. Its public pages describe card features, wallet options, account activation, and policies.',
    '',
    '## Public pages',
    '',
    `- [Home](${siteUrl}/): Overview of Cardsequel and its online-wallet cash cards.`,
    `- [Cards](${siteUrl}/card): Card options, features, and how to get started.`,
    `- [Wallet](${siteUrl}/wallet): Information about wallet options.`,
    `- [About](${siteUrl}/about): Company and service information.`,
    `- [Privacy policy](${siteUrl}/privacy-policy): Privacy terms.`,
    `- [Refund policy](${siteUrl}/refund-policy): Refund terms.`,
    `- [Terms and conditions](${siteUrl}/term-and-condition): Service terms.`,
    '',
    '## Content guidance',
    '',
    '- Use the linked public pages as the source of truth; do not infer product terms that are not stated there.',
    '- Account, dashboard, payment, and user-specific pages are private and are not public product information.',
    ''
  ].join('\n'));
});

// Welcome Page
router.get('/', forwardAuthenticated, (req, res) => res.render('welcome'));

// Contact
router.get('/contact', forwardAuthenticated, (req, res) => res.render('contact'));




// About Us
router.get('/about', forwardAuthenticated, (req, res) => res.render('about'));



// Wallet 
router.get('/wallet', forwardAuthenticated, (req, res) => res.render('wallet'));




// card 
router.get('/card', forwardAuthenticated, (req, res) => res.render('card'));


// TERMS
router.get('/term-and-condition', forwardAuthenticated, (req, res) => res.render('terms'));

//PRIVACY POLICY
router.get('/privacy-policy', forwardAuthenticated, (req, res) => res.render('privacy'));

//REFUND POLICY
router.get('/refund-policy', forwardAuthenticated, (req, res) => res.render('refund'));


// Dashboard
router.get('/dashboard', ensureAuthenticated, (req, res) => {
  const numberLocale = getRequestLocale(req);
  const dashboardUser = {
    first_name: req.user.first_name,
    last_name: req.user.last_name,
    availbalance: req.user.availbalance,
    activedeposit: req.user.activedeposit,
    activeinvestment: req.user.activeinvestment
  };
  res.set('Cache-Control', 'no-store');
  return res.render('dashboard', {
    user: dashboardUser,
    numberLocale,
    card: {
      number: maskCardNumber(req.user.cardnumber),
      expiry: req.user.expirydate || 'XX/XX',
      holder: `${req.user.first_name} ${req.user.last_name}`.trim()
    }
  });
});

router.get('/card-top-up', ensureAuthenticated, (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!hasIssuedCard(req.user.cardnumber)) {
    return res.render('card-top-up', {
      user: req.user,
      requests: [],
      hasCard: false
    });
  }

  if (!req.session.topUpToken) {
    req.session.topUpToken = crypto.randomBytes(32).toString('hex');
  }
  return TopUpRequest.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()
    .exec()
    .then(requests => res.render('card-top-up', {
      user: req.user,
      requests,
      hasCard: true,
      csrfToken: req.session.topUpToken
    }))
    .catch(next);
});

router.get('/withdrawal', ensureAuthenticated, (req, res, next) => {
  const numberLocale = getRequestLocale(req);
  if (!req.session.cryptoWithdrawalToken) {
    req.session.cryptoWithdrawalToken = crypto.randomBytes(32).toString('hex');
  }
  res.set('Cache-Control', 'no-store');
  return CryptoWithdrawalRequest.find({ user: req.user._id })
    .sort({ createdAt: -1 })
    .limit(20)
    .lean()
    .exec()
    .then(requests => res.render('withdrawal', {
      user: req.user,
      numberLocale,
      requests,
      cryptoAssets,
      csrfToken: req.session.cryptoWithdrawalToken
    }))
    .catch(next);
});

router.post('/withdrawal', ensureAuthenticated, async (req, res, next) => {
  const body = req.body || {};
  const suppliedToken = body._csrf;
  const storedToken = req.session.cryptoWithdrawalToken;
  const validCsrfToken =
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken));
  if (!validCsrfToken) {
    req.flash('error_msg', 'Your withdrawal form expired. Please try again.');
    return res.redirect('/withdrawal');
  }

  const amountString = typeof body.amount === 'string' ? body.amount.trim() : '';
  const normalizedAmount = normalizeAmount(amountString);
  const amount = parseAmount(amountString);
  const asset = typeof body.asset === 'string' ? body.asset : '';
  const selectedNetwork = typeof body.network === 'string' ? body.network.trim() : '';
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress.trim() : '';
  const cryptoAsset = cryptoAssets.find(candidate => candidate.symbol === asset);
  const network = cryptoAsset && cryptoAsset.networks.length === 1
    ? cryptoAsset.defaultNetwork
    : selectedNetwork;
  if (
    !normalizedAmount ||
    !/^\d{1,12}(?:\.\d{1,2})?$/.test(normalizedAmount) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 999999999999 ||
    !cryptoAsset ||
    !cryptoAsset.networks.some(candidate => candidate.value === network) ||
    walletAddress.length < 8 ||
    walletAddress.length > 200
  ) {
    req.flash('error_msg', 'Enter a valid USD amount, supported cryptocurrency, network, and wallet address.');
    return res.redirect('/withdrawal');
  }

  try {
    if (!await isValidWalletAddress(asset, network, walletAddress)) {
      req.flash('error_msg', 'The destination wallet address is invalid for the selected cryptocurrency and network.');
      return res.redirect('/withdrawal');
    }

    if (!Number.isFinite(Number(req.user.availbalance)) || Number(req.user.availbalance) < amount) {
      req.flash('error_msg', 'Your available balance is not sufficient for this withdrawal request.');
      return res.redirect('/withdrawal');
    }

    await CryptoWithdrawalRequest.create({
      user: req.user._id,
      amount,
      asset,
      network,
      walletAddress
    });
    req.session.cryptoWithdrawalToken = crypto.randomBytes(32).toString('hex');
    req.flash('success_msg', 'Crypto withdrawal request submitted. Your balance will only be deducted if approved.');
    return res.redirect('/withdrawal');
  } catch (error) {
    return next(error);
  }
});

router.post('/card-top-up', ensureAuthenticated, (req, res, next) => {
  if (!hasIssuedCard(req.user.cardnumber)) {
    return res.redirect('/card-top-up');
  }

  const body = req.body || {};
  const suppliedToken = body._csrf;
  const storedToken = req.session.topUpToken;
  const validCsrfToken =
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken));
  if (!validCsrfToken) {
    req.flash('error_msg', 'Your top-up form expired. Please try again.');
    return res.redirect('/card-top-up');
  }

  const amountString = typeof body.amount === 'string' ? body.amount.trim() : '';
  const normalizedAmount = normalizeAmount(amountString);
  const amount = parseAmount(amountString);
  const paymentReference = body.paymentReference === undefined
    ? ''
    : typeof body.paymentReference === 'string' ? body.paymentReference.trim() : null;
  if (
    !normalizedAmount ||
    !/^\d{1,12}(?:\.\d{1,2})?$/.test(normalizedAmount) ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 999999999999 ||
    paymentReference === null ||
    paymentReference.length > 120
  ) {
    req.flash('error_msg', 'Enter a valid amount greater than zero and a payment reference no longer than 120 characters.');
    return res.redirect('/card-top-up');
  }

  TopUpRequest.create({
    user: req.user._id,
    amount,
    paymentReference
  })
    .then(() => {
      req.session.topUpToken = crypto.randomBytes(32).toString('hex');
      req.flash('success_msg', 'Top-up request submitted.');
      return res.redirect('/card-top-up');
    })
    .catch(next);
});

router.get('/not-found', ensureAuthenticated, (req, res) =>
  res.status(404).render('notfound-auth', {
    user: req.user,
    layout: false
  })
);

router.get('/admin-dashboard', ensureAdmin, (req, res, next) => {
  const numberLocale = getRequestLocale(req);
  const removeCharacter = (input, character) => ({
    $let: {
      vars: { parts: { $split: [input, { $literal: character }] } },
      in: {
        $reduce: {
          input: '$$parts',
          initialValue: '',
          in: { $concat: ['$$value', '$$this'] }
        }
      }
    }
  });
  const asDecimalInput = field => {
    const value = { $toString: { $ifNull: [`$${field}`, ''] } };
    return ['$', ',', ' '].reduce(
      (normalized, character) => removeCharacter(normalized, character),
      value
    );
  };
  const amountFields = [
    ['availbalance', 'availableBalance'],
    ['activedeposit', 'activeDeposits'],
    ['activeinvestment', 'activeInvestments'],
    ['cashback', 'cashback'],
    ['todaysspending', 'todaysSpending']
  ];
  const amountConversions = {};
  const invalidAmountCounts = {};
  for (const [field, metric] of amountFields) {
    const converted = {
      $convert: {
        input: asDecimalInput(field),
        to: 'decimal',
        onError: null,
        onNull: null
      }
    };
    amountConversions[metric] = converted;
    invalidAmountCounts[`invalid${metric[0].toUpperCase()}${metric.slice(1)}`] = {
      $sum: {
        $cond: [
          {
            $and: [
              { $ne: [`$${field}`, null] },
              { $ne: [asDecimalInput(field), ''] },
              { $eq: [converted, null] }
            ]
          },
          1,
          0
        ]
      }
    };
  }
  const v1AccountDate = {
    $convert: {
      input: '$date',
      to: 'date',
      onError: null,
      onNull: null
    }
  };

  Promise.all([
    User.aggregate([
      { $addFields: { __adminAmounts: amountConversions } },
      {
        $group: {
          _id: null,
          totalAccounts: { $sum: 1 },
          adminAccounts: {
            $sum: { $cond: [{ $eq: ['$category', 'admin'] }, 1, 0] }
          },
          standardAccounts: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$category', 'admin'] },
                    { $ne: [v1AccountDate, null] },
                    { $lt: [v1AccountDate, v1AccountCutoff] }
                  ]
                },
                1,
                0
              ]
            }
          },
          v2Accounts: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$category', 'admin'] },
                    { $ne: [v1AccountDate, null] },
                    { $gte: [v1AccountDate, v1AccountCutoff] }
                  ]
                },
                1,
                0
              ]
            }
          },
          availableBalance: { $sum: '$__adminAmounts.availableBalance' },
          activeDeposits: { $sum: '$__adminAmounts.activeDeposits' },
          activeInvestments: { $sum: '$__adminAmounts.activeInvestments' },
          cashback: { $sum: '$__adminAmounts.cashback' },
          todaysSpending: { $sum: '$__adminAmounts.todaysSpending' },
          ...invalidAmountCounts
        }
      },
      { $project: { _id: 0 } }
    ]),
    User.find({}, 'first_name last_name email category date')
      .sort({ date: -1 })
      .limit(5)
      .lean()
      .exec()
  ])
    .then(([aggregates, recentUsers]) => {
      const metrics = aggregates[0] || {
        totalAccounts: 0,
        adminAccounts: 0,
        standardAccounts: 0,
        v2Accounts: 0,
        availableBalance: 0,
        activeDeposits: 0,
        activeInvestments: 0,
        cashback: 0,
        todaysSpending: 0,
        invalidAvailableBalance: 0,
        invalidActiveDeposits: 0,
        invalidActiveInvestments: 0,
        invalidCashback: 0,
        invalidTodaysSpending: 0
      };
      const invalidMetrics = amountFields
        .map(([, metric]) => ({
          label: metric.replace(/([A-Z])/g, ' $1').toLowerCase(),
          count: metrics[`invalid${metric[0].toUpperCase()}${metric.slice(1)}`]
        }))
        .filter(metric => metric.count > 0);
      for (const [, metric] of amountFields) {
        metrics[metric] = formatCurrency(metrics[metric], numberLocale);
      }
      return res.render('admin-dashboard', {
        user: req.user,
        metrics,
        numberLocale,
        invalidMetrics,
        recentUsers
      });
    })
    .catch(next);
});

router.get('/admin', ensureAdmin, (req, res, next) => {
  User.find({}, 'first_name last_name email category date')
    .sort({ date: -1 })
    .lean()
    .exec()
    .then(allUsers => {
      const searchQuery = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const normalizedQuery = searchQuery.toLowerCase();
      const users = normalizedQuery
        ? allUsers.filter(account => (
          `${account.first_name} ${account.last_name} ${account.email}`
            .toLowerCase()
            .includes(normalizedQuery)
        ))
        : allUsers;

      if (!req.session.adminMailToken) {
        req.session.adminMailToken = crypto.randomBytes(32).toString('hex');
      }
      res.set('Cache-Control', 'no-store');
      return res.render('admin', {
        user: req.user,
        allUsers,
        users,
        searchQuery,
        csrfToken: req.session.adminMailToken,
        v1Accounts: allUsers.filter(isV1Account).length,
        v2Accounts: allUsers.filter(isV2Account).length
      });
    })
    .catch(next);
});

router.post('/admin/users/:id/send-email', ensureAdmin, async (req, res, next) => {
  const body = req.body || {};
  const searchQuery = typeof body.search === 'string' ? body.search.trim() : '';
  const accountUrl = `/admin/users/${encodeURIComponent(req.params.id)}/edit${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`;
  if (!isValidCsrfToken(body._csrf, req.session.adminEditToken)) {
    req.flash('error_msg', 'Your email form expired. Reload the page and try again.');
    return res.redirect(accountUrl);
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).render('notfound-page');
  }

  const emailType = body.emailType;
  if (emailType !== 'welcome' && emailType !== 'password-reset') {
    req.flash('error_msg', 'Choose a valid email to send.');
    return res.redirect(accountUrl);
  }
  let smtpConfig;
  try {
    smtpConfig = validateSmtpConfig(body);
  } catch (error) {
    req.flash('error_msg', error.message);
    return res.redirect(accountUrl);
  }
  let siteUrl;
  try {
    siteUrl = validateSiteUrl(body.siteUrl);
  } catch (error) {
    req.flash('error_msg', error.message);
    return res.redirect(accountUrl);
  }

  let account;
  try {
    account = await User.findById(req.params.id)
      .select('first_name last_name email')
      .lean()
      .exec();
  } catch (error) {
    return next(error);
  }
  if (!account) {
    return res.status(404).render('notfound-page');
  }

  if (emailType === 'welcome') {
    try {
      const normalizedEmail = account.email.trim().toLowerCase();
      const unsubscribe = await UnsubscribedEmail.findOne({ normalizedEmail }).select('_id').lean().exec();
      if (unsubscribe) {
        req.flash('error_msg', `${account.email} has unsubscribed from promotional emails.`);
        return res.redirect(accountUrl);
      }

      const unsubscribeToken = crypto.randomBytes(32).toString('hex');
      const unsubscribeTokenHash = crypto.createHash('sha256').update(unsubscribeToken).digest('hex');
      const updateResult = await User.updateOne(
        { _id: account._id },
        { $addToSet: { unsubscribeTokenHashes: unsubscribeTokenHash } }
      ).exec();
      if (updateResult.n !== 1) {
        return res.status(404).render('notfound-page');
      }

      const unsubscribeUrl =
        `${siteUrl}/users/unsubscribe/${unsubscribeToken}`;
      try {
        await sendWelcomeEmail(account, unsubscribeUrl, smtpConfig);
      } catch (error) {
        await User.updateOne(
          { _id: account._id },
          { $pull: { unsubscribeTokenHashes: unsubscribeTokenHash } }
        ).exec();
        throw error;
      }
      req.flash('success_msg', `Welcome email sent to ${account.email}.`);
    } catch (error) {
      console.error('Admin welcome email delivery failed:', error.message);
      req.flash('error_msg', 'The welcome email could not be sent. Verify the SMTP details and try again.');
      return res.redirect(accountUrl);
    }
  } else {
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    try {
      const updateResult = await User.updateOne(
        { _id: account._id },
        { $set: { passwordResetTokenHash: resetTokenHash, passwordResetExpires: expiresAt } }
      ).exec();
      if (updateResult.n !== 1) {
        return res.status(404).render('notfound-page');
      }
    } catch (error) {
      return next(error);
    }

    try {
      await sendPasswordResetEmail(
        account,
        `${siteUrl}/users/reset-password/${resetToken}`,
        smtpConfig
      );
      req.flash('success_msg', `Password-reset email sent to ${account.email}.`);
    } catch (error) {
      try {
        await User.updateOne(
          { _id: account._id, passwordResetTokenHash: resetTokenHash },
          { $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 } }
        ).exec();
      } catch (cleanupError) {
        return next(cleanupError);
      }
      console.error('Admin password-reset email delivery failed:', error.message);
      req.flash('error_msg', 'The password-reset email could not be sent. Verify the SMTP details and try again.');
      return res.redirect(accountUrl);
    }
  }

  return res.redirect(accountUrl);
});

router.get('/admin/unsubscribed-emails.txt', ensureAdmin, (req, res, next) => {
  UnsubscribedEmail.find({}, 'email')
    .sort({ createdAt: 1 })
    .lean()
    .exec()
    .then(records => {
      const emails = records
        .map(record => record.email)
        .filter(email => typeof email === 'string' && !/[\r\n]/.test(email));
      res.set('Cache-Control', 'no-store');
      res.type('text/plain').attachment('unsubscribed-emails.txt');
      return res.send(emails.length ? `${emails.join('\n')}\n` : '');
    })
    .catch(next);
});

router.get('/admin/top-ups', ensureAdmin, (req, res, next) => {
  TopUpRequest.find({})
    .populate('user', 'first_name last_name email')
    .populate('reviewedBy', 'first_name last_name email')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
    .exec()
    .then(requests => {
      if (!req.session.adminTopUpToken) {
        req.session.adminTopUpToken = crypto.randomBytes(32).toString('hex');
      }
      res.set('Cache-Control', 'no-store');
      return res.render('admin-top-ups', {
        user: req.user,
        requests,
        csrfToken: req.session.adminTopUpToken
      });
    })
    .catch(next);
});

router.get('/admin/payment-wallets', ensureAdmin, (req, res, next) => {
  if (!req.session.adminPaymentWalletToken) {
    req.session.adminPaymentWalletToken = crypto.randomBytes(32).toString('hex');
  }
  res.set('Cache-Control', 'no-store');
  return getPaymentWalletSettings()
    .then(async addresses => {
      const paymentWalletQrCodes = Object.fromEntries(await Promise.all(
        paymentWallets.map(async ({ key }) => [key, await createPaymentQr(addresses[key], 220)])
      ));
      return res.render('admin-payment-wallets', {
      user: req.user,
      paymentWallets,
      addresses,
      paymentWalletQrCodes,
      csrfToken: req.session.adminPaymentWalletToken
      });
    })
    .catch(next);
});

router.post('/admin/payment-wallets', ensureAdmin, async (req, res, next) => {
  const body = req.body || {};
  const suppliedToken = body._csrf;
  const storedToken = req.session.adminPaymentWalletToken;
  if (!isValidCsrfToken(suppliedToken, storedToken)) {
    req.flash('error_msg', 'Your payment wallet settings form expired. Reload the page and try again.');
    return res.redirect('/admin/payment-wallets');
  }

  const submittedAddresses = body.addresses;
  const addresses = {};
  for (const { key, label } of paymentWallets) {
    const address = submittedAddresses && submittedAddresses[key];
    if (
      typeof address !== 'string' ||
      address !== address.trim() ||
      !/^[A-Za-z0-9]{8,200}$/.test(address)
    ) {
      req.flash('error_msg', `Enter a valid wallet address for ${label}.`);
      return res.redirect('/admin/payment-wallets');
    }
    addresses[key] = address;
  }

  try {
    await PaymentWalletSettings.findByIdAndUpdate(
      'primary',
      { $set: { addresses } },
      { upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).exec();
    req.session.adminPaymentWalletToken = crypto.randomBytes(32).toString('hex');
    req.flash('success_msg', 'Payment wallet addresses updated.');
    return res.redirect('/admin/payment-wallets');
  } catch (error) {
    return next(error);
  }
});

router.get('/admin/crypto-withdrawals', ensureAdmin, (req, res, next) => {
  CryptoWithdrawalRequest.find({})
    .populate('user', 'first_name last_name email')
    .populate('reviewedBy', 'first_name last_name email')
    .sort({ createdAt: -1 })
    .limit(100)
    .lean()
    .exec()
    .then(requests => {
      if (!req.session.adminCryptoWithdrawalToken) {
        req.session.adminCryptoWithdrawalToken = crypto.randomBytes(32).toString('hex');
      }
      res.set('Cache-Control', 'no-store');
      return res.render('admin-crypto-withdrawals', {
        user: req.user,
        requests,
        csrfToken: req.session.adminCryptoWithdrawalToken
      });
    })
    .catch(next);
});

router.post('/admin/crypto-withdrawals/:id/:decision', ensureAdmin, async (req, res, next) => {
  const body = req.body || {};
  const suppliedToken = body._csrf;
  const storedToken = req.session.adminCryptoWithdrawalToken;
  const validCsrfToken =
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken));
  if (!validCsrfToken) {
    req.flash('error_msg', 'Your review session expired. Reload the crypto withdrawal queue and try again.');
    return res.redirect('/admin/crypto-withdrawals');
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !['approve', 'reject'].includes(req.params.decision)) {
    return res.status(404).render('notfound-page');
  }

  let session;
  let transactionActive = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    transactionActive = true;

    const request = await CryptoWithdrawalRequest.findOne({
      _id: req.params.id,
      status: 'pending'
    }).session(session);
    if (!request) {
      await session.abortTransaction();
      transactionActive = false;
      req.flash('error_msg', 'This withdrawal request is no longer pending.');
      return res.redirect('/admin/crypto-withdrawals');
    }

    if (req.params.decision === 'approve') {
      const updateResult = await User.updateOne(
        { _id: request.user, availbalance: { $gte: request.amount } },
        { $inc: { availbalance: -request.amount } },
        { session }
      );
      if (updateResult.n !== 1) {
        await session.abortTransaction();
        transactionActive = false;
        req.flash('error_msg', 'The user no longer has enough available balance. The request remains pending.');
        return res.redirect('/admin/crypto-withdrawals');
      }
    }

    request.status = req.params.decision === 'approve' ? 'approved' : 'rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save({ session });
    await session.commitTransaction();
    transactionActive = false;

    req.session.adminCryptoWithdrawalToken = crypto.randomBytes(32).toString('hex');
    req.flash('success_msg', req.params.decision === 'approve'
      ? 'Withdrawal approved and the USD balance deducted. Confirm the crypto transfer is complete to the listed wallet.'
      : 'Crypto withdrawal request rejected. No balance was deducted.');
    return res.redirect('/admin/crypto-withdrawals');
  } catch (error) {
    if (session && transactionActive) {
      await session.abortTransaction();
    }
    return next(error);
  } finally {
    if (session) session.endSession();
  }
});

router.post('/admin/top-ups/:id/:decision', ensureAdmin, async (req, res, next) => {
  const body = req.body || {};
  const suppliedToken = body._csrf;
  const storedToken = req.session.adminTopUpToken;
  const validCsrfToken =
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken));
  if (!validCsrfToken) {
    req.flash('error_msg', 'Your review session expired. Reload the top-up queue and try again.');
    return res.redirect('/admin/top-ups');
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id) || !['approve', 'reject'].includes(req.params.decision)) {
    return res.status(404).render('notfound-page');
  }

  let session;
  let transactionActive = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    transactionActive = true;

    const request = await TopUpRequest.findOne({
      _id: req.params.id,
      status: 'pending'
    }).session(session);
    if (!request) {
      await session.abortTransaction();
      transactionActive = false;
      req.flash('error_msg', 'This request is no longer pending.');
      return res.redirect('/admin/top-ups');
    }

    if (req.params.decision === 'approve') {
      const updateResult = await User.updateOne(
        { _id: request.user },
        { $inc: { availbalance: request.amount } },
        { session }
      );
      if (updateResult.n !== 1) {
        throw new Error('The account for this top-up request could not be found.');
      }
    }

    request.status = req.params.decision === 'approve' ? 'approved' : 'rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save({ session });
    await session.commitTransaction();
    transactionActive = false;

    req.session.adminTopUpToken = crypto.randomBytes(32).toString('hex');
    req.flash('success_msg', req.params.decision === 'approve'
      ? 'Payment confirmed and card balance topped up.'
      : 'Top-up request rejected.');
    return res.redirect('/admin/top-ups');
  } catch (error) {
    if (session && transactionActive) {
      await session.abortTransaction();
    }
    return next(error);
  } finally {
    if (session) session.endSession();
  }
});

router.get('/admin/users/:id/edit', ensureAdmin, (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).render('notfound-page');
  }

  User.findById(req.params.id)
    .select('-password -password2')
    .lean()
    .exec()
    .then(account => {
      if (!account) {
        return res.status(404).render('notfound-page');
      }

      const accountForForm = {
        ...account,
        category: account.category || 'user',
        availbalance: account.availbalance == null ? 0 : account.availbalance,
        activedeposit: account.activedeposit == null ? 0 : account.activedeposit,
        activeinvestment: account.activeinvestment == null ? 0 : account.activeinvestment,
        cashback: account.cashback == null ? 0 : account.cashback,
        todaysspending: account.todaysspending == null ? 0 : account.todaysspending,
        date: account.date || account._id.getTimestamp()
      };

      if (!req.session.adminEditToken) {
        req.session.adminEditToken = crypto.randomBytes(32).toString('hex');
      }
      res.set('Cache-Control', 'no-store');
      return res.render('admin-edit-user', {
        user: req.user,
        account: accountForForm,
        searchQuery: typeof req.query.search === 'string' ? req.query.search.trim() : '',
        siteUrl: req.app.locals.siteUrl || '',
        csrfToken: req.session.adminEditToken
      });
    })
    .catch(next);
});

router.post('/admin/users/:id', ensureAdmin, (req, res, next) => {
  const body = req.body || {};
  const searchQuery = typeof body.search === 'string' ? body.search.trim() : '';
  const adminUrl = `/admin${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`;
  const accountUrl = `/admin/users/${encodeURIComponent(req.params.id)}/edit${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`;
  const suppliedToken = body._csrf;
  const storedToken = req.session.adminEditToken;
  const validCsrfToken =
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken));
  if (!validCsrfToken) {
    req.flash('error_msg', 'Your edit session expired. Please try again.');
    return res.redirect(adminUrl);
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).render('notfound-page');
  }

  const textFields = [
    'first_name',
    'last_name',
    'email',
    'wallet',
    'category',
    'code',
    'referalcode',
    'availbalance',
    'activedeposit',
    'activeinvestment',
    'cashback',
    'todaysspending',
    'cardnumber',
    'CVV',
    'expirydate',
    'date'
  ];
  const values = {};

  for (const field of textFields) {
    if (typeof body[field] !== 'string') {
      req.flash('error_msg', 'Please submit valid account details.');
      return res.redirect(accountUrl);
    }
    values[field] = body[field].trim();
  }

  const maxLengths = {
    first_name: 80,
    last_name: 80,
    email: 254,
    wallet: 120,
    code: 120,
    referalcode: 120,
    cardnumber: 64,
    CVV: 4,
    expirydate: 10
  };
  const moneyFields = ['availbalance', 'activedeposit', 'activeinvestment', 'cashback', 'todaysspending'];
  const parsedAmounts = {};
  for (const field of moneyFields) {
    const normalizedAmount = normalizeAmount(values[field]);
    parsedAmounts[field] = parseAmount(values[field]);
    if (!normalizedAmount || !/^\d{1,12}(?:\.\d{1,2})?$/.test(normalizedAmount)) {
      parsedAmounts[field] = null;
    }
  }
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email);
  const validMoney = moneyFields.every(field =>
    parsedAmounts[field] !== null &&
    Number.isFinite(parsedAmounts[field]) &&
    parsedAmounts[field] <= 999999999999
  );
  const spending = parsedAmounts.todaysspending;
  const registrationDate = new Date(values.date);
  const validRegistrationDate =
    /^\d{4}-\d{2}-\d{2}$/.test(values.date) &&
    Number.isFinite(registrationDate.getTime()) &&
    registrationDate.toISOString().slice(0, 10) === values.date;
  const newPassword = body.new_password;
  const validLengths = Object.keys(maxLengths).every(field => values[field].length <= maxLengths[field]);

  if (
    !values.first_name ||
    !values.last_name ||
    !validLengths ||
    !validEmail ||
    !['user', 'admin'].includes(values.category) ||
    !validMoney ||
    !validRegistrationDate ||
    (newPassword !== undefined && typeof newPassword !== 'string') ||
    (typeof newPassword === 'string' &&
      newPassword !== '' &&
      (newPassword.length < 6 || Buffer.byteLength(newPassword, 'utf8') > 72))
  ) {
    req.flash('error_msg', 'Check the account fields and try again. Amounts must be non-negative numbers; passwords must be 6 to 72 UTF-8 bytes.');
    return res.redirect(accountUrl);
  }

  User.findById(req.params.id)
    .select('category')
    .lean()
    .then(account => {
      if (!account) {
        return res.status(404).render('notfound-page');
      }

      return User.findOne({
        email: values.email,
        _id: { $ne: account._id }
      })
        .select('_id')
        .lean()
        .then(existingAccount => {
          if (existingAccount) {
            req.flash('error_msg', 'Another account already uses that email address.');
            return res.redirect(accountUrl);
          }

          const saveAccount = () => {
            const changes = {
              first_name: values.first_name,
              last_name: values.last_name,
              email: values.email,
              wallet: values.wallet,
              category: values.category,
              code: values.code,
              referalcode: values.referalcode,
              availbalance: parsedAmounts.availbalance,
              activedeposit: parsedAmounts.activedeposit,
              activeinvestment: parsedAmounts.activeinvestment,
              cashback: parsedAmounts.cashback,
              todaysspending: spending,
              cardnumber: values.cardnumber,
              CVV: values.CVV,
              expirydate: values.expirydate,
              date: registrationDate
            };
            const passwordHash = typeof newPassword === 'string' && newPassword !== ''
              ? bcrypt.hash(newPassword, 10)
              : Promise.resolve(null);

            return passwordHash
              .then(hash => {
                if (hash) changes.password = hash;
                return User.updateOne({ _id: account._id }, { $set: changes }).exec();
              })
              .then(updateResult => {
                if (updateResult.n !== 1) {
                  return res.status(404).render('notfound-page');
                }
                req.flash('success_msg', 'Account updated successfully.');
                req.session.adminEditToken = crypto.randomBytes(32).toString('hex');
                return res.redirect(adminUrl);
              });
          };

          if (account.category === 'admin' && values.category !== 'admin') {
            return User.countDocuments({ category: 'admin', _id: { $ne: account._id } })
              .then(otherAdmins => {
                if (otherAdmins === 0) {
                  req.flash('error_msg', 'The last administrator account cannot be changed to a standard account.');
                  return res.redirect(accountUrl);
                }
                return saveAccount();
              });
          }

          return saveAccount();
        });
    })
    .catch(next);
});

router.post('/admin/users/:id/delete', ensureAdmin, async (req, res, next) => {
  const body = req.body || {};
  const searchQuery = typeof body.search === 'string' ? body.search.trim() : '';
  const adminUrl = `/admin${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`;
  if (!isValidCsrfToken(body._csrf, req.session.adminEditToken)) {
    req.flash('error_msg', 'Your delete form expired. Reload the account page and try again.');
    return res.redirect(adminUrl);
  }

  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(404).render('notfound-page');
  }

  const accountId = new mongoose.Types.ObjectId(req.params.id);
  const accountUrl = `/admin/users/${encodeURIComponent(accountId)}/edit${searchQuery ? `?search=${encodeURIComponent(searchQuery)}` : ''}`;
  if (String(accountId) === String(req.user._id || req.user.id)) {
    req.flash('error_msg', 'You cannot delete the administrator account you are currently using.');
    return res.redirect(accountUrl);
  }

  let session;
  let transactionActive = false;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    transactionActive = true;

    const account = await User.findById(accountId).select('category').session(session).lean().exec();
    if (!account) {
      await session.abortTransaction();
      transactionActive = false;
      return res.status(404).render('notfound-page');
    }

    if (account.category === 'admin') {
      const otherAdmins = await User.countDocuments({
        category: 'admin',
        _id: { $ne: accountId }
      }).session(session);
      if (otherAdmins === 0) {
        await session.abortTransaction();
        transactionActive = false;
        req.flash('error_msg', 'The last administrator account cannot be deleted.');
        return res.redirect(accountUrl);
      }
    }

    await TopUpRequest.deleteMany({ user: accountId }, { session }).exec();
    await CryptoWithdrawalRequest.deleteMany({ user: accountId }, { session }).exec();
    await TopUpRequest.updateMany(
      { reviewedBy: accountId },
      { $unset: { reviewedBy: 1, reviewedAt: 1 } },
      { session }
    ).exec();
    await CryptoWithdrawalRequest.updateMany(
      { reviewedBy: accountId },
      { $unset: { reviewedBy: 1, reviewedAt: 1 } },
      { session }
    ).exec();

    const deleteResult = await User.deleteOne({ _id: accountId }, { session }).exec();
    if (deleteResult.n !== 1) {
      throw new Error('The account could not be deleted.');
    }

    await session.commitTransaction();
    transactionActive = false;
    req.session.adminEditToken = crypto.randomBytes(32).toString('hex');
    req.flash('success_msg', 'Account and its top-up and crypto-withdrawal records were deleted.');
    return res.redirect(adminUrl);
  } catch (error) {
    if (session && transactionActive) {
      await session.abortTransaction();
    }
    return next(error);
  } finally {
    if (session) session.endSession();
  }
});

router.get('/profile', ensureAuthenticated, (req, res) => {
  if (!req.session.profileToken) {
    req.session.profileToken = crypto.randomBytes(32).toString('hex');
  }
  res.set('Cache-Control', 'no-store');
  return res.render('profile', {
    user: {
      first_name: req.user.first_name,
      last_name: req.user.last_name,
      email: req.user.email,
      wallet: req.user.wallet || ''
    },
    sidebarRole: req.user.category === 'admin' ? 'admin' : 'user',
    activePage: '/profile',
    csrfToken: req.session.profileToken
  });
});

router.post('/profile', ensureAuthenticated, async (req, res, next) => {
  const profileUrl = '/profile';
  const body = req.body || {};
  const suppliedToken = body._csrf;
  const storedToken = req.session.profileToken;
  const validCsrfToken =
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken));
  if (!validCsrfToken) {
    req.flash('error_msg', 'Your profile form expired. Please try again.');
    return res.redirect(profileUrl);
  }

  const action = body._action;
  if (!['update_profile', 'change_password'].includes(action)) {
    req.flash('error_msg', 'Choose a valid profile update action.');
    return res.redirect(profileUrl);
  }

  if (action === 'change_password') {
    const currentPassword = body.current_password;
    const newPassword = body.new_password;
    const confirmPassword = body.confirm_password;
    if (
      typeof currentPassword !== 'string' ||
      !currentPassword ||
      typeof newPassword !== 'string' ||
      newPassword.length < 6 ||
      Buffer.byteLength(newPassword, 'utf8') > 72 ||
      typeof confirmPassword !== 'string' ||
      newPassword !== confirmPassword
    ) {
      req.flash('error_msg', 'Enter your current password and matching new passwords (6 to 72 UTF-8 bytes).');
      return res.redirect(profileUrl);
    }

    try {
      const passwordMatches = await bcrypt.compare(currentPassword, req.user.password);
      if (!passwordMatches) {
        req.flash('error_msg', 'Your current password is incorrect.');
        return res.redirect(profileUrl);
      }

      req.user.password = await bcrypt.hash(newPassword, 10);
      await req.user.save();
      req.session.profileToken = crypto.randomBytes(32).toString('hex');
      req.flash('success_msg', 'Your password has been updated.');
      return res.redirect(profileUrl);
    } catch (error) {
      return next(error);
    }
  }

  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : '';
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const wallet = typeof body.wallet === 'string' ? body.wallet.trim() : null;
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (
    !firstName ||
    firstName.length > 80 ||
    !lastName ||
    lastName.length > 80 ||
    !validEmail ||
    email.length > 254 ||
    wallet === null ||
    wallet.length > 120
  ) {
    req.flash('error_msg', 'Enter valid name, email, and wallet details.');
    return res.redirect(profileUrl);
  }

  try {
    const duplicateEmail = await User.findOne({
      email,
      _id: { $ne: req.user._id }
    }).select('_id').lean().exec();
    if (duplicateEmail) {
      req.flash('error_msg', 'Another account already uses that email address.');
      return res.redirect(profileUrl);
    }

    req.user.first_name = firstName;
    req.user.last_name = lastName;
    req.user.email = email;
    req.user.wallet = wallet;
    await req.user.save();

    req.session.profileToken = crypto.randomBytes(32).toString('hex');
    req.flash('success_msg', 'Your profile details have been updated.');
    return res.redirect(profileUrl);
  } catch (error) {
    return next(error);
  }
});
router.get('/carding', ensureAuthenticated, (req, res) =>
  res.render('carding', {
    user: req.user
  })
  );

router.get('/withdrawal-success', ensureAuthenticated, (req, res) =>
  res.render('success', {
    user: req.user
  })
);
router.get('/earnings', ensureAuthenticated, (req, res) =>
  res.render('earnings', {
    user: req.user
  })
);
router.get('/deposit-success', ensureAuthenticated, (req, res) =>
  res.render('deposit', {
    user: req.user
  })
);
router.get('/checkout', ensureAuthenticated, (req, res) =>
  res.render('checkout', {
    user: req.user
  })
);
router.get('/bloop', ensureAuthenticated, (req, res) =>
  res.render('complete', {
    user: req.user
  })
);
router.get('/select-coin-19843667164', ensureAuthenticated, (req, res) =>
  res.render('coin', {
    user: req.user
  })
);
router.get('/bit-pay', ensureAuthenticated, (req, res, next) =>
  renderPaymentPage(req, res, next, 'bitpay', 'bitcoin')
);


router.get('/ether-pay', ensureAuthenticated, (req, res, next) =>
  renderPaymentPage(req, res, next, 'etherpay', 'ethereum')
);

router.get('/usdt-trc', ensureAuthenticated, (req, res, next) =>
  renderPaymentPage(req, res, next, 'trc', 'usdtTron')
);

router.get('/usdt-erc', ensureAuthenticated, (req, res, next) =>
  renderPaymentPage(req, res, next, 'erc', 'ethereum')
);

router.get('/ltc-pay', ensureAuthenticated, (req, res, next) =>
  renderPaymentPage(req, res, next, 'ltc', 'litecoin')
);





module.exports = router;
