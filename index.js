require('dotenv').config();
const express = require('express');

const config = require('./config');
const { extractMintsFromRaw } = require('./extract');
const { analyze } = require('./analyze');
const { getDexScreenerPair } = require('./services/dexscreener');
const { getRugCheck } = require('./services/rugcheck');
const { sendTelegram } = require('./services/telegram');
const { isSeen } = require('./utils/cache');

const app = express();
app.use(express.json({ limit: '10mb' }));

// ============== WEBHOOK ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (config.AUTH_HEADER && auth !== config.AUTH_HEADER) {
    return res.status(401).send('Unauthorized');
  }

  // Langsung respond biar Helius tidak timeout
  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];
    console.log(`[Webhook] Received ${transactions.length} tx`);

    for (const tx of transactions) {
      const mints = extractMintsFromRaw(tx);
      if (mints.length === 0) continue;

      for (const mint of mints) {
        if (isSeen(mint)) continue;

        // 1. DexScreener
        const pair = await getDexScreenerPair(mint);
        if (!pair) continue;

        const a = analyze(pair);

        // 2. Filter dasar
        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < config.MAX_AGE_MINUTES;
        const isLowMcap = a.mcap > 0 && a.mcap < config.MAX_MCAP;
        const isDecentLiq = a.liq >= config.MIN_LIQ && a.liq <= config.MAX_LIQ;
        const hasActivity = a.vol24 > config.MIN_VOL24;

        if (!(isEarly && isLowMcap && isDecentLiq && hasActivity)) continue;

        // 3. Filter Sell Pressure di early stage
        if (a.bp5m < config.MIN_BUY_PRESSURE_5M && ageMinutes < config.EARLY_AGE_FOR_SELL_CHECK) {
          console.log(`[SKIP] ${mint} - Sell pressure tinggi di early stage`);
          continue;
        }

        // 4. Score minimum
        if (a.score < config.MIN_SCORE) continue;

        // 5. RugCheck
        const rug = await getRugCheck(mint);
        if (rug) {
          const hasDanger = (rug.risks || []).some(r => r.level === 'danger');
          const scoreNorm = rug.score_normalised ?? 50;
          if (hasDanger || scoreNorm > config.RUGCHECK_MAX_SCORE) {
            console.log(`[SKIP] ${mint} - RugCheck danger/high risk`);
            continue;
          }
        }

        // ========== KIRIM NOTIFIKASI ==========
        const name = pair.baseToken?.name || 'Unknown';
        const sym = pair.baseToken?.symbol || '???';
        const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
        const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
        const url = pair.url || `https://dexscreener.com/solana/${mint}`;

        // Label
        let label = 'EARLY';
        if (a.bp5m < 0.48) label = '⚠️ EARLY + SELL PRESSURE';
        else if (a.score >= 70) label = '🚀 ALPHA';

        // Info RugCheck
        let rugInfo = '🛡️ RugCheck: Data belum tersedia';
        if (rug) {
          const lpLocked = rug.lpLockedPct != null ? `${rug.lpLockedPct}%` : '—';
          const score = rug.score_normalised != null ? rug.score_normalised : '—';
          rugInfo = `🛡️ RugCheck: Score ${score} | LP Locked: ${lpLocked}`;
        }

        const msg = `
${label} · Score ${a.score}

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

        await sendTelegram(msg);
        console.log(`[${label}] ${sym} | Age: ${ageStr} | Score: ${a.score} | Buy5m: ${Math.round(a.bp5m * 100)}%`);
      }
    }
  } catch (err) {
    console.error('Webhook process error:', err);
  }
});

app.get('/', (req, res) => {
  res.send('Solana Alpha Webhook (Modular - Create+Buy+Sell) is running');
});

app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});
