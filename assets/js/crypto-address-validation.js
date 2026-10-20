const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const rippleBase58Alphabet = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz';
const bech32Alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function decodeBase58(value, alphabet) {
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) return null;
    number = number * 58n + BigInt(digit);
  }

  const bytes = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  for (let index = 0; index < value.length && value[index] === alphabet[0]; index += 1) {
    bytes.unshift(0);
  }
  return bytes;
}

async function sha256(bytes) {
  if (typeof module !== 'undefined' && module.exports) {
    return Array.from(require('crypto').createHash('sha256').update(Buffer.from(bytes)).digest());
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest));
}

async function hasValidBase58Check(value, alphabet, version) {
  const decoded = decodeBase58(value, alphabet);
  if (!decoded || decoded.length !== 25) return false;
  const payload = decoded.slice(0, 21);
  if (version !== undefined && payload[0] !== version) return false;
  const firstHash = await sha256(payload);
  const secondHash = await sha256(firstHash);
  return decoded.slice(21).every((byte, index) => byte === secondHash[index]);
}

function bech32Polymod(values) {
  const generators = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let index = 0; index < 5; index += 1) {
      if ((top >>> index) & 1) checksum ^= generators[index];
    }
  }
  return checksum >>> 0;
}

function isValidBitcoinSegwitAddress(value) {
  const address = value.toLowerCase();
  if (address !== value && value !== value.toUpperCase()) return false;
  const separator = address.lastIndexOf('1');
  if (separator < 1 || separator + 7 > address.length || address.length > 90) return false;
  const hrp = address.slice(0, separator);
  if (hrp !== 'bc') return false;

  const data = [];
  for (const character of address.slice(separator + 1)) {
    const digit = bech32Alphabet.indexOf(character);
    if (digit < 0) return false;
    data.push(digit);
  }
  const hrpExpanded = [];
  for (const character of hrp) hrpExpanded.push(character.charCodeAt(0) >> 5);
  hrpExpanded.push(0);
  for (const character of hrp) hrpExpanded.push(character.charCodeAt(0) & 31);
  const polymod = bech32Polymod(hrpExpanded.concat(data));
  if (polymod !== 1 && polymod !== 0x2bc830a3) return false;

  const witnessVersion = data[0];
  if (witnessVersion > 16) return false;
  let accumulator = 0;
  let bits = 0;
  const program = [];
  for (const digit of data.slice(1, -6)) {
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      program.push((accumulator >>> bits) & 255);
    }
  }
  if (bits >= 5 || ((accumulator << (8 - bits)) & 255) !== 0) return false;
  if (program.length < 2 || program.length > 40) return false;
  if (witnessVersion === 0 && (polymod !== 1 || ![20, 32].includes(program.length))) return false;
  return witnessVersion !== 1 || polymod === 0x2bc830a3;
}

function isValidBitcoinAddressFormat(value) {
  if (/^(bc1)[02-9ac-hj-np-z]{11,71}$/i.test(value)) {
    return isValidBitcoinSegwitAddress(value);
  }
  return hasValidBase58Check(value, base58Alphabet)
    .then(async valid => {
      if (!valid) return false;
      const decoded = decodeBase58(value, base58Alphabet);
      return decoded && [0x00, 0x05].includes(decoded[0]);
    });
}

async function isValidWalletAddress(asset, network, address) {
  if (
    typeof address !== 'string' ||
    address.length < 8 ||
    address.length > 200
  ) return false;

  const trimmedAddress = address.trim();
  if (trimmedAddress !== address) return false;

  if (asset === 'BTC' && network === 'Bitcoin') return isValidBitcoinAddressFormat(address);
  if (
    ['ETH', 'USDT', 'USDC'].includes(asset) && network === 'Ethereum' ||
    ['BNB', 'USDT', 'USDC'].includes(asset) && network === 'BNB Smart Chain'
  ) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }
  if (asset === 'USDT' && network === 'TRON') {
    return address.startsWith('T') &&
      await hasValidBase58Check(address, base58Alphabet, 0x41);
  }
  if (asset === 'USDC' && network === 'Solana') {
    const decoded = decodeBase58(address, base58Alphabet);
    return decoded !== null && decoded.length === 32;
  }
  if (asset === 'XRP' && network === 'XRP Ledger') {
    return address.startsWith('r') &&
      await hasValidBase58Check(address, rippleBase58Alphabet, 0x00);
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isValidWalletAddress };
}

if (typeof window !== 'undefined') {
  window.cryptoAddressValidation = { isValidWalletAddress };
}
