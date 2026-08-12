require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

// ============== ANALYZE (diambil langsung dari Alpha Engine HTML) ==============
function analyze(p) {
  const vol24 = p.volume?.h24 || 0;
  const vol1h = p.volume?.h1 || 0;
  const vol5m = p.volume?.m5 || 0;
  const liq = p.liquidity?.usd || 0;
  const chg24 = p.priceChange?.h24 ?? 0;
  const chg1h = p.priceChange?.h1 ?? 0;
  const chg5m = p.priceChange?.m5 ?? 0;
  const b24 = p.txns?.h24?.buys || 0;
  const s24 = p.txns?.h24?.sells || 0;
  const b1h = p.txns?.h1?.buys || 0;
  const s1h = p.txns?.h1?.sells || 0;
  const b5m = p.txns?.m5?.buys || 0;
  const s5m = p.txns?.m5?.sells || 0;
  const t24 = b24 + s24;
  const t1h = b1h + s1h;
  const t5m = b5m + s5m;
  const bp24 = t24 > 0 ? b24 / t24 : 0.5;
  const bp1h = t1h > 0 ? b1h / t1h : 0.5;
  const bp5m = t5m > 0 ? b5m / t5m : 0.5;
  const age = (Date.now() - p.pairCreatedAt) / 3.6e6;
  const mcap = p.marketCap || p.fdv || 0;
  const boosts = p.boosts?.active || 0;

  let score = 40;
  const pos = [], neg = [];

  if (t24 >= 25) {
    if (bp24 >= 0.68) { score += 18; pos.push('Buy% 24h kuat'); }
    else if (bp24 >= 0.58) { score += 11; pos.push('Buy% 24h solid'); }
    else if (bp24 < 0.42) { score -= 14; neg.push('Sell dominance 24h'); }
  }
  if (t1h >= 8) {
    if (bp1h >= 0.65) { score += 12; pos.push('Buy% 1h kuat'); }
    else if (bp1h < 0.4) { score -= 10; neg.push('Sell dominance 1h'); }
  }
  if (t5m >= 4) {
    if (bp5m >= 0.65) { score += 8; pos.push('Buy% 5m hot'); }
    else if (bp5m < 0.35) { score -= 8; neg.push('Sell 5m'); }
  }
  if (bp24 >= 0.55 && bp1h >= 0.55 && t24 >= 20 && t1h >= 6) score += 8;

  if (vol24 > 20000) {
    const s1 = vol1h / vol24;
    const s5 = vol5m / vol24;
    if (s1 > 0.25 && chg1h > 0) score += 10;
    if (s5 > 0.08 && chg5m > 0 && bp5m >= 0.5) score += 8;
  }

  if (age != null) {
    if (age < 1.5 && vol24 > 25000 && t24 >= 15) { score += 18; pos.push('Sangat early (<1.5j)'); }
    else if (age < 4 && vol24 > 60000) score += 13;
    else if (age < 12 && vol24 > 120000) score += 7;
    else if (age > 48 && chg24 > 100) { score -= 12; neg.push('Tua + pump besar'); }
  }

  if (liq >= 100000) score += 12;
  else if (liq >= 35000) score += 8;
  else if (liq >= 12000) score += 3;
  else if (liq < 6000) { score -= 18; neg.push('Liq tipis'); }
  else if (liq < 12000) { score -= 6; neg.push('Liq rendah'); }

  if (chg24 > 12 && chg24 <= 70) score += 14;
  else if (chg24 > 70 && chg24 <= 130) score += 4;
  else if (chg24 > 180) { score -= 16; neg.push('Parabolic late'); }
  else if (chg24 < -30) { score -= 10; neg.push('Dump 24h'); }

  if (mcap > 0) {
    if (mcap < 250000 && vol24 > 40000) score += 11;
    else if (mcap < 1200000 && vol24 > 80000) score += 5;
    else if (mcap > 15e6 && chg24 > 40) { score -= 10; neg.push('MCap besar'); }
  }

  if (boosts >= 5) score += 7;
  else if (boosts >= 1) score += 2;

  if (liq < 4000 && vol24 < 15000) score -= 20;
  if (chg24 > 100 && bp24 < 0.45 && t24 > 20) score -= 12;

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = 'SKIP';
  const hard = neg.some(n => n.includes('tipis') || n.includes('Parabolic') || n.includes('Sell dominance 24h') || n.includes('distribusi'));
  if (score >= 68 && !hard) verdict = 'ALPHA';
  else if (score >= 52 && !hard) verdict = 'WATCH';

  return { score, verdict, bp24, age, liq, vol24, mcap, chg24, pos, neg };
}

// ============== HELPER ==============
function extractMints(tx) {
  const mints = new Set();
  if (tx.tokenTransfers) {
    tx.tokenTransfers.forEach(t => {
      if (t.mint && t.mint !== 'So11111111111111111111111111111111111111112' && Number(t.tokenAmount) > 0) {
        mints.add(t.mint);
      }
    });
  }
  if (tx.accountData) {
    tx.accountData.forEach(acc => {
      if (acc.tokenBalanceChanges) {
        acc.tokenBalanceChanges.forEach(c => {
          if (c.mint && c.mint !== 'So11111111111111111111111111111111111111112') {
            mints.add(c.mint);
          }
        });
      }
    });
  }
  return [...mints];
}

async function getDexScreenerPair(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
    if (!res.ok) return null;
    const pairs = await res.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;
    pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    return pairs[0];
  } catch (e) {
    console.error('DexScreener error:', e.message);
    return null;
  }
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false
    })
  });
}

const seen = new Map();
const SEEN_TTL = 1000 * 60 * 30;

function isStreamflowLockTx(tx) {
  if (!tx.source || tx.source !== 'STREAMFLOW_TIMELOCK') return false;
  if (tx.type === 'WITHDRAW') return false;
  if (tx.type === 'DEPOSIT') return true;
  return false;
}

async function handleStreamflowLock(tx) {
  const transfer = (tx.tokenTransfers || []).find(t => t.mint && t.mint !== 'So11111111111111111111111111111111111111112');
  const streamflowIx = (tx.instructions || []).find(ix => ix.programId === 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m');
  if (!transfer) return;

  const msg = `🔒 <b>Streamflow Lock Terdeteksi</b>\nMint: <code>${transfer.mint}</code>\nVault: <code>${streamflowIx?.accounts?.[0]}</code>`;
  await sendTelegram(msg);
}

app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');
  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions) {
      if (isStreamflowLockTx(tx)) {
        await handleStreamflowLock(tx);
        continue;
      }

      const mints = extractMints(tx);
      if (mints.length === 0) continue;

      for (const mint of mints) {
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        const pair = await getDexScreenerPair(mint);
        if (!pair) continue;

        const a = analyze(pair);
        if (a.verdict === 'SKIP') continue;

        const name = pair.baseToken?.name || 'Unknown';
        const sym = pair.baseToken?.symbol || '???';
        const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
        const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');

        const msg = `
🚀 <b>${a.verdict} · Score ${a.score}</b>

<b>${name}</b> ($${sym})
💰 ${price} | 📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()} | Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr} | Buy% 24h: ${Math.round(a.bp24 * 100)}%

🔗 <a href="${pair.url || `https://dexscreener.com/solana/${mint}`}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

<code>${mint}</code>
`.trim();

        await sendTelegram(msg);
        console.log(`[ALERT] ${a.verdict} ${sym} score=${a.score}`);
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

app.get('/', (req, res) => res.send('Solana Alpha Webhook is running'));

app.listen(PORT, () => {
  console.log(`🚀 Solana Alpha Webhook running on port ${PORT}`);
});
