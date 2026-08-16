module.exports = {
  // Server
  PORT: process.env.PORT || 3000,
  AUTH_HEADER: process.env.AUTH_HEADER || 'supersecret123',

  // Telegram
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID,

  // Filter Early Entry
  MAX_AGE_MINUTES: 25,
  MAX_MCAP: 100000,
  MIN_LIQ: 2500,
  MAX_LIQ: 70000,
  MIN_VOL24: 4000,
  MIN_SCORE: 55,

  // Sell Pressure Filter
  MIN_BUY_PRESSURE_5M: 0.42, // Skip jika Buy% 5m di bawah ini (saat age < 15m)
  EARLY_AGE_FOR_SELL_CHECK: 15, // menit

  // Cache
  SEEN_TTL_MS: 1000 * 60 * 45, // 45 menit

  // RugCheck
  RUGCHECK_TIMEOUT_MS: 700,
  RUGCHECK_MAX_SCORE: 65, // Skip jika score_normalised > ini

  // WSOL
  WSOL: 'So11111111111111111111111111111111111111112'
};
