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
  });

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

        if (a.bp5m < config.MIN_BUY_PRESSURE_5M && ageMinutes < config.EARLY_AGE_FOR_SELL_CHECK) {
          console.log(`[SKIP] ${mint} - Sell pressure tinggi`);
          continue;
        }

        if (a.score < config.MIN_SCORE) continue;

        const rug = await getRugCheck(mint);
        if (rug) {
          const hasDanger = (rug.risks || []).some(r => r.level === 'danger');
          const scoreNorm = rug.score_normalised ?? 50;
          if (hasDanger || scoreNorm > config.RUGCHECK_MAX_SCORE) {
            console.log(`[SKIP] ${mint} - RugCheck danger`);
            continue;
          }
        }

        const name = pair.baseToken?.name || 'Unknown';
        const sym = pair.baseToken?.symbol || '???';
        const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
        const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
        const url = pair.url || `https://dexscreener.com/solana/${mint}`;
        const source = pair._source === 'gmgn' ? 'GMGN' : 'DexScreener';

        let label = 'EARLY';
        if (a.bp5m < 0.48) label = '⚠️ EARLY + SELL PRESSURE';
        else if (a.score >= 70) label = '🚀 ALPHA';

        let rugInfo = '🛡️ RugCheck: Data belum tersedia';
        if (rug) {
          const lpLocked = rug.lpLockedPct != null ? `${rug.lpLockedPct}%` : '—';
          const score = rug.score_normalised != null ? rug.score_normalised : '—';
          rugInfo = `🛡️ RugCheck: Score ${score} | LP Locked: ${lpLocked}`;
        }

        const txType = isCreate ? 'CREATE' : isBuy ? 'BUY' : isSell ? 'SELL' : '';

        const msgText = `
${label} · Score ${a.score} ${txType ? `| ${txType}` : ''}
📡 Source: ${source}

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()}  |  Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap).toLocaleString()}
Buy% 5m: ${Math.round(a.bp5m * 100)}%  |  Buy% 24h: ${Math.round(a.bp24 * 100)}%

${rugInfo}

🔗 <a href="${url}">Chart</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>
🔗 <a href="https://gmgn.ai/sol/token/${mint}">GMGN</a>

<code>${mint}</code>
`.trim();

        await sendTelegram(msgText);
        console.log(`[${label}] ${sym} | Age: ${ageStr} | Score: ${a.score} | Source: ${source}`);
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
