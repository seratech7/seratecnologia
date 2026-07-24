const db = require('../database/db');

function toggleMiddleware(req, res, next) {
  res.locals.toggle = function(key) {
    return db.getToggle(key) === '1';
  };
  next();
}

module.exports = { toggleMiddleware };