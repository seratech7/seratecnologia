const http = require('http');
const https = require('https');
const crypto = require('crypto');
const db = require('../database/db');

const XMR_ATOMIC = 1000000000000n;

// ============ WALLET RPC REAL (monero-wallet-rpc) ============
class MoneroWalletRpc {
  constructor() {
    this.url = process.env.MONERO_RPC_URL || 'http://127.0.0.1:18082/json_rpc';
    this.username = process.env.MONERO_RPC_USERNAME || '';
    this.password = process.env.MONERO_RPC_PASSWORD || '';
  }

  _parseUrl() {
    const u = new URL(this.url);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? https : http;
    return { lib, u };
  }

  async _call(method, params = {}) {
    const { lib, u } = this._parseUrl();
    const payload = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params });
    const headers = { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) };
    if (this.username) {
      headers['Authorization'] = 'Basic ' + Buffer.from(this.username + ':' + this.password).toString('base64');
    }
    return new Promise((resolve, reject) => {
      const req = lib.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 18082),
        path: u.pathname || '/json_rpc',
        method: 'POST',
        headers,
        timeout: 30000
      }, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || JSON.stringify(json.error)));
            resolve(json.result || {});
          } catch (e) { reject(new Error('Resposta inválida do wallet-rpc: ' + data.slice(0, 200))); }
        });
      });
      req.on('timeout', () => { req.destroy(new Error('Timeout no wallet-rpc')); });
      req.on('error', reject);
      req.write(payload);
      req.end();
    });
  }

  async getPrimaryAddress() {
    const r = await this._call('get_address');
    return r.address || null;
  }

  async getBalance() {
    const r = await this._call('get_balance');
    return { balance: r.balance || 0, unlocked: r.unlocked_balance || 0, blocks: r.blocks_to_unlock || 0 };
  }

  async createAddress(label) {
    const r = await this._call('create_address', { label: label || '', account_index: 0 });
    return { address: r.address, address_index: r.address_index };
  }

  // Retorna transferências recebidas (depósitos) com endereço interno
  async getIncomingTransfers() {
    const r = await this._call('incoming_transfers', { transfer_type: 'all', account_index: 0 });
    const transfers = (r.transfers || []).map((t) => ({
      txid: t.tx_hash,
      amount: String(t.amount),
      address_index: t.subaddr_index,
      confirmations: t.confirmations
    }));
    return transfers;
  }

  async getTransfersIn() {
    const r = await this._call('get_transfers', { in: true, account_index: 0 });
    return (r.in || []).map((t) => ({
      txid: t.txid,
      amount: String(t.amount),
      address_index: t.subaddr_index,
      confirmations: t.confirmations,
      height: t.height
    }));
  }

  async validateAddress(address) {
    const r = await this._call('validate_address', { address });
    return !!(r && r.valid);
  }

  // Envia XMR da conta-mestra
  async transfer(destinations, options = {}) {
    const r = await this._call('transfer', {
      destinations,
      priority: options.priority || 1,
      fee: options.fee || undefined,
      do_not_relay: options.do_not_relay || false,
      get_tx_key: true
    });
    return { txid: r.tx_hash, fee: r.fee };
  }

  async rescanBlockchain() {
    await this._call('rescan_blockchain');
  }
}

// ============ WALLET MOCK (modo demonstração, sem node) ============
class MockMoneroWallet {
  constructor() {
    this.prefix = process.env.MOCK_ADDRESS_PREFIX || '4ADoMock';
  }

  // Gera um endereço determinístico e "parecido" com XMR para fins de demonstração
  _fakeAddress(seed) {
    const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    const hash = crypto.createHash('sha256').update(seed).digest();
    let addr = '4';
    for (let i = 0; i < 94; i++) {
      addr += base58[hash[i % hash.length] % base58.length];
    }
    return addr;
  }

  async getPrimaryAddress() {
    return this._fakeAddress('primary');
  }

  async getBalance() {
    const total = db.sumConfirmedDeposits();
    const held = db.sumHeld();
    const withdrawals = db.sumTransactionsByType('withdraw');
    const balance = (BigInt(total) + BigInt(held) - BigInt(withdrawals || '0')).toString();
    return { balance: balance > 0 ? balance : 0, unlocked: balance > 0 ? balance : 0, blocks: 0 };
  }

  async createAddress(label) {
    return { address: this._fakeAddress(label + '_' + Date.now()), address_index: 0 };
  }

  async getIncomingTransfers() {
    const mock = db.getMockTransfers();
    const result = [];
    for (const t of mock) {
      result.push({ txid: t.txid, amount: t.amount_atomic, address_index: 0, confirmations: t.confirmations });
    }
    return result;
  }

  async getTransfersIn() {
    return this.getIncomingTransfers();
  }

  async validateAddress(address) {
    return typeof address === 'string' && address.length >= 90 && /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/.test(address);
  }

  async transfer(destinations, options = {}) {
    const txid = 'mock_tx_' + crypto.randomBytes(16).toString('hex');
    return { txid, fee: '20000000000' };
  }

  async rescanBlockchain() {
    db.incrementMockConfirmations();
    return true;
  }
}

function withdrawardsSafe(x) { return x || '0'; }

async function createWallet() {
  const mode = (process.env.WALLET_MODE || 'mock').toLowerCase();
  if (mode === 'live') {
    return new MoneroWalletRpc();
  }
  return new MockMoneroWallet();
}

module.exports = { createWallet, MoneroWalletRpc, MockMoneroWallet, XMR_ATOMIC };