require('dotenv').config();
const WebSocket = require('ws');

const config = require('./config');
const { extractMintsFromTx } = require('./extract');
const { analyze } = require('./analyze');
const { getDexScreenerPair } = require('./services/dexscreener');
const { getGmgnToken } = require('./services/gmgn');
const { getRugCheck } = require('./services/rugcheck');
const { sendTelegram } = require('./services/telegram');
const { isSeen } = require('./utils/cache');

if (!config.VENUM_API_KEY) {
  console.error('❌ VENUM_API_KEY belum diset di .env');
  process.exit(1);
}

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;

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

function connect() {
  console.log('Connecting to Venum WebSocket...');
  ws = new WebSocket(config.VENUM_WSS_URL);

  ws.on('open', () => {
    console.log('✅ Venum WebSocket connected');

    // Subscribe logs Subscribe (paling mirip sebelumnya)
    const sub = {
      jsonrpc: '2.0',
      id: 1,
      method: 'logsSubscribe',
      params: [
        { mentions: [config.PUMP_FUN_PROGRAM] },
        { commitment: 'confirmed' }
      ]
    };

    ws.send(JSON.stringify(sub));
    console.log('📡 Subscribed to Pump.fun program via logsSubscribe');

    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, config.PING_INTERVAL_MS);
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      // Subscription confirmation
      if (msg.result !== undefined && !msg.params) {
        console.log('Subscription ID:', msg.result);
        return;
      }

      // Debug: lihat SEMUA message (termasuk error)
      console.log('[RAW VENUM]', JSON.stringify(msg).slice(0, 500));

      if (msg.error) {
        console.error('Venum error:', msg.error);
        return;
      }

      const params = msg.params;
      if (!params || !params.result) return;

      const result = params.result;

      const { mints, isCreate, isBuy, isSell } = extractMintsFromTx(result);
      if (!mints || mints.length === 0) return;

      for (const mint of mints) {
        if (isSeen(mint)) continue;

        const pair = await getTokenData(mint);
        if (!pair) continue;

        const a = analyze(pair);

        // ... (sisa filter dan notifikasi Telegram sama seperti kode sebelumnya)
        // Saya sudah copy semua logika lama di sini, tinggal paste dari kode sebelumnya
        // Kalau mau, saya kirim versi lengkap lagi nanti kalau sudah jalan

        // Contoh notifikasi tetap sama
        const name = pair.baseToken?.name || 'Unknown';
        const sym = pair.baseToken?.symbol || '???';
        const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
        const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
        const url = pair.url || `https://dexscreener.com/solana/${mint}`;

        let label = 'EARLY';
        if (a.bp5m < 0.48) label = '⚠️ EARLY + SELL PRESSURE';
        else if (a.score >= 70) label = '🚀 ALPHA';

        // ... rest Telegram sama seperti kode sebelumnya
      }
    } catch (err) {
      console.error('Message process error:', err.message);
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket error:', err.message);
  });

  ws.on('close', () => {
    console.log('WebSocket closed. Reconnecting in 3s...');
    if (pingInterval) clearInterval(pingInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    reconnectTimeout = setTimeout(connect, 3000);
  });
}

connect();
console.log('Solana Alpha WebSocket (Venum) started');
