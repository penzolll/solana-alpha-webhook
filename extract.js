const { WSOL } = require('./config');

/**
 * Extract mints from Helius transactionSubscribe payload
 * Supports Create + Buy + Sell
 */
function extractMintsFromTx(txData) {
  const mints = new Set();

  try {
    const meta = txData?.transaction?.meta || txData?.meta || {};
    const logs = meta.logMessages || [];
    const logText = logs.join(' ').toLowerCase();

    const isCreate =
      logText.includes('instruction: create') ||
      logText.includes('program log: instruction: create') ||
      logText.includes('initializemint2') ||
      logText.includes('initializemint');

    const isBuy =
      logText.includes('instruction: buy') ||
      logText.includes('program log: instruction: buy');

    const isSell =
      logText.includes('instruction: sell') ||
      logText.includes('program log: instruction: sell');

    // Ambil dari token balances
    const balances = [
      ...(meta.preTokenBalances || []),
      ...(meta.postTokenBalances || [])
    ];

    for (const b of balances) {
      if (b.mint && b.mint !== WSOL) {
        mints.add(b.mint);
      }
    }

    // Fallback: coba dari accountKeys (kadang mint ada di sana)
    if (mints.size === 0) {
      const message = txData?.transaction?.transaction?.message || txData?.transaction?.message;
      const keys = message?.accountKeys || [];
      for (const key of keys) {
        const pubkey = typeof key === 'string' ? key : key?.pubkey;
        if (pubkey && pubkey !== WSOL && pubkey.length >= 32 && pubkey.length <= 44) {
          // Jangan langsung ambil semua, hanya sebagai fallback terakhir
        }
      }
    }

    if (!isCreate && !isBuy && !isSell) {
      return { mints: [], isCreate: false, isBuy: false, isSell: false };
    }

    if (mints.size > 0) {
      console.log(`[Extract] Create=${isCreate} Buy=${isBuy} Sell=${isSell} → ${[...mints].join(', ')}`);
    }

    return {
      mints: [...mints],
      isCreate,
      isBuy,
      isSell
    };
  } catch (e) {
    console.error('Extract error:', e.message);
    return { mints: [], isCreate: false, isBuy: false, isSell: false };
  }
}

module.exports = { extractMintsFromTx };
