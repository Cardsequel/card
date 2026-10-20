const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

const logoDataUri = `data:image/png;base64,${fs.readFileSync(
  path.join(__dirname, '../assets/assets/images/logo.png')
).toString('base64')}`;

async function createPaymentQr(address, width = 320) {
  const svg = await QRCode.toString(address, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 4,
    width,
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox) {
    throw new Error('Generated payment QR code did not contain a valid viewBox.');
  }

  const qrWidth = Number(viewBox[1]);
  const qrHeight = Number(viewBox[2]);
  const logoSize = Math.min(qrWidth, qrHeight) * 0.19;
  const backingSize = logoSize + Math.min(qrWidth, qrHeight) * 0.08;
  const logoX = (qrWidth - logoSize) / 2;
  const logoY = (qrHeight - logoSize) / 2;
  const backingX = (qrWidth - backingSize) / 2;
  const backingY = (qrHeight - backingSize) / 2;
  const brandedSvg = svg.replace(
    '</svg>',
    '<defs><filter id="black-logo" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0"/></filter></defs>' +
    `<rect x="${backingX}" y="${backingY}" width="${backingSize}" height="${backingSize}" rx="1.5" fill="#ffffff"/>` +
    `<image x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" href="${logoDataUri}" filter="url(#black-logo)" preserveAspectRatio="xMidYMid meet"/></svg>`
  );

  return `data:image/svg+xml;base64,${Buffer.from(brandedSvg).toString('base64')}`;
}

module.exports = { createPaymentQr };
