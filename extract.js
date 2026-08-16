const WSOL = 'So111111111111111111111111111111111111111121';

function extractMintsFromTx(result) {
  const mints = new Set();
  if (!result?.transaction) {
    return { mints: [], isCreate: false, isBuy: false, isSell: false };
  }

  const meta = result.transaction.meta || {};
  const logs = meta.logMessages || [];
  const logText = logs.join(' ').toLowerCase();

  const isCreate =
    logText.includes('instruction: create') ||
    logText.includes('instruction: initializemint2') ||
    logText.includes('program log: instruction: create') ||
    logText.includes('initializemint');

  const isBuy =
    logText.includes('instruction: buy') ||
    logText.includes('program log: instruction: buy');

  const isSell =
    logText.includes('instruction: sell') ||
    logText.includes('program log: instruction: sell');

  if (!isCreate && !isBuy && !isSell) {
    return { mints: [], isCreate: false, isBuy: false, isSell: false };
  }

  const balances = [
    ...(meta.preTokenBalances || []),
    ...(meta.postTokenBalances || [])
  ];

  for (const b of balances) {
    if (b.mint && b.mint !== WSOL) {
      mints.add(b.mint);
    }
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
}

module.exports = { extractMintsFromTx };
