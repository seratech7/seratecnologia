const SECRET_ADMIN = (process.env.ADMIN_PATH || '/admin').replace(/\/+$/, '');
const SITE_NAME = process.env.SITE_NAME || 'MoneroWallet';
const SITE_URL = process.env.SITE_URL || 'http://localhost:3001';

module.exports = { SECRET_ADMIN, SITE_NAME, SITE_URL };