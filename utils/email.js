const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const templateDirectory = path.join(__dirname, '..', 'views', 'email-templates');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readTemplate(name) {
  return fs.readFileSync(path.join(templateDirectory, name), 'utf8');
}

function interpolate(template, replacements) {
  return Object.entries(replacements).reduce(
    (html, [placeholder, value]) => html.split(`{{${placeholder}}}`).join(escapeHtml(value)),
    template
  );
}

function validateSmtpConfig(input) {
  const host = typeof input.smtpHost === 'string' ? input.smtpHost.trim() : '';
  const email = typeof input.smtpEmail === 'string' ? input.smtpEmail.trim() : '';
  const password = typeof input.smtpPassword === 'string' ? input.smtpPassword : '';
  const portValue = typeof input.smtpPort === 'string' ? input.smtpPort : '';
  const secureValue = input.smtpSecure;

  if (!host || host.length > 253 || /\s|[\/\\]/.test(host)) {
    throw new Error('Enter a valid SMTP host.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || /[\r\n]/.test(email)) {
    throw new Error('Enter a valid SMTP email address.');
  }
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) {
    throw new Error('Enter a valid SMTP password.');
  }
  if (!/^\d{1,5}$/.test(portValue)) {
    throw new Error('Enter a valid SMTP port.');
  }
  const port = Number(portValue);
  if (port < 1 || port > 65535) {
    throw new Error('Enter a valid SMTP port.');
  }
  if (secureValue !== 'true' && secureValue !== 'false') {
    throw new Error('Choose whether your SMTP connection uses secure TLS.');
  }

  return { host, email, password, port, secure: secureValue === 'true' };
}

function validateSiteUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Enter the public site URL for email links.');
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch (error) {
    throw new Error('Enter a valid public site URL, such as https://example.com.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Enter only the public site origin, such as https://example.com.');
  }

  return url.origin;
}

function createTransporter(smtpConfig) {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    requireTLS: !smtpConfig.secure,
    auth: { user: smtpConfig.email, pass: smtpConfig.password }
  });
}

async function sendEmail({ smtpConfig, to, subject, html, text }) {
  const transporter = createTransporter(smtpConfig);
  return transporter.sendMail({
    from: smtpConfig.email,
    to,
    subject,
    html,
    text
  });
}

function sendWelcomeEmail(account, unsubscribeUrl, smtpConfig) {
  const interpolatedHtml = interpolate(readTemplate('welcome.html'), {
    FIRST_NAME: account.first_name,
    LAST_NAME: account.last_name
  });
  const html = interpolatedHtml.replace(
    /(<a href=")https:\/\/cardsequel\.cc("[^>]*>Unsubscribe<\/a>)/,
    (match, prefix, suffix) => `${prefix}${escapeHtml(unsubscribeUrl)}${suffix}`
  );
  if (html === interpolatedHtml) {
    throw new Error('The welcome email template does not contain an unsubscribe link.');
  }
  return sendEmail({
    smtpConfig,
    to: account.email,
    subject: 'Welcome to Cardsequel',
    html,
    text: `Welcome to Cardsequel.\n\nUnsubscribe: ${unsubscribeUrl}`
  });
}

function sendPasswordResetEmail(account, resetUrl, smtpConfig) {
  const html = interpolate(readTemplate('password-reset.html'), {
    RESET_PASSWORD_URL: resetUrl
  });
  return sendEmail({
    smtpConfig,
    to: account.email,
    subject: 'Reset your Cardsequel password',
    html,
    text: `Use this link to reset your Cardsequel password: ${resetUrl}`
  });
}

module.exports = {
  validateSmtpConfig,
  validateSiteUrl,
  sendWelcomeEmail,
  sendPasswordResetEmail
};
