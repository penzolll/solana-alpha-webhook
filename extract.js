const { WSOL } = require('./config');

/**
 * Extract mint addresses from raw Helius transaction
 * Supports: Create + Buy + Sell
 */
function extractMintsFromRaw(tx) {
  const mints = new Set();

  const logs = tx?.meta?.logMessages || [];
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

  // Ambil mint dari token balances
  const balances = [
    ...(tx?.meta?.preTokenBalances || []),
    ...(tx?.meta?.postTokenBalances || [])
  ];

  for (const b of balances) {
    if (b.mint && b.mint !== WSOL) {
      mints.add(b.mint);
    }
  }

  // Hanya proses jika Create / Buy / Sell
  if (!isCreate && !isBuy && !isSell) {
    return [];
  }

  if (mints.size > 0) {
    console.log(`[Extract] Create=${isCreate} Buy=${isBuy} Sell=${isSell} → ${[...mints].join(', ')}`);
  }

  return [...mints];
}

module.exports = { extractMintsFromRaw };
