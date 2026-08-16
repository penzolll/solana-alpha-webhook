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

if (!config.VENUM_API_KEY) {
  console.error('❌ VENUM_API_KEY belum diset di Railway');
  process.exit(1);
}

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

async function connectStream(url) {
  console.log(`Connecting to Venum SSE: ${url}`);

  const controller = new AbortController();

  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': config.VENUM_API_KEY },
      signal: controller.signal
    });

    if (!res.ok) {
      console.error(`Venum SSE error: ${res.status} ${res.statusText}`);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    console.log(`✅ Venum SSE connected (${url})`);

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            let mints = [];
            if (data.tokenA || data.tokenB) {
              mints = [data.tokenA, data.tokenB].filter(Boolean);
            } else if (data.mint) {
              mints = [data.mint];
            }

            if (mints.length === 0) continue;

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

              // Filter & notifikasi Telegram (sama seperti sebelumnya)
              const name = pair.baseToken?.name || 'Unknown';
              const sym = pair.baseToken?.symbol || '???';
              const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
              const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
              const urlChart = pair.url || `https://dexscreener.com/solana/${mint}`;

              let label = 'EARLY';
              if (a.bp5m < 0.48) label = '⚠️ EARLY + SELL PRESSURE';
              else if (a.score >= 70) label = '🚀 ALPHA';

              // ... rest Telegram & console log sama seperti kode sebelumnya
            }
          } catch (e) {
            console.error('Venum SSE parse error:', e.message);
          }
        }
      }
    }
  } catch (err) {
    console.error(`Venum SSE closed: ${err.message}`);
    setTimeout(() => connectStream(url), 5000); // reconnect otomatis
  }
}

// Jalankan
connectStream(config.VENUM_BASE_URL);
console.log('Solana Alpha Venum SSE (stream-pools) started');
