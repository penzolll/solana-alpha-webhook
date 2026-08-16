require('dotenv').config();
const express = require('express');
const { WebSocket } = require('ws'); // kalau nanti mau tambah

const config = require('./config');
const { extractMintsFromTx } = require('./extract');
const { analyze } = require('./analyze');
const { getDexScreenerPair } = require('./services/dexscreener');
const { getGmgnToken } = require('./services/gmgn');
const { getRugCheck } = require('./services/rugcheck');
const { sendTelegram } = require('./services/telegram');
const { isSeen } = require('./utils/cache');

const app = express();
app.use(express.json());

if (!config.VENUM_WEBHOOK_SECRET) {
  console.error('❌ VENUM_WEBHOOK_SECRET belum diset');
  process.exit(1);
}

async function getTokenData(mint) {
  let pair = await getDexScreenerPair(mint);
  if (pair) return pair;
  pair = await getGmgnToken(mint);
  if (pair) return pair;
  return null;
}

app.post('/webhooks/venum', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];

  if (!secret || secret !== config.VENUM_WEBHOOK_SECRET) {
    console.log('❌ Invalid webhook secret');
    return res.status(401).send('Unauthorized');
  }

  const data = req.body;

  // Pastikan ini transaction webhook dari Venum
  if (!data.signature) {
    return res.status(200).send('ok');
  }

  console.log(`[Venum TX] Signature: ${data.signature}`);

  try {
    // Ekstrak mint dari transaction
    const { mints, isCreate, isBuy, isSell } = extractMintsFromTx(data);
    if (!mints || mints.length === 0) return res.status(200).send('ok');

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

      if (a.bp5m < config.MIN_BUY_PRESSURE_5M && ageMinutes < 15) continue;
      if (a.score < config.MIN_SCORE) continue;

      const name = pair.baseToken?.name || 'Unknown';
      const sym = pair.baseToken?.symbol || '???';
      const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
      const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
      const urlChart = pair.url || `https://dexscreener.com/solana/${mint}`;

      let label = 'EARLY';
      if (a.bp5m < 0.48) label = '⚠️ EARLY + SELL PRESSURE';
      else if (a.score >= 70) label = '🚀 ALPHA';

      const rug = await getRugCheck(mint);
      let rugInfo = '🛡️ RugCheck: Data belum tersedia';
      if (rug) {
        const score = rug.score_normalised != null ? rug.score_normalised : '—';
        const lpLocked = rug.lpLockedPct != null ? `${rug.lpLockedPct}%` : '—';
        rugInfo = `🛡️ RugCheck: Score ${score} | LP Locked: ${lpLocked}`;
      }

      const msgText = `
${label} · Score ${a.score}
📡 Venum Transaction Webhook

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq)}  |  Vol24: $${Math.round(a.vol24)}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap)}

${rugInfo}

🔗 <a href="${urlChart}">Chart</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>
🔗 <a href="https://gmgn.ai/sol/token/${mint}">GMGN</a>

<code>${mint}</code>
`.trim();

      await sendTelegram(msgText);
      console.log(`[${label}] ${sym} | Age: ${ageStr} | Score: ${a.score}`);
    }
  } catch (err) {
    console.error('Webhook error:', err.message);
  }

  res.status(200).send('ok');
});

app.listen(3000, () => {
  console.log('Venum Transaction Webhook server running on port 3000');
});
