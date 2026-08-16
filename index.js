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
  console.error('❌ VENUM_API_KEY belum diset');
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
  if (pair) return pair;

  return null;
}

function connect() {
  console.log('Connecting to Venum WebSocket...');
  ws = new WebSocket(config.VENUM_WSS_URL);

  ws.on('open', () => {
    console.log('✅ Venum WebSocket connected');

    // PROGRAM SUBSCRIBE (paling tepat untuk Pump.fun)
    const sub = {
      jsonrpc: '2.0',
      id: 1,
      method: 'programSubscribe',
      params: [
        config.PUMP_FUN_PROGRAM,
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed'
        }
      ]
    };

    ws.send(JSON.stringify(sub));
    console.log('📡 Subscribed to Pump.fun program via programSubscribe');
  });

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.result !== undefined && !msg.params) {
        console.log('Subscription ID:', msg.result);
        return;
      }

      if (msg.error) {
        console.error('Venum error:', msg.error);
        return;
      }

      const result = msg.params?.result;
      if (!result) return;

      const { mints, isCreate, isBuy, isSell } = extractMintsFromTx(result);
      if (!mints || mints.length === 0) return;

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

        // Rest Telegram & console log sama seperti kode sebelumnya
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
