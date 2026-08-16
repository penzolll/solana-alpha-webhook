require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

// ============== ANALYZE (OPTIMIZED FOR EARLY) ==============
function ageH(p) {
  if (!p.pairCreatedAt) return null;
  return (Date.now() - p.pairCreatedAt) / 3.6e6;
}

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
  const age = ageH(p);
  const mcap = p.marketCap || p.fdv || 0;
  const boosts = p.boosts?.active || 0;

  let score = 45;
  const pos = [];
  const neg = [];

  // ===== BUY PRESSURE =====
  if (t5m >= 3) {
    if (bp5m >= 0.70) { score += 14; pos.push('Buy% 5m sangat kuat'); }
    else if (bp5m >= 0.60) { score += 9; pos.push('Buy% 5m solid'); }
    else if (bp5m < 0.35) { score -= 10; neg.push('Sell pressure 5m'); }
  }
  if (t1h >= 6) {
    if (bp1h >= 0.65) { score += 12; pos.push('Buy% 1h kuat'); }
    else if (bp1h < 0.40) { score -= 9; neg.push('Sell dominance 1h'); }
  }
  if (t24 >= 15) {
    if (bp24 >= 0.62) { score += 8; pos.push('Buy% 24h bagus'); }
    else if (bp24 < 0.42) { score -= 8; neg.push('Sell dominance 24h'); }
  }
  if (bp5m >= 0.58 && bp1h >= 0.58 && t5m >= 3 && t1h >= 5) {
    score += 10; pos.push('Buy pressure multi-TF');
  }

  // ===== VOLUME & MOMENTUM =====
  if (vol5m > 1500 && chg5m > 0 && bp5m >= 0.55) {
    score += 9; pos.push('Burst 5m + buy');
  }
  if (vol1h > 8000 && chg1h > 5) {
    score += 7; pos.push('Vol 1h hidup');
  }

  // ===== AGE =====
  if (age != null) {
    if (age < 0.25) {
      score += 16; pos.push('Sangat fresh (<15m)');
    } else if (age < 0.5) {
      score += 11; pos.push('Fresh (<30m)');
    } else if (age < 1.5) {
      score += 6; pos.push('Early');
    } else if (age > 6) {
      score -= 8; neg.push('Sudah agak tua');
    }
  }

  // ===== LIQUIDITY =====
  if (liq >= 25000) { score += 9; pos.push('Liq bagus'); }
  else if (liq >= 10000) { score += 5; }
  else if (liq >= 4000) { score += 2; }
  else if (liq < 2500) { score -= 12; neg.push('Liq sangat tipis'); }
  else if (liq < 4000) { score -= 5; neg.push('Liq rendah'); }

  // ===== PRICE CHANGE =====
  if (chg5m > 8 && chg5m < 80) { score += 8; pos.push('Momentum 5m sehat'); }
  if (chg1h > 15 && chg1h < 120) { score += 6; pos.push('Momentum 1h bagus'); }
  if (chg24 > 200) { score -= 14; neg.push('Parabolic'); }
  if (chg24 < -25) { score -= 8; neg.push('Dump'); }

  // ===== MCAP =====
  if (mcap > 0) {
    if (mcap < 40000) { score += 10; pos.push('MCap sangat early'); }
    else if (mcap < 90000) { score += 6; pos.push('MCap early'); }
    else if (mcap > 300000) { score -= 7; neg.push('MCap sudah tinggi'); }
  }

  // ===== BOOST =====
  if (boosts >= 3) { score += 5; pos.push('Ada boost'); }

  // Hard penalties
  if (liq < 2000 && vol24 < 8000) score -= 15;
  if (chg24 > 150 && bp24 < 0.48) { score -= 10; neg.push('Pump + sell = distribusi'); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = 'SKIP';
  const hard = neg.some(n =>
    n.includes('sangat tipis') ||
    n.includes('Parabolic') ||
    n.includes('distribusi')
  );
  if (score >= 70 && !hard) verdict = 'ALPHA';
  else if (score >= 55 && !hard) verdict = 'WATCH';

  return { score, pos, neg, verdict, bp24, bp1h, age, liq, vol24, mcap, chg24 };
}

// ============== EXTRACT MINTS (RAW + STRICT) ==============
function extractMintsFromRaw(tx) {
  const mints = new Set();
  const WSOL = 'So11111111111111111111111111111111111111112';

  const logs = tx?.meta?.logMessages || [];
  const logText = logs.join(' ').toLowerCase();

  const isCreate =
    logText.includes('instruction: initializemint2') ||
    logText.includes('instruction: create') ||
    logText.includes('program log: instruction: create');

  if (!isCreate) return [];

  const balances = [
    ...(tx?.meta?.preTokenBalances || []),
    ...(tx?.meta?.postTokenBalances || [])
  ];

  for (const b of balances) {
    if (b.mint && b.mint !== WSOL) {
      mints.add(b.mint);
    }
  }

  return [...mints];
}

// ============== HELPER ==============
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
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram belum diset, message:', message);
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
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

// Cache
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 45;

// ============== WEBHOOK ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) {
    return res.status(401).send('Unauthorized');
  }

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    // Debug singkat
    console.log(`[Webhook] Received ${transactions.length} tx`);

    for (const tx of transactions) {
      const mints = extractMintsFromRaw(tx);
      if (mints.length === 0) continue;

      for (const mint of mints) {
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        const pair = await getDexScreenerPair(mint);
        if (!pair) continue;

        const a = analyze(pair);

        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < 20;
        const isLowMcap = a.mcap > 0 && a.mcap < 90000;
        const isDecentLiq = a.liq >= 3000 && a.liq <= 60000;
        const hasActivity = a.vol24 > 5000;

        if (isEarly && isLowMcap && isDecentLiq && hasActivity && a.score >= 58) {
          const name = pair.baseToken?.name || 'Unknown';
          const sym = pair.baseToken?.symbol || '???';
          const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
          const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
          const url = pair.url || `https://dexscreener.com/solana/${mint}`;

          const msg = `
🚀 <b>EARLY · Score ${a.score}</b>

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()}  |  Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap).toLocaleString()}
Buy% 24h: ${Math.round(a.bp24 * 100)}%

🔗 <a href="${url}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

<code>${mint}</code>
`.trim();

          await sendTelegram(msg);
          console.log(`[EARLY] ${sym} | Age: ${ageStr} | MCap: ${Math.round(a.mcap)} | Score: ${a.score}`);
        }
      }
    }
  } catch (err) {
    console.error('Webhook process error:', err);
  }
});

app.get('/', (req, res) => res.send('Solana Alpha Webhook (Raw + Strict) is running'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
