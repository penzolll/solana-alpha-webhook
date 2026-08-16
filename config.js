module.exports = {
  // Venum Cached API (gratis, no auth)
  VENUM_BASE_URL: 'https://api.venum.dev/v1',

  // Tidak perlu API Key untuk free
  // VENUM_API_KEY: process.env.VENUM_API_KEY,

  PUMP_FUN_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',

  // Filter sama seperti sebelumnya
  MAX_AGE_MINUTES: 25,
  MAX_MCAP: 100000,
  MIN_LIQ: 2500,
  MAX_LIQ: 70000,
  MIN_VOL24: 4000,
  MIN_SCORE: 55,
  MIN_BUY_PRESSURE_5M: 0.42,
  EARLY_AGE_FOR_SELL_CHECK: 15,

  SEEN_TTL_MS: 1000 * 60 * 45,
  RUGCHECK_TIMEOUT_MS: 700,
  RUGCHECK_MAX_SCORE: 65,
  WSOL: 'So11111111111111111111111111111111111111112',

  PING_INTERVAL_MS: 30000
};
