const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const PREFIX = 'enc:';

function getKey() {
  const secret = process.env.DATA_ENC_KEY || process.env.SESSION_ENC_KEY || process.env.AUTH_PEPPER || 'SeraTecnologia-data';
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptField(value) {
  if (value === null || value === undefined || value === '') return value;
  const str = String(value);
  if (str.startsWith(PREFIX)) return str;
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(str, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, enc, tag]).toString('base64');
}

function decryptField(value) {
  if (value === null || value === undefined) return value;
  const str = String(value);
  if (!str.startsWith(PREFIX)) return str;
  try {
    const key = getKey();
    const buf = Buffer.from(str.slice(PREFIX.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const data = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return str;
  }
}

function encryptSale(sale) {
  if (!sale) return sale;
  if (sale.buyer_document !== undefined) sale.buyer_document = encryptField(sale.buyer_document);
  if (sale.buyer_address !== undefined) sale.buyer_address = encryptField(sale.buyer_address);
  return sale;
}

function decryptSale(sale) {
  if (!sale) return sale;
  if (sale.buyer_document !== undefined) sale.buyer_document = decryptField(sale.buyer_document);
  if (sale.buyer_address !== undefined) sale.buyer_address = decryptField(sale.buyer_address);
  return sale;
}

module.exports = { encryptField, decryptField, encryptSale, decryptSale };
