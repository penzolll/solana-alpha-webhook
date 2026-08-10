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

// Streamflow Lock (FIX FINAL — match log real Streamflow)
const lockedMints = new Map();

function isStreamflowLockTx(tx) {
  if (!tx.logs) return false;

  const logs = tx.logs.join('\n');

  // Match log persis dari tx real Streamflow
  const hasCreateInstruction = logs.includes('Program log: Instruction: Create');
  const hasMetadata = logs.includes('Creating stream metadata account');
  const hasEscrow = logs.includes('Creating stream escrow account');

  return hasCreateInstruction && hasMetadata && hasEscrow;
}

function extractLockInfo(tx) {
  if (!tx.logs) return null;

  const logs = tx.logs.join('\n');

  // Mint (dari token transfer atau log)
  let mint = null;
  const mintMatch = logs.match(/mint.*?([\w\d]{32,44})/i) || (tx.tokenTransfers && tx.tokenTransfers[0]?.mint);
  if (mintMatch) mint = mintMatch[1] || mintMatch;

  // Vault (dari log escrow — paling akurat)
  const escrowMatch = logs.match(/Creating stream escrow account.*?([\w\d]{32,44})/i);
  let vault = null;
  if (escrowMatch) vault = escrowMatch[1];

  return {
    mint: mint,
    vault: vault,
    amount: tx.tokenTransfers?.[0]?.tokenAmount || '0'
  };
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

// ============== WEBHOOK MINT ==============
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

// ============== WEBHOOK LOCK (AKURAT) ==============
app.post('/webhook-lock', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');
  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];
    for (const tx of transactions) {
      if (!isStreamflowLockTx(tx)) continue;

      const lockInfo = extractLockInfo(tx);
      if (!lockInfo || !lockInfo.mint) continue;

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
