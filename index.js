require('dotenv').config();
const WebSocket = require('ws');

const config = require('./config');
const { extractMintsFromTx } = require('./extract');
const { analyze } = require('./analyze');
const { getDexScreenerPair } = require('./services/dexscreener');
const { getRugCheck } = require('./services/rugcheck');
const { sendTelegram } = require('./services/telegram');
const { isSeen } = require('./utils/cache');

if (!config.HELIUS_API_KEY) {
  console.error('❌ HELIUS_API_KEY belum diset di .env');
  process.exit(1);
}

let ws = null;
let pingInterval = null;
let reconnectTimeout = null;

function connect() {
  console.log('Connecting to Helius WebSocket...');
  ws = new WebSocket(config.WS_URL);

  ws.on('open', () => {
    console.log('✅ WebSocket connected');

    // Subscribe ke Pump.fun bonding curve
    const subscribeMsg = {
      jsonrpc: '2.0',
      id: 1,
      method: 'transactionSubscribe',
      params: [
        {
          failed: false,
          accountInclude: [config.PUMP_FUN_PROGRAM]
        },
        {
          commitment: 'confirmed',
          encoding: 'jsonParsed',
          transactionDetails: 'full',
          maxSupportedTransactionVersion: 0
        }
      ]
    };

    ws.send(JSON.stringify(subscribeMsg));
    console.log('📡 Subscribed to Pump.fun program:', config.PUMP_FUN_PROGRAM);

    // Keep-alive ping
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
      if (msg.result && typeof msg.result === 'number') {
        console.log('Subscription ID:', msg.result);
        return;
      }

      // Actual transaction data
      const result = msg.params?.result;
      if (!result) return;

      const { mints, isCreate, isBuy, isSell } = extractMintsFromTx(result);
      if (mints.length === 0) return;

      for (const mint of mints) {
        if (isSeen(mint)) continue;

        // DexScreener
        const pair = await getDexScreenerPair(mint);
        if (!pair) continue;

        const a = analyze(pair);

        // Filter dasar
        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < config.MAX_AGE_MINUTES;
        const isLowMcap = a.mcap > 0 && a.mcap < config.MAX_MCAP;
        const isDecentLiq = a.liq >= config.MIN_LIQ && a.liq <= config.MAX_LIQ;
        const hasActivity = a.vol24 > config.MIN_VOL24;

        if (!(isEarly && isLowMcap && isDecentLiq && hasActivity)) continue;

        // Filter Sell Pressure di early
        if (a.bp5m < config.MIN_BUY_PRESSURE_5M && ageMinutes < config.EARLY_AGE_FOR_SELL_CHECK) {
          console.log(`[SKIP] ${mint} - Sell pressure tinggi`);
          continue;
        }

        if (a.score < config.MIN_SCORE) continue;

        // RugCheck
        const rug = await getRugCheck(mint);
        if (rug) {
          const hasDanger = (rug.risks || []).some(r => r.level === 'danger');
          const scoreNorm = rug.score_normalised ?? 50;
          if (hasDanger || scoreNorm > config.RUGCHECK_MAX_SCORE) {
            console.log(`[SKIP] ${mint} - RugCheck danger`);
            continue;
          }
        }

        // ========== KIRIM NOTIFIKASI ==========
        const name = pair.baseToken?.name || 'Unknown';
        const sym = pair.baseToken?.symbol || '???';
        const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
        const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
        const url = pair.url || `https://dexscreener.com/solana/${mint}`;

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

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()}  |  Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap).toLocaleString()}
Buy% 5m: ${Math.round(a.bp5m * 100)}%  |  Buy% 24h: ${Math.round(a.bp24 * 100)}%

${rugInfo}

🔗 <a href="${url}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

<code>${mint}</code>
`.trim();

        await sendTelegram(msgText);
        console.log(`[${label}] ${sym} | Age: ${ageStr} | Score: ${a.score} | Buy5m: ${Math.round(a.bp5m * 100)}%`);
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

// Start
connect();

console.log('Solana Alpha WebSocket (transactionSubscribe) started');
