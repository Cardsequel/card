const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const passport = require('passport');
// Load User model
const User = require('../models/User');
const UnsubscribedEmail = require('../models/UnsubscribedEmail');
const UnsubscribeToken = require('../models/UnsubscribeToken');
const { forwardAuthenticated } = require('../config/auth');

function isValidCsrfToken(suppliedToken, storedToken) {
  return (
    typeof suppliedToken === 'string' &&
    typeof storedToken === 'string' &&
    /^[a-f0-9]{64}$/.test(suppliedToken) &&
    /^[a-f0-9]{64}$/.test(storedToken) &&
    crypto.timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(storedToken))
  );
}

function decodeBase64Url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(base64, 'base64');
}

function getSignedUnsubscribeEmail(token) {
  const match = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match || match[1].length > 2048) {
    return null;
  }

  const secret = process.env.UNSUBSCRIBE_SECRET || '';
  if (secret.length < 32 || /[\r\n\0]/.test(secret)) {
    throw new Error('UNSUBSCRIBE_SECRET must be configured with at least 32 characters.');
  }

  const expectedSignature = crypto.createHmac('sha256', secret)
    .update(match[1])
    .digest();
  const suppliedSignature = decodeBase64Url(match[2]);
  if (
    !suppliedSignature ||
    suppliedSignature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(match[1]).toString('utf8'));
    if (
      !payload ||
      typeof payload.email !== 'string' ||
      payload.email.length > 254 ||
      /[\r\n]/.test(payload.email) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
    ) {
      return null;
    }
    return payload.email;
  } catch (error) {
    return null;
  }
}

// Login Page
router.get('/login', forwardAuthenticated, (req, res) => res.render('login'));

// Register Page
router.get('/register', forwardAuthenticated, (req, res) => res.render('register'));

router.get('/unsubscribe/:token', async (req, res, next) => {
  const { token } = req.params;
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const isSignedToken = token.startsWith('v1.');
  if (!isSignedToken && !/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).render('unsubscribe', { unsubscribed: false });
  }

  try {
    let account = null;
    let campaignToken;
    let email;
    if (isSignedToken) {
      email = getSignedUnsubscribeEmail(token);
    } else {
      const unsubscribeTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      account = await User.findOne({ unsubscribeTokenHashes: unsubscribeTokenHash })
        .select('email')
        .lean()
        .exec();
      if (account) {
        email = account.email;
      } else {
        campaignToken = await UnsubscribeToken.findOne({ tokenHash: unsubscribeTokenHash })
          .select('email')
          .lean()
          .exec();
        email = campaignToken && campaignToken.email;
      }
    }

    if (typeof email !== 'string') {
      return res.status(400).render('unsubscribe', { unsubscribed: false });
    }

    email = email.trim();
    if (
      email.length > 254 ||
      /[\r\n]/.test(email) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return next(new Error('Cannot save an invalid email address to the unsubscribe list.'));
    }

    try {
      await UnsubscribedEmail.updateOne(
        { normalizedEmail: email.toLowerCase() },
        { $setOnInsert: { email, normalizedEmail: email.toLowerCase() } },
        { upsert: true, runValidators: true }
      ).exec();
    } catch (error) {
      if (error.code !== 11000) {
        throw error;
      }
    }

    if (account) {
      await User.updateOne(
        { _id: account._id },
        { $set: { unsubscribeTokenHashes: [] } }
      ).exec();
    } else if (campaignToken) {
      await UnsubscribeToken.deleteOne({ _id: campaignToken._id }).exec();
    }

    return res.render('unsubscribe', { unsubscribed: true });
  } catch (error) {
    return next(error);
  }
});

// Register
router.post('/register', (req, res) => {
  const { first_name, last_name, email, password, password2, code,} = req.body;
  let errors = [];
  const referalcode = first_name + Math.floor(Math.random() * 76876559);

  if (!first_name || !last_name|| !email || !password || !password2  ) {
    errors.push({ msg: 'Please enter all fields' });
  }

  if (password != password2) {
    errors.push({ msg: 'Passwords do not match' });
  }

  if (password.length < 6) {
    errors.push({ msg: 'Password must be at least 6 characters' });
  }

  if (errors.length > 0) {
    res.render('register', {
      errors,
      first_name,
      last_name,
      email,
      password,
      password2
    });
  } else {
    User.findOne({ email: email }).then(user => {
      if (user) {
        errors.push({ msg: 'Email already exists' });
        res.render('register', {
          errors,
          first_name,
          last_name,
          email,
          password,
          password2,
          code,
          referalcode
        });
      } else {
        const newUser = new User({
          first_name,
          last_name,
          email,
          password,
          code,
          referalcode
        });

        
        bcrypt.genSalt(10, (err, salt) => {
          bcrypt.hash(newUser.password, salt, (err, hash) => {
            if (err) throw err;
            newUser.password = hash;
            newUser
              .save()
              .then(() => {
                req.flash(
                  'success_msg',
                  'You are now registered and can log in'
                );
                res.redirect('/users/login');
              })
              .catch(err => console.log(err));
          });
        });
      }
    });
  }
});

router.get('/reset-password/:token', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  res.set('Referrer-Policy', 'no-referrer');
  const { token } = req.params;
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).render('reset-password', {
      layout: false,
      tokenValid: false
    });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const account = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() }
    }).select('_id email').lean().exec();

    if (!account) {
      return res.status(400).render('reset-password', {
        layout: false,
        tokenValid: false
      });
    }

    req.session.passwordResetCsrfToken = crypto.randomBytes(32).toString('hex');
    res.set('Cache-Control', 'no-store');
    return res.render('reset-password', {
      layout: false,
      token,
      email: account.email,
      csrfToken: req.session.passwordResetCsrfToken,
      tokenValid: true
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/reset-password/:token', async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  const { token } = req.params;
  const body = req.body || {};
  if (!/^[a-f0-9]{64}$/.test(token)) {
    return res.status(400).render('reset-password', {
      layout: false,
      tokenValid: false
    });
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  let account;
  try {
    account = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() }
    }).select('email').lean().exec();
  } catch (error) {
    return next(error);
  }
  if (!account) {
    delete req.session.passwordResetCsrfToken;
    return res.status(400).render('reset-password', {
      layout: false,
      tokenValid: false
    });
  }

  if (!isValidCsrfToken(body._csrf, req.session.passwordResetCsrfToken)) {
    return res.status(400).render('reset-password', {
      layout: false,
      token,
      email: account.email,
      tokenValid: true,
      errors: ['This form expired. Reload the page and try again.']
    });
  }

  const { password, password2 } = body;
  const errors = [];
  if (typeof password !== 'string' || typeof password2 !== 'string' || !password || !password2) {
    errors.push('Please enter and confirm your new password.');
  } else {
    if (password.length < 6) {
      errors.push('Password must be at least 6 characters.');
    }
    if (password !== password2) {
      errors.push('Passwords do not match.');
    }
  }

  if (errors.length) {
    return res.status(400).render('reset-password', {
      layout: false,
      token,
      email: account.email,
      csrfToken: req.session.passwordResetCsrfToken,
      tokenValid: true,
      errors
    });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await User.updateOne(
      {
        passwordResetTokenHash: tokenHash,
        passwordResetExpires: { $gt: new Date() }
      },
      {
        $set: { password: hashedPassword },
        $unset: { passwordResetTokenHash: 1, passwordResetExpires: 1 }
      }
    ).exec();

    if (result.nModified !== 1) {
      delete req.session.passwordResetCsrfToken;
      return res.status(400).render('reset-password', {
        layout: false,
        tokenValid: false
      });
    }

    delete req.session.passwordResetCsrfToken;
    req.flash('success_msg', 'Your password has been reset. You can now log in.');
    return res.redirect('/users/login');
  } catch (error) {
    return next(error);
  }
});

// Login
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      req.flash('error', info.message);
      return res.redirect('/users/login');
    }

    return req.logIn(user, loginError => {
      if (loginError) {
        return next(loginError);
      }
      return res.redirect(user.category === 'admin' ? '/admin-dashboard' : '/dashboard');
    });
  })(req, res, next);
});

// Logout
router.get('/logout', (req, res) => {
  req.logout();
  req.flash('success_msg', 'You are logged out');
  res.redirect('/users/login');
});

module.exports = router;
