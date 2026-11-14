const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const nodemailer = require('nodemailer');

function usage() {
  return 'Usage: node scripts/send-bulk-email.js <recipients.txt> <design.html> <subject>';
}

function readRecipients(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const recipients = new Map();
  const invalidLines = [];

  lines.forEach((line, index) => {
    const email = line.trim();
    if (!email) return;
    if (
      email.length > 254 ||
      /[\r\n]/.test(email) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      invalidLines.push(index + 1);
      return;
    }
    recipients.set(email.toLowerCase(), email);
  });

  if (invalidLines.length) {
    throw new Error(`Invalid email address on line(s): ${invalidLines.join(', ')}.`);
  }
  if (!recipients.size) {
    throw new Error('The recipient list contains no email addresses.');
  }
  return [...recipients.values()];
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function validateSmtpConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const email = (process.env.SMTP_EMAIL || '').trim();
  const password = process.env.SMTP_PASSWORD || '';
  const portValue = process.env.SMTP_PORT || '';
  const secureValue = process.env.SMTP_SECURE;

  if (!host || host.length > 253 || /\s|[\/\\]/.test(host)) {
    throw new Error('Enter a valid SMTP host using SMTP_HOST.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || /[\r\n]/.test(email)) {
    throw new Error('Enter a valid SMTP email address using SMTP_EMAIL.');
  }
  if (!password || password.length > 1024 || /[\r\n\0]/.test(password)) {
    throw new Error('Enter a valid SMTP password using SMTP_PASSWORD.');
  }
  if (!/^\d{1,5}$/.test(portValue)) {
    throw new Error('Enter a valid SMTP port using SMTP_PORT.');
  }
  const port = Number(portValue);
  if (port < 1 || port > 65535) {
    throw new Error('Enter a valid SMTP port using SMTP_PORT.');
  }
  if (secureValue !== 'true' && secureValue !== 'false') {
    throw new Error('Set SMTP_SECURE to true or false.');
  }

  return { host, email, password, port, secure: secureValue === 'true' };
}

function validateSiteUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('Set SITE_URL to the public site origin, such as https://example.com.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Set SITE_URL to the public site origin only, without a path.');
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

function createHtml(htmlTemplate, unsubscribeUrl) {
  const placeholder = '{{UNSUBSCRIBE_URL}}';
  const safeUrl = escapeHtml(unsubscribeUrl);
  if (htmlTemplate.includes(placeholder)) {
    return htmlTemplate.split(placeholder).join(safeUrl);
  }

  let updatedUnsubscribeLink = false;
  const htmlWithUpdatedLink = htmlTemplate.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, anchor => {
    if (!/unsubscribe/i.test(anchor.replace(/<[^>]*>/g, ' '))) {
      return anchor;
    }

    const updatedAnchor = anchor.replace(
      /\bhref\s*=\s*(["'])[^"']*\1/i,
      `href="${safeUrl}"`
    );
    if (updatedAnchor !== anchor) {
      updatedUnsubscribeLink = true;
    }
    return updatedAnchor;
  });
  if (updatedUnsubscribeLink) {
    return htmlWithUpdatedLink;
  }

  return `${htmlTemplate}\n<div style="margin-top:24px;text-align:center;font:12px Arial,sans-serif;color:#666;">` +
    `<a href="${safeUrl}" style="color:inherit;">Unsubscribe</a></div>`;
}

function createText(html, unsubscribeUrl) {
  const body = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return `${body}\n\nUnsubscribe: ${unsubscribeUrl}`;
}

function smtpConfigFromEnvironment() {
  return validateSmtpConfig();
}

function requestUnsubscribeUrl(siteUrl, email, apiKey) {
  const endpoint = new URL('/users/api/unsubscribe-token', siteUrl);
  const body = new URLSearchParams({ email }).toString();
  const transport = endpoint.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        let result;
        try {
          result = JSON.parse(responseBody);
        } catch (error) {
          reject(new Error(`Unsubscribe-token API returned invalid JSON (HTTP ${response.statusCode}).`));
          return;
        }

        if (response.statusCode === 409 && result.alreadyUnsubscribed === true) {
          resolve({ alreadyUnsubscribed: true });
          return;
        }
        if (response.statusCode !== 200 || typeof result.unsubscribeUrl !== 'string') {
          reject(new Error(`Unsubscribe-token API request failed (HTTP ${response.statusCode}).`));
          return;
        }
        resolve({ unsubscribeUrl: result.unsubscribeUrl });
      });
    });

    request.setTimeout(15000, () => {
      request.destroy(new Error('Unsubscribe-token API request timed out.'));
    });
    request.on('error', reject);
    request.end(body);
  });
}

async function sendBulkEmail() {
  const [, , recipientPath, htmlPath, ...subjectParts] = process.argv;
  if (recipientPath === '--help' || recipientPath === '-h') {
    console.log(usage());
    return;
  }
  const subject = subjectParts.join(' ').trim();
  if (!recipientPath || !htmlPath || !subject || /[\r\n]/.test(subject) || subject.length > 998) {
    throw new Error(usage());
  }
  const recipients = readRecipients(path.resolve(recipientPath));
  const htmlTemplate = fs.readFileSync(path.resolve(htmlPath), 'utf8');
  if (!htmlTemplate.trim()) {
    throw new Error('The HTML email design is empty.');
  }
  const smtpConfig = smtpConfigFromEnvironment();
  const siteUrl = validateSiteUrl(process.env.SITE_URL || 'https://cardsequel.cc');
  const apiKey = process.env.BULK_EMAIL_API_KEY || '';
  if (apiKey.length < 32 || apiKey.length > 1024 || /[\r\n\0]/.test(apiKey)) {
    throw new Error('Set BULK_EMAIL_API_KEY to the protected API key configured on the server.');
  }

  const transporter = createTransporter(smtpConfig);
  let sent = 0;
  let suppressed = 0;

  try {
    for (const email of recipients) {
      const tokenResponse = await requestUnsubscribeUrl(siteUrl, email, apiKey);
      if (tokenResponse.alreadyUnsubscribed) {
        suppressed += 1;
        console.log(`Skipped unsubscribed address: ${email}`);
        continue;
      }

      const unsubscribeUrl = tokenResponse.unsubscribeUrl;
      const html = createHtml(htmlTemplate, unsubscribeUrl);
      const text = createText(html, unsubscribeUrl);

      await transporter.sendMail({
        from: { name: 'Cardsequel', address: smtpConfig.email },
        to: email,
        subject,
        html,
        text,
        headers: {
          'List-Unsubscribe': `<${unsubscribeUrl}>`
        }
      });

      sent += 1;
      console.log(`Sent to ${email}`);
    }

    console.log(`Finished: ${sent} sent, ${suppressed} unsubscribed address(es) skipped.`);
  } finally {
    transporter.close();
  }
}

sendBulkEmail().catch(error => {
  console.error(`Bulk email failed: ${error.message}`);
  process.exitCode = 1;
});
