function normalizeAmount(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const raw = String(value).trim();
  if (raw === '') {
    return null;
  }

  const negative = raw.startsWith('(') && raw.endsWith(')');
  const unwrapped = negative ? raw.slice(1, -1).trim() : raw;

  const compacted = unwrapped
    .replace(/[\s,]/g, '')
    .replace(/[$€£¥]/g, '');

  if (!compacted) {
    return null;
  }

  const sign = compacted.startsWith('-') ? '-' : '';
  const unsigned = sign ? compacted.slice(1) : compacted;
  const withoutSign = unsigned.startsWith('+') ? unsigned.slice(1) : unsigned;

  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(withoutSign)) {
    return null;
  }

  const normalized = `${sign}${withoutSign}`;
  return negative && normalized !== '-' ? `-${normalized}` : normalized;
}

function parseAmount(value) {
  const normalized = normalizeAmount(value);
  if (normalized === null) {
    return null;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

module.exports = { normalizeAmount, parseAmount };
