require('dotenv').config();
const fetch = require('node-fetch');

const config = require('./config');
const { extractMintsFromTx } = require('./extract');
const { analyze } = require('./analyze');
const { getDexScreenerPair } = require('./services/dexscreener');
const { getGmgnToken } = require('./services/gmgn');
const { getRugCheck } = require('./services/rugcheck');
const { sendTelegram } = require('./services/telegram');
const { isSeen } = require('./utils/cache');

async function getTokenData(mint) {
  let pair = await getDexScreenerPair(mint);
  if (pair) {
    pair._source = 'dexscreener';
    return pair;
  }

  pair = await getGmgnToken(mint);
  if (pair) {
    console.log(`[Fallback] GMGN data untuk ${mint}`);
    return pair;
  }

  return null;
}

async function connectVenum() {
  console.log('Connecting to Venum Cached API...');

  try {
    const res = await fetch(`${config.VENUM_BASE_URL}/pools/new`);
    if (!res.ok) {
      console.error(`Venum error: ${res.status}`);
      return;
    }

    const data = await res.json();
    if (!data || !Array.isArray(data)) return;

    console.log(`✅ Venum cached loaded (${data.length} pools)`);

    for (const pool of data) {
      // Detect new pool (biasanya ada tokenA/tokenB)
      let mints = [];
      if (pool.tokenA) mints.push(pool.tokenA);
      if (pool.tokenB) mints.push(pool.tokenB);

      for (const mint of mints) {
        if (isSeen(mint)) continue;

        const pair = await getTokenData(mint);
        if (!pair) continue;

        const a = analyze(pair);

        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < config.MAX_AGE_MINUTES;
        const isLowMcap = a.mcap > 0 && a.mcap < config.MAX_MCAP;
        const isDecentLiq = a.liq >= config.MIN_LIQ && a.liq <= config.MAX_LIQ;
        const hasActivity = a.vol24 > config.MIN_VOL24;

        if (!(isEarly && isLowMcap && isDecentLiq && hasActivity)) continue;

        if (a.bp5m < config.MIN_BUY_PRESSURE_5M && ageMinutes < config.EARLY_AGE_FOR_SELL_CHECK) continue;
        if (a.score < config.MIN_SCORE) continue;

        // ... (sisa filter & notifikasi Telegram sama seperti sebelumnya)
        const name = pair.baseToken?.name || 'Unknown';
        const sym = pair.baseToken?.symbol || '???';
        const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
        const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
        const urlChart = pair.url || `https://dexscreener.com/solana/${mint}`;

        let label = 'EARLY';
        if (a.bp5m < 0.48) label = '⚠️ EARLY + SELL PRESSURE';
        else if (a.score >= 70) label = '🚀 ALPHA';

        // Rest Telegram & console log sama seperti kode sebelumnya
      }
    }
  } catch (err) {
    console.error('Venum cached error:', err.message);
  }
}

// Jalankan sekali (bisa di-loop setiap 30 detik)
connectVenum();
setInterval(connectVenum, 30000); // update setiap 30 detik

console.log('Solana Alpha Venum Cached started (gratis)');
