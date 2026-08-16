module.exports = {
  // Venum WebSocket
  VENUM_WSS_URL: `wss://rpc.venum.dev/?apiKey=${process.env.VENUM_API_KEY}`,

  // Pump.fun Bonding Curve
  PUMP_FUN_PROGRAM: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  // GMGN fallback
  GMGN_API_KEY: process.env.GMGN_API_KEY || 'gmgn_solbscbaseethmonadtron',

  // Filter Early Entry
  MAX_AGE_MINUTES: 25,
  MAX_MCAP: 100000,
  MIN_LIQ: 2500,
  MAX_LIQ: 70000,
  MIN_VOL24: 4000,
  MIN_SCORE: 55,

  // Sell Pressure Filter
  MIN_BUY_PRESSURE_5M: 0.42,
  EARLY_AGE_FOR_SELL_CHECK: 15,

  // Cache
  SEEN_TTL_MS: 1000 * 60 * 45,

  // RugCheck
  RUGCHECK_TIMEOUT_MS: 700,
  RUGCHECK_MAX_SCORE: 65,

  // WSOL
  WSOL: 'So11111111111111111111111111111111111111112',

  // WebSocket keep-alive
  PING_INTERVAL_MS: 15000
};
