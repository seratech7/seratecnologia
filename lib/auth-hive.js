const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database/db');

const PEPPER = process.env.AUTH_PEPPER || crypto.randomBytes(32).toString('hex');
const SESSION_ENC_KEY = crypto.createHash('sha256').update(process.env.SESSION_ENC_KEY || crypto.randomBytes(32).toString('hex')).digest();
const DEVICE_ID_COOKIE = '__device_id';
const SESSION_COOKIE_PREFIX = '__Host-';

const ARGON2_MEMORY = 65536;
const ARGON2_ITERATIONS = 3;
const ARGON2_PARALLELISM = 4;
const SALT_LENGTH = 16;
const TOKEN_LENGTH = 32;
const SESSION_TTL_INACTIVE = 15 * 60 * 1000;
const SESSION_TTL_ABSOLUTE = 7 * 24 * 60 * 60 * 1000;
const DEVICE_ID_BYTES = 16;

let argon2 = null;
try {
  argon2 = require('argon2');
} catch (e) {
  console.warn('[AuthHive] argon2 not available, falling back to bcrypt+pepper');
}

function getPepper() {
  return PEPPER;
}

function hashPasswordWithPepper(password) {
  const hmac = crypto.createHmac('sha256', PEPPER);
  hmac.update(password);
  return hmac.digest();
}

function hashPassword(password) {
  const peppered = hashPasswordWithPepper(password);
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  if (argon2) {
    return argon2.hash(peppered, {
      type: argon2.argon2id,
      memoryCost: ARGON2_MEMORY,
      timeCost: ARGON2_ITERATIONS,
      parallelism: ARGON2_PARALLELISM,
      salt: salt,
      hashLength: 32,
      raw: false
    });
  }
  
  const bcryptHash = bcrypt.hashSync(peppered.toString('base64'), 12);
  return `$argon2id$v=19$m=${ARGON2_MEMORY},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}$${salt.toString('base64')}$${bcryptHash}`;
}

async function verifyPassword(password, storedHash) {
  const peppered = hashPasswordWithPepper(password);
  
  if (storedHash.startsWith('$argon2id$') || storedHash.startsWith('$argon2i$') || storedHash.startsWith('$argon2d$')) {
    if (argon2) {
      try {
        return await argon2.verify(storedHash, peppered);
      } catch (e) {
        return false;
      }
    }
    const parts = storedHash.split('$');
    if (parts.length >= 6) {
      const salt = Buffer.from(parts[4], 'base64');
      const bcryptHash = parts[5];
      const derived = crypto.pbkdf2Sync(peppered, salt, ARGON2_ITERATIONS * 1000, 32, 'sha256');
      return crypto.timingSafeEqual(Buffer.from(bcryptHash, 'base64'), derived);
    }
    return false;
  }
  
  if (storedHash.startsWith('$2a$') || storedHash.startsWith('$2b$') || storedHash.startsWith('$2y$')) {
    const match = bcrypt.compareSync(peppered.toString('base64'), storedHash);
    if (match && argon2) {
      const newHash = await hashPassword(password);
      return { verified: true, needsRehash: true, newHash };
    }
    return { verified: match, needsRehash: false };
  }
  
  return { verified: false, needsRehash: false };
}

function generateFakeHash() {
  const fakeSalt = crypto.randomBytes(SALT_LENGTH);
  const fakeHash = bcrypt.hashSync(crypto.randomBytes(32).toString('base64'), 12);
  return `$argon2id$v=19$m=${ARGON2_MEMORY},t=${ARGON2_ITERATIONS},p=${ARGON2_PARALLELISM}$${fakeSalt.toString('base64')}$${fakeHash}`;
}

function generateSessionToken() {
  return crypto.randomBytes(TOKEN_LENGTH);
}

function hashSessionToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function generateDeviceId() {
  return crypto.randomBytes(DEVICE_ID_BYTES).toString('hex');
}

function hashUserAgent(userAgent) {
  return crypto.createHash('sha256').update(userAgent || '').digest('hex').substring(0, 32);
}

function getIpZone(ip) {
  if (!ip) return 'unknown';
  const parts = ip.split('.');
  if (parts.length === 4) {
    return parts.slice(0, 3).join('.') + '.0/24';
  }
  if (ip.includes(':')) {
    const ipv6Parts = ip.split(':');
    return ipv6Parts.slice(0, 4).join(':') + '::/64';
  }
  return 'unknown';
}

function checkSessionBinding(session, req) {
  const currentUaHash = hashUserAgent(req.get('User-Agent'));
  const currentIpZone = getIpZone(req.ip || req.connection.remoteAddress || '');
  
  if (session.ua_hash !== currentUaHash) return false;
  if (session.ip_zone !== currentIpZone) return false;
  return true;
}

function encryptSessionData(data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_ENC_KEY, iv);
  const plaintext = JSON.stringify(data);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

function decryptSessionData(encrypted) {
  try {
    const buf = Buffer.from(encrypted, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_ENC_KEY, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (e) {
    return null;
  }
}

function createSessionCookieOptions(req) {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_TTL_ABSOLUTE
  };
}

function createDeviceCookieOptions(req) {
  const isProduction = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 365 * 24 * 60 * 60 * 1000
  };
}

function getOrCreateDeviceId(req, res) {
  let deviceId = req.cookies?.[DEVICE_ID_COOKIE];
  if (!deviceId) {
    deviceId = generateDeviceId();
    res.cookie(DEVICE_ID_COOKIE, deviceId, createDeviceCookieOptions(req));
  }
  return deviceId;
}

function setSessionCookie(res, token, req) {
  const cookieName = SESSION_COOKIE_PREFIX + 'session';
  res.cookie(cookieName, token.toString('hex'), createSessionCookieOptions(req));
}

function clearSessionCookie(res) {
  const cookieName = SESSION_COOKIE_PREFIX + 'session';
  res.clearCookie(cookieName, { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
}

function setDeviceCookie(res, deviceId, req) {
  res.cookie(DEVICE_ID_COOKIE, deviceId, createDeviceCookieOptions(req));
}

function clearDeviceCookie(res) {
  res.clearCookie(DEVICE_ID_COOKIE, { path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
}

function generateRecoveryCodes(count = 10) {
  const codes = [];
  for (let i = 0; i < count; i++) {
    codes.push(crypto.randomBytes(8).toString('hex').toUpperCase());
  }
  return codes;
}

function hashRecoveryCodes(codes) {
  return codes.map(code => crypto.createHash('sha256').update(code).digest('hex')).join(',');
}

function verifyRecoveryCode(inputCode, storedHashes) {
  const inputHash = crypto.createHash('sha256').update(inputCode.toUpperCase()).digest('hex');
  const hashes = storedHashes.split(',').filter(h => h);
  return hashes.some(h => crypto.timingSafeEqual(Buffer.from(h), Buffer.from(inputHash)));
}

function removeRecoveryCode(usedCode, storedHashes) {
  const usedHash = crypto.createHash('sha256').update(usedCode.toUpperCase()).digest('hex');
  const hashes = storedHashes.split(',').filter(h => h && !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(usedHash)));
  return hashes.join(',');
}

function generateTotpSecret() {
  return crypto.randomBytes(20).toString('base32').replace(/=/g, '');
}

function encryptMfaSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_ENC_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]).toString('base64');
}

function decryptMfaSecret(encrypted) {
  try {
    const buf = Buffer.from(encrypted, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(buf.length - 16);
    const ciphertext = buf.subarray(12, buf.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_ENC_KEY, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, 'binary', 'utf8') + decipher.final('utf8');
  } catch (e) {
    return null;
  }
}

function verifyTotp(token, secret) {
  if (!secret) return false;
  const epoch = Math.floor(Date.now() / 30000);
  for (let i = -1; i <= 1; i++) {
    const counter = Buffer.alloc(8);
    counter.writeUInt32BE(epoch + i, 4);
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'base32'));
    hmac.update(counter);
    const hash = hmac.digest();
    const offset = hash[hash.length - 1] & 0xf;
    const code = ((hash[offset] & 0x7f) << 24) | ((hash[offset + 1] & 0xff) << 16) | ((hash[offset + 2] & 0xff) << 8) | (hash[offset + 3] & 0xff);
    const totp = (code % 1000000).toString().padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(totp), Buffer.from(token))) return true;
  }
  return false;
}

function generateTotpUri(secret, label, issuer = 'SeraTecnologia') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

async function loginUser(uid, userType, password, req, res) {
  const userAuth = db.getUserAuth(uid);
  if (!userAuth) {
    await verifyPassword(password, generateFakeHash());
    db.logAuthEvent(uid, 'login_failed', req.ip || '', req.get('User-Agent') || '', 'failure', 'user_not_found');
    return { success: false, error: 'Credenciais inválidas' };
  }
  
  const result = await verifyPassword(password, userAuth.argon_hash);
  if (!result.verified) {
    db.logAuthEvent(uid, 'login_failed', req.ip || '', req.get('User-Agent') || '', 'failure', 'invalid_password');
    return { success: false, error: 'Credenciais inválidas' };
  }
  
  if (result.needsRehash && result.newHash) {
    db.updateUserAuthHash(uid, result.newHash, userAuth.pepper_ver + 1);
  }
  
  if (userAuth.totp_enabled) {
    req.session.pendingMfaUid = uid;
    req.session.pendingMfaType = userType;
    db.logAuthEvent(uid, 'login_mfa_required', req.ip || '', req.get('User-Agent') || '', 'success', 'mfa_required');
    return { success: true, mfaRequired: true };
  }
  
  return await completeLogin(uid, userType, req, res);
}

async function completeLogin(uid, userType, req, res) {
  const deviceId = getOrCreateDeviceId(req, res);
  const uaHash = hashUserAgent(req.get('User-Agent'));
  const ipZone = getIpZone(req.ip || req.connection.remoteAddress || '');
  
  const token = generateSessionToken();
  const sidHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_ABSOLUTE).toISOString();
  
  db.createAuthSession(sidHash, uid, userType, deviceId, uaHash, ipZone, expiresAt);
  db.createAuthDevice(uid, deviceId, '', req.ip || '');
  db.logAuthEvent(uid, 'login_success', req.ip || '', req.get('User-Agent') || '', 'success', '');
  
  setSessionCookie(res, token, req);
  
  req.session.authUid = uid;
  req.session.authType = userType;
  req.session.authSidHash = sidHash;
  req.session.authDeviceId = deviceId;
  
  return { success: true };
}

function logoutUser(req, res) {
  if (req.session.authSidHash) {
    db.deleteAuthSession(req.session.authSidHash);
    if (req.session.authUid) {
      db.logAuthEvent(req.session.authUid, 'logout', req.ip || '', req.get('User-Agent') || '', 'success', '');
    }
  }
  clearSessionCookie(res);
  req.session.destroy();
}

function validateSession(req, res) {
  const cookieName = SESSION_COOKIE_PREFIX + 'session';
  const tokenHex = req.cookies?.[cookieName];
  if (!tokenHex) return null;
  
  const sidHash = hashSessionToken(Buffer.from(tokenHex, 'hex'));
  const session = db.getAuthSession(sidHash);
  if (!session) return null;
  
  if (!checkSessionBinding(session, req)) {
    db.deleteAuthSession(sidHash);
    db.logAuthEvent(session.user_uid, 'session_binding_failed', req.ip || '', req.get('User-Agent') || '', 'failure', 'binding_mismatch');
    return null;
  }
  
  const now = Date.now();
  const expiresAt = new Date(session.expires_at).getTime();
  const lastSeen = new Date(session.last_seen).getTime();
  
  if (now > expiresAt) {
    db.deleteAuthSession(sidHash);
    return null;
  }
  
  if (now - lastSeen > SESSION_TTL_INACTIVE) {
    db.deleteAuthSession(sidHash);
    db.logAuthEvent(session.user_uid, 'session_expired_inactive', req.ip || '', req.get('User-Agent') || '', 'failure', 'inactive_timeout');
    return null;
  }
  
  db.updateAuthSessionLastSeen(sidHash);
  
  return {
    uid: session.user_uid,
    userType: session.user_type,
    deviceId: session.device_id,
    sidHash: sidHash
  };
}

function requireAuth(userType) {
  return (req, res, next) => {
    const session = validateSession(req, res);
    if (!session) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.status(401).json({ error: 'Não autenticado', code: 'UNAUTHENTICATED' });
      }
      const loginPath = userType === 'admin' ? '/admin/login' : '/seller/login';
      return res.redirect(loginPath + '?redirect=' + encodeURIComponent(req.originalUrl));
    }
    
    if (userType && session.userType !== userType) {
      return res.status(403).json({ error: 'Acesso negado', code: 'FORBIDDEN' });
    }
    
    req.auth = session;
    next();
  };
}

function getSessionInfo(req) {
  if (!req.auth) return null;
  return {
    uid: req.auth.uid,
    userType: req.auth.userType,
    deviceId: req.auth.deviceId
  };
}

module.exports = {
  PEPPER,
  SESSION_ENC_KEY,
  hashPassword,
  verifyPassword,
  generateFakeHash,
  generateSessionToken,
  hashSessionToken,
  generateDeviceId,
  hashUserAgent,
  getIpZone,
  checkSessionBinding,
  encryptSessionData,
  decryptSessionData,
  createSessionCookieOptions,
  createDeviceCookieOptions,
  getOrCreateDeviceId,
  setSessionCookie,
  clearSessionCookie,
  setDeviceCookie,
  clearDeviceCookie,
  generateRecoveryCodes,
  hashRecoveryCodes,
  verifyRecoveryCode,
  removeRecoveryCode,
  generateTotpSecret,
  encryptMfaSecret,
  decryptMfaSecret,
  verifyTotp,
  generateTotpUri,
  loginUser,
  completeLogin,
  logoutUser,
  validateSession,
  requireAuth,
  getSessionInfo,
  SESSION_TTL_INACTIVE,
  SESSION_TTL_ABSOLUTE
};