require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

const STREAMFLOW_PROGRAM_ID = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';

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

// Streamflow Lock
const lockedMints = new Map();

function isStreamflowLockTx(tx) {
  if (tx.type === 'CREATE_LOCK_ESCROW') return true;

  if (tx.instructions) {
    return tx.instructions.some(i => i.programId === STREAMFLOW_PROGRAM_ID);
  }

  // === FIX: deteksi log "Instruction: Create" dari program Streamflow ===
  if (tx.logs) {
    return tx.logs.some(log => log.includes('Instruction: Create') && log.includes(STREAMFLOW_PROGRAM_ID));
  }
  return false;
}

function extractLockInfo(tx) {
  if (tx.type === 'CREATE_LOCK_ESCROW') {
    const escrow = tx.events?.escrow || tx.events?.lock || {};
    return {
      mint: escrow.mint || tx.tokenTransfers?.[0]?.mint,
      vault: escrow.vault || tx.tokenTransfers?.[1]?.mint,
      amount: escrow.amount || tx.tokenTransfers?.[0]?.tokenAmount || '0'
    };
  }
  return null;
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

// Cache
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 45;

// ============== WEBHOOK - TOKEN MINT ==============
app.post('/webhook-mint', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions) {
      const mints = extractMints(tx);

      for (const mint of mints) {
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        await sendTelegram(`🚀 <b>TOKEN MEME BARU DITEMUKAN!</b>\n\nToken: <code>${mint}</code>\nTx: <code>${tx.signature}</code>`);
        console.log(`[MINT] ${mint} baru ditemukan`);
      }
    }
  } catch (err) {
    console.error('Webhook mint error:', err);
  }
});

// ============== WEBHOOK - STREAMFLOW LOCK ==============
app.post('/webhook-lock', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions) {
      if (!isStreamflowLockTx(tx)) continue;

      const lockInfo = extractLockInfo(tx);
      if (!lockInfo) continue;

      const mint = lockInfo.mint;
      if (!mint) continue;

      lockedMints.set(mint, {
        vault: lockInfo.vault,
        amount: lockInfo.amount,
        txSignature: tx.signature,
        timestamp: Date.now()
      });

      await sendTelegram(`🔒 <b>LOCK DETECTED!</b>\n\nToken: <code>${mint}</code>\nVault: <code>${lockInfo.vault}</code>\nAmount: ${lockInfo.amount}\nTx: <code>${tx.signature}</code>`);
      console.log(`[LOCK] ${mint} locked di vault ${lockInfo.vault}`);
    }
  } catch (err) {
    console.error('Webhook lock error:', err);
  }
});

// ============== CHECK ==============
app.get('/locked', (req, res) => {
  res.json({ locked: Array.from(lockedMints.entries()) });
});

app.get('/', (req, res) => res.send('Solana Alpha Webhook is running 🔥'));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📡 Webhook Mint : https://solana-alpha-webhook-production.up.railway.app/webhook-mint`);
  console.log(`📡 Webhook Lock : https://solana-alpha-webhook-production.up.railway.app/webhook-lock`);
});
