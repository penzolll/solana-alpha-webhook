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

// ============== ANALYZE (tetap sama seperti engine kamu) ==============
function ageH(p) {
  if (!p.pairCreatedAt) return null;
  return (Date.now() - p.pairCreatedAt) / 3.6e6;
}

function analyze(p) {
  // (kode analyze persis seperti yang kamu kirim sebelumnya)
  // ... (saya tidak paste ulang 60 baris, tapi di kode asli kamu sudah ada)
  // Score, verdict ALPHA/WATCH tetap sama
  // (bisa langsung pakai kode lama kamu)
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
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' })
  });
}

// ============== FLUXRPC ENDPOINT ==============
const FLUXRPC_BASE_URL = `https://eu.fluxrpc.com/?key=${FLUXRPC_API_KEY}`; // ganti region EU/US sesuai lokasi kamu

// Cache anti-spam
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 90; // 90 menit

// ============== WEBHOOK ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');

  res.status(200).send('OK');
  // (proses transaksi tetap sama seperti sebelumnya)
  // ... (kode extract mints, analyze, sendTelegram tetap sama)
});

app.get('/', (req, res) => res.send('Solana Alpha Engine + FluxRPC is running 🔥'));

app.listen(PORT, () => {
  console.log('🚀 Server running');
  console.log(`FluxRPC aktif: ${FLUXRPC_BASE_URL}`);
  console.log('Threshold: <20 menit | Score >=58 | Cache 90 menit');
});
