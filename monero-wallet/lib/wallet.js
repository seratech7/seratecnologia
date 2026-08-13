const { createWallet } = require('./monero-rpc');

let wallet = null;

async function getWallet() {
  if (!wallet) {
    wallet = await createWallet();
  }
  return wallet;
}

module.exports = { getWallet };