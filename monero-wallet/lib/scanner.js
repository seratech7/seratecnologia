const db = require('../database/db');

async function processIncomingTransfers(wallet) {
  const minConfirmations = parseInt(db.getSetting('min_confirmations') || '10', 10);
  const addresses = db.getAllAddresses();
  const byAddress = {};
  addresses.forEach((a) => { byAddress[a.address] = a.user_id; });

  let transfers = [];
  try {
    transfers = await wallet.getIncomingTransfers();
  } catch (e) {
    console.error('[scanner] Erro ao buscar transferências:', e.message);
    return;
  }

  for (const t of transfers) {
    const txid = t.txid;
    const amount = String(t.amount || '0');
    const confirmations = t.confirmations || 0;

    let existing = db.getDepositByTxid(txid);
    if (!existing) {
      const user = byAddress[t.address];
      if (user) {
        const dep = db.createDeposit(user, t.address, txid, amount, confirmations);
        console.log(`[scanner] Novo depósito detectado: txid=${txid} user=${user} amount=${amount} conf=${confirmations}`);
        existing = dep;
      } else {
        continue;
      }
    }

    if (existing.status === 'pending') {
      db.updateDepositConfirmations(existing.id, confirmations);
      if (confirmations >= minConfirmations) {
        db.confirmDeposit(existing.id, existing.user_id, existing.amount_atomic);
        console.log(`[scanner] Depósito confirmado e creditado: user=${existing.user_id} amount=${existing.amount_atomic}`);
      }
    }
  }
}

function startScanner(wallet, intervalSeconds) {
  const interval = intervalSeconds || parseInt(process.env.SCAN_INTERVAL_SECONDS || '20', 10);
  const run = () => processIncomingTransfers(wallet).catch((e) => console.error('[scanner] Erro:', e.message));
  run();
  const timer = setInterval(run, interval * 1000);
  timer.unref && timer.unref();
  return timer;
}

module.exports = { startScanner, processIncomingTransfers };