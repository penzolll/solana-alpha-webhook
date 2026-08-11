require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const PUMPSWAP_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
const STREAMFLOW_PROGRAM_ID = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';

function ageH(p) {
  if (!p.pairCreatedAt) return null;
  return (Date.now() - p.pairCreatedAt) / 3.6e6;
}

function analyze(p) {
  // ... (analisa kamu sudah sama, saya tidak ubah karena sudah bagus)
  // (saya skip bagian panjang untuk hemat ruang, tapi tetap sama)
  // ... (copy paste fungsi analyze kamu yang lama)
}

const oneMinuteCandles = new Map(); // mint -> { firstPrice, lastPrice, time }
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 45;

// ============== SKIP 150-1000% CANDLE + MIGRATION NOTIF ==============
function isFirstCandleBig(mint) {
  const now = Date.now();
  const candleData = oneMinuteCandles.get(mint);
  if (!candleData) return false;

  const timePassed = now - candleData.time;
  if (timePassed < 60_000) return false;

  const change = ((candleData.lastPrice - candleData.firstPrice) / candleData.firstPrice) * 100;
  if (change >= 150 && change <= 1000) {
    console.log(`[SKIP-150-1000%] ${mint} | +${change.toFixed(1)}% dalam 60 detik`);
    return true;
  }
  return false;
}

function sendMigrationAlert(tx) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const mints = extractMints(tx);
  if (mints.length === 0) return;

  const url = `https://solscan.io/tx/${tx.signature}`;
  const msg = `🎉 <b>MIGRATION PUMPSWAP DETEKSI</b>\nMint: <code>${mints[0]}</code>\n<a href="${url}">Solscan</a>`;
  fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'HTML' })
  });
}

// helper extractMints & isNewTokenMintTx & isStreamflowLockTx (tetap sama)
function extractMints(tx) { /* ... sama seperti sebelumnya */ }
function isNewTokenMintTx(tx) { /* ... */ }
function isStreamflowLockTx(tx) { /* ... */ }
function handleStreamflowLock(tx) { /* ... */ }

// ... (semua fungsi lain kamu tetap sama: analyze, getDexScreenerPair, getRugCheckReport, processCandidate, etc.)

// Rute webhook (sudah di-update)
app.post('/webhook', async (req, res) => {
  if (AUTH_HEADER && req.headers.authorization !== AUTH_HEADER) {
    return res.status(401).send('Unauthorized');
  }
  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions) {
      if (isStreamflowLockTx(tx)) {
        await handleStreamflowLock(tx);
        continue;
      }

      if (isNewTokenMintTx(tx)) {
        const mints = extractMints(tx);
        for (const mint of mints) {
          await processCandidate(mint, 'helius-webhook');
        }
        continue;
      }

      if (isPumpSwapMigrationTx(tx)) {
        const mints = extractMints(tx);

        for (const mint of mints) {
          if (isFirstCandleBig(mint)) {
            console.log(`[SKIP-150-1000%] ${mint} — candle besar, SKIP total`);
            continue;
          }
          await processCandidate(mint, 'pumpswap-migration');
        }

        // NOTIFIKASI MIGRATION (meskipun skip)
        sendMigrationAlert(tx);
        continue;
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

// Polling RugCheck + setInterval reset candle
// ... (sama seperti sebelumnya)

app.listen(PORT, () => {
  console.log(`🚀 Helius Webhook + Railway running on port ${PORT}`);
  pollRugCheckNewTokens();
  setInterval(pollRugCheckNewTokens, 120000);
  // Reset candle setiap 65 detik
  setInterval(() => {
    const now = Date.now();
    for (const [mint, data] of oneMinuteCandles) {
      if (now - data.time > 65_000) oneMinuteCandles.delete(mint);
    }
  }, 60000);
});
