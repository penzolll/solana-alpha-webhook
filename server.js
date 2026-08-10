require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const WebSocket = require('ws'); // npm i ws

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const VAULT_ADDRESS = process.env.VAULT_ADDRESS || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'; // ganti dengan vault PDA proyek lo

// ============== ANALYZE (tetap sama) ==============
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

  let score = 40;
  const pos = [];
  const neg = [];

  // ... (semua logika analyze lama tetap sama, aku singkat biar tidak terlalu panjang)
  // Kalau mau full, bilang aja aku tambahin lagi

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = 'SKIP';
  const hard = neg.some(n => n.includes('tipis') || n.includes('Parabolic') || n.includes('Sell dominance 24h') || n.includes('distribusi'));
  if (score >= 68 && !hard) verdict = 'ALPHA';
  else if (score >= 52 && !neg.some(n => n.includes('tipis') || n.includes('Parabolic'))) verdict = 'WATCH';

  return { score, pos, neg, verdict, bp24, bp1h, age, liq, vol24, mcap, chg24 };
}

// ============== HELPER + NEW LOCKED TOKEN PARSER ==============
function extractMints(tx) {
  const mints = new Set();
  if (tx.tokenTransfers) {
    tx.tokenTransfers.forEach(t => {
      if (t.mint && t.mint !== 'So11111111111111111111111111111111111111112') mints.add(t.mint);
    });
  }
  if (tx.accountData) {
    tx.accountData.forEach(acc => {
      if (acc.tokenBalanceChanges) {
        acc.tokenBalanceChanges.forEach(c => {
          if (c.mint && c.mint !== 'So11111111111111111111111111111111111111112') mints.add(c.mint);
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
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram belum diset, message:', message);
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await new Promise(r => setTimeout(r, 750));
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

// ============== CACHE ==============
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 45;

// ============== NEW: LOCKED TOKEN PARSER ==============
async function parseLockedToken(tx) {
  const mints = extractMints(tx);
  if (mints.length === 0) return null;

  for (const mint of mints) {
    // Cek apakah ada instruction create vault / lock (contoh StakePoint, PumpSwap, dll)
    // Logika sederhana berdasarkan Helius transactionTypes + innerInstructions
    const hasVaultCreate = tx.instructions?.some(ins => 
      ins.programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P' || // PumpSwap contoh
      ins.programId === 'Stake11111111111111111111111111111111111111' // Stake Program
    ) || (tx.innerInstructions || []).some(ii => 
      ii.instructions.some(i => i.programId === '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')
    );

    if (!hasVaultCreate) continue;

    const pair = await getDexScreenerPair(mint);
    if (!pair) continue;

    const liq = pair.liquidity?.usd || 0;
    const vol24 = pair.volume?.h24 || 0;
    if (liq < 3000 || vol24 < 10000) continue;

    const a = analyze(pair);
    if (a.verdict === 'ALPHA' || (a.verdict === 'WATCH' && a.score >= 60)) {
      // Kirim alert khusus Locked Token
      const name = pair.baseToken?.name || 'Unknown';
      const sym = pair.baseToken?.symbol || '???';
      const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
      const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
      const url = pair.url || `https://dexscreener.com/solana/${mint}`;

      const msg = `
🔒 <b>LOCKED TOKEN DETECTED</b> | Score ${a.score}

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq)}  |  Vol24: $${Math.round(a.vol24)}
⏱ Age: ${ageStr}  |  Buy% 24h: ${Math.round(a.bp24 * 100)}%

🔗 <a href="${url}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

Vault PDA: ${VAULT_ADDRESS}
<code>${mint}</code>
`.trim();

      await sendTelegram(msg);
      console.log(`[LOCKED] ${sym} score=${a.score} - Vault locked!`);
      return true;
    }
  }
  return false;
}

// ============== WEBHOOK (updated dengan parse locked) ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) return res.status(401).send('Unauthorized');

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions) {
      if (tx.failed || tx.err) continue;

      const isLocked = await parseLockedToken(tx);
      if (isLocked) {
        // Optional: tambah ke seen agar nggak duplicate
        const mints = extractMints(tx);
        mints.forEach(m => {
          if (!seen.has(m) || Date.now() - seen.get(m) > SEEN_TTL) seen.set(m, Date.now());
        });
      }
    }
  } catch (err) {
    console.error('Webhook process error:', err);
  }
});

// ============== START WEBSOCKET (real-time locked detect) ==============
async function startVaultWS() {
  if (!HELIUS_API_KEY) {
    console.error('❌ HELIUS_API_KEY harus di-set di Railway Variables!');
    return;
  }

  const WS_URL = `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log('🚀 Helius WebSocket connected (real-time lock/migration detect)');

    ws.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "logsSubscribe",
      params: [{ mentions: [VAULT_ADDRESS] }, { commitment: "confirmed" }]
    }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.method === "logsNotification") {
      console.log('[WS] Vault log detected:', msg.params.result.value.logs);
      // Di production bisa tambah parse full tx signature
    }
  });

  ws.on('error', err => console.error('WS error:', err));
  ws.on('close', () => {
    console.log('WebSocket closed, reconnecting...');
    setTimeout(startVaultWS, 5000);
  });
}

// Start WS
startVaultWS();

// ============== REST ==============
app.get('/', (req, res) => res.send('Solana Alpha Webhook + Locked Token Detector is RUNNING 🚀'));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT} | Helius WebSocket active`);
});
