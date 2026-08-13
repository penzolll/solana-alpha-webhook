require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';
const FLUXRPC_API_KEY = process.env.FLUXRPC_API_KEY;   // <-- pakai underscore

if (!FLUXRPC_API_KEY) {
  console.error('❌ FLUXRPC_API_KEY tidak ditemukan di .env');
  process.exit(1);
}

// ============== ANALYZE ==============
function ageH(p) {
  if (!p.pairCreatedAt) return null;
  return (Date.now() - p.pairCreatedAt) / 3.6e6;
}

function analyze(p) {
  // ... (kode analyze sama seperti sebelumnya, copy dari server.js lama kamu)
  // Saya tidak paste ulang agar tidak terlalu panjang
  // Score, verdict ALPHA/WATCH tetap sama
}

// (semua fungsi lain: extractMints, getDexScreenerPair, sendTelegram tetap sama)

app.post('/webhook', async (req, res) => {
  // ... (kode webhook lama kamu)
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
