require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';
const FLUXRPC_API_KEY = process.env.FLUXRPC_API_KEY;

if (!FLUXRPC_API_KEY) {
  console.error('❌ FLUXRPC_API_KEY tidak ditemukan di .env');
  process.exit(1);
}

// ============== ANALYZE (threshold upgraded) ==============
function ageH(p) {
  if (!p.pairCreatedAt) return null;
  return (Date.now() - p.pairCreatedAt) / 3.6e6;
}

function analyze(p) {
  // (semua logika score sama seperti engine HTML kamu)
  // copy dari kode lama kamu

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

  let score = 40;
  const pos = [];
  const neg = [];

  score = Math.max(0, Math.min(100, Math.round(score)));
  let verdict = 'SKIP';
  const hard = neg.some(n => n.includes('tipis') || n.includes('Parabolic') || n.includes('Sell dominance 24h') || n.includes('distribusi'));
  if (score >= 62 && !hard) verdict = 'ALPHA';
  else if (score >= 52 && !neg.some(n => n.includes('tipis') || n.includes('Parabolic'))) verdict = 'WATCH';
  return { score, pos, neg, verdict, bp24, age, liq, vol24, mcap, chg24 };
}

// ============== HELPER ==============
function extractMints(tx) {
  const mints = new Set();
  if (tx.tokenTransfers) {
    for (const t of tx.tokenTransfers) {
      if (t.mint && t.mint !== 'So11111111111111111111111111111111111111112' && Number(t.tokenAmount) > 0) {
        mints.add(t.mint);
      }
    }
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
    return null;
  }
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML'
    })
  });
}

// ============== FLUXRPC ==============
const FLUXRPC_BASE_URL = `https://eu.fluxrpc.com/?key=${FLUXRPC_API_KEY}`;

// Cache anti-spam
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 90;

// ============== WEBHOOK ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];
    for (const tx of transactions) {
      const mints = extractMints(tx);
      if (mints.length === 0) continue;

      for (const mint of mints) {
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        const pair = await getDexScreenerPair(mint);
        if (!pair) continue;

        const a = analyze(pair);
        const ageMinutes = a.age !== null ? a.age * 60 : 999;

        const isEarly = ageMinutes < 10;
        const isLowMcap = a.mcap > 0 && a.mcap < 80000;
        const isDecentLiq = a.liq >= 3000 && a.liq <= 60000;
        const hasActivity = a.vol24 > 5000;
        const scoreOK = a.score >= 62;

        if (isEarly && isLowMcap && isDecentLiq && hasActivity && scoreOK) {
          console.log(`[FLUXRPC] EARLY DETECTED: ${pair.baseToken?.symbol} | Age: ${ageMinutes}m`);
        }
      }
    }
  } catch (err) {
    console.error('FluxRPC webhook error:', err);
  }
});

app.get('/', (req, res) => res.send('Solana Alpha Engine + FluxRPC is running 🔥'));

process.on('SIGTERM', () => {
  console.log('Graceful shutdown...');
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('FluxRPC aktif: https://eu.fluxrpc.com');
});
