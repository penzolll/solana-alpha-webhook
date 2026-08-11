require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

// Program address resmi
const TOKEN_METADATA_PROGRAM_ID = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const STREAMFLOW_PROGRAM_ID = 'strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m';

// ============== ANALYZE ==============
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

  if (t24 >= 25) {
    if (bp24 >= 0.68) { score += 18; pos.push(`Buy% 24h kuat (${Math.round(bp24 * 100)}%)`); }
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
  if (bp24 >= 0.55 && bp1h >= 0.55 && t24 >= 20 && t1h >= 6) {
    score += 8; pos.push('Pressure multi-TF konsisten');
  }

  if (vol24 > 20000) {
    const s1 = vol1h / vol24;
    const s5 = vol5m / vol24;
    if (s1 > 0.25 && chg1h > 0) { score += 10; pos.push('Vol 1h accelerating'); }
    if (s5 > 0.08 && chg5m > 0 && bp5m >= 0.5) { score += 8; pos.push('Burst 5m + buy'); }
  }

  if (age != null) {
    if (age < 1.5 && vol24 > 25000 && t24 >= 15) { score += 18; pos.push('Sangat early (<1.5j) + hidup'); }
    else if (age < 4 && vol24 > 60000) { score += 13; pos.push('Early (<4j)'); }
    else if (age < 12 && vol24 > 120000) { score += 7; pos.push('Relatif fresh'); }
    else if (age > 48 && chg24 > 100) { score -= 12; neg.push('Tua + pump besar'); }
  }

  if (liq >= 100000) { score += 12; pos.push('Liq aman'); }
  else if (liq >= 35000) score += 8;
  else if (liq >= 12000) score += 3;
  else if (liq < 6000) { score -= 18; neg.push('Liq tipis'); }
  else if (liq < 12000) { score -= 6; neg.push('Liq rendah'); }

  if (chg24 > 12 && chg24 <= 70) { score += 14; pos.push(`Momentum sehat +${chg24.toFixed(0)}%`); }
  else if (chg24 > 70 && chg24 <= 130) { score += 4; pos.push('Naik, ruang terbatas'); }
  else if (chg24 > 180) { score -= 16; neg.push('Parabolic late'); }
  else if (chg24 < -30) { score -= 10; neg.push('Dump 24h'); }

  if (mcap > 0) {
    if (mcap < 250000 && vol24 > 40000) { score += 11; pos.push('MCap early-stage'); }
    else if (mcap < 1200000 && vol24 > 80000) score += 5;
    else if (mcap > 15e6 && chg24 > 40) { score -= 10; neg.push('MCap besar'); }
  }

  if (boosts >= 5) { score += 7; pos.push('Boost tinggi'); }
  else if (boosts >= 1) score += 2;

  if (liq < 4000 && vol24 < 15000) score -= 20;
  if (chg24 > 100 && bp24 < 0.45 && t24 > 20) { score -= 12; neg.push('Pump+sell = distribusi'); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = 'SKIP';
  const hard = neg.some(n => n.includes('tipis') || n.includes('Parabolic') || n.includes('Sell dominance 24h') || n.includes('distribusi'));
  if (score >= 68 && !hard) verdict = 'ALPHA';
  else if (score >= 52 && !neg.some(n => n.includes('tipis') || n.includes('Parabolic'))) verdict = 'WATCH';

  return { score, pos, neg, verdict, bp24, bp1h, age, liq, vol24, mcap, chg24 };
}

// ============== HELPER (mint detection) ==============
function extractMints(tx) {
  const mints = new Set();

  if (tx.tokenTransfers) {
    for (const t of tx.tokenTransfers) {
      if (
        t.mint &&
        t.mint !== 'So11111111111111111111111111111111111111112' &&
        Number(t.tokenAmount) > 0
      ) {
        mints.add(t.mint);
      }
    }
  }

  return [...mints];
}

// Deteksi tx token-mint-baru dari Helius enhanced webhook (transactionType TOKEN_MINT
// di Token Metadata Program). Kalau field 'source' ada, itu nandain platform asal
// (mis. PUMP_FUN) - saat ini semua source diterima, gampang di-tighten kalau perlu.
function isNewTokenMintTx(tx) {
  if (tx.type === 'TOKEN_MINT') return true;
  const ixs = tx.instructions || [];
  return ixs.some(ix => ix.programId === TOKEN_METADATA_PROGRAM_ID);
}

async function getDexScreenerPair(mint) {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`);
    if (!res.ok) return null;
    const pairs = await res.json();
    if (!Array.isArray(pairs) || pairs.length === 0) return null;

    // Ambil pair dengan liquidity tertinggi
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

// Cache biar tidak spam token yang sama
const seen = new Map();
const SEEN_TTL = 1000 * 60 * 45; // 45 menit

// ============== STREAMFLOW LOCK DETECTION ==============
// State in-memory: mint -> info lock terakhir. Reset kalau server restart (Railway redeploy).
const lockedMints = new Map();

function isStreamflowLockTx(tx) {
  // Helius enhanced parser kemungkinan besar TIDAK native-decode Streamflow,
  // jadi tx.type ini nyaris pasti bakal 'UNKNOWN' - fallback ke cek instruksi mentah
  // adalah jalur utama yang bisa diandalkan, bukan cadangan.
  const ixs = tx.instructions || [];
  const isStreamflowTx = tx.type === 'CREATE_LOCK_ESCROW' || ixs.some(ix => ix.programId === STREAMFLOW_PROGRAM_ID);

  // DEBUG SEMENTARA: cetak payload mentah biar bisa dibedain create-lock vs withdraw.
  // Hapus baris ini lagi setelah dapat contoh payload-nya.
  if (isStreamflowTx) {
    console.log('[DEBUG-STREAMFLOW]', JSON.stringify(tx));
  }

  return isStreamflowTx;
}

function extractLockInfo(tx) {
  const transfer = (tx.tokenTransfers || []).find(
    t => t.mint && t.mint !== 'So11111111111111111111111111111111111111112'
  );

  const streamflowIx = (tx.instructions || []).find(ix => ix.programId === STREAMFLOW_PROGRAM_ID);
  // NOTE: posisi index vault/escrow account di array 'accounts' tergantung layout
  // instruksi Streamflow saat ini - perlu divalidasi manual dengan lihat 1-2 tx contoh
  // di Solscan/Helius sebelum dipercaya penuh.
  const vault = streamflowIx?.accounts?.[0] || null;

  return {
    mint: transfer?.mint || null,
    amount: transfer?.tokenAmount || null,
    vault,
    signature: tx.signature || null,
  };
}

async function handleStreamflowLock(tx) {
  const info = extractLockInfo(tx);
  if (!info.mint) return;

  lockedMints.set(info.mint, {
    vault: info.vault,
    amount: info.amount,
    signature: info.signature,
    detectedAt: Date.now(),
  });

  const msg = `
🔒 <b>Streamflow Lock Terdeteksi</b>

Mint: <code>${info.mint}</code>
${info.amount ? `Jumlah: ${info.amount}\n` : ''}${info.vault ? `Vault: <code>${info.vault}</code>\n` : ''}
🔗 <a href="https://solscan.io/tx/${info.signature}">Solscan</a>
🔗 <a href="https://dexscreener.com/solana/${info.mint}">DexScreener</a>
`.trim();

  await sendTelegram(msg);
  console.log(`[LOCK] Mint ${info.mint} terdeteksi lock Streamflow`);
}

// ============== WEBHOOK ENDPOINT ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) {
    return res.status(401).send('Unauthorized');
  }

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions) {
      // Rute 1: event lock Streamflow
      if (isStreamflowLockTx(tx)) {
        await handleStreamflowLock(tx);
        continue;
      }

      // Rute 2: token baru (hanya diproses kalau memang tx TOKEN_MINT/Token Metadata Program)
      if (!isNewTokenMintTx(tx)) continue;

      const mints = extractMints(tx);
      if (mints.length === 0) continue;

      for (const mint of mints) {
        // Skip kalau baru saja diproses
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        const pair = await getDexScreenerPair(mint);
        if (!pair) continue;

        const a = analyze(pair);

        // ========== FILTER EARLY KETAT ==========
        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < 20;                 // maksimal 20 menit
        const isLowMcap = a.mcap > 0 && a.mcap < 90000;  // MCap di bawah $90k
        const isDecentLiq = a.liq >= 3000 && a.liq <= 60000;
        const hasActivity = a.vol24 > 5000;

        if (
          isEarly &&
          isLowMcap &&
          isDecentLiq &&
          hasActivity &&
          a.score >= 58
        ) {
          const name = pair.baseToken?.name || 'Unknown';
          const sym = pair.baseToken?.symbol || '???';
          const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
          const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
          const url = pair.url || `https://dexscreener.com/solana/${mint}`;
          const lockTag = lockedMints.has(mint) ? '🔒 Locked (Streamflow)' : '🔓 Belum terdeteksi lock';

          const msg = `
🚀 <b>EARLY · Score ${a.score}</b>

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()}  |  Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap).toLocaleString()}
Buy% 24h: ${Math.round(a.bp24 * 100)}%
${lockTag}

🔗 <a href="${url}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

<code>${mint}</code>
`.trim();

          await sendTelegram(msg);
          console.log(`[EARLY] ${sym} | Age: ${ageStr} | MCap: ${Math.round(a.mcap)} | Score: ${a.score} | ${lockTag}`);
        }
      }
    }
  } catch (err) {
    console.error('Webhook process error:', err);
  }
});

// Cek manual daftar token yang lock-nya sedang di-track
app.get('/locked', (req, res) => {
  const list = [...lockedMints.entries()].map(([mint, data]) => ({ mint, ...data }));
  res.json(list);
});

app.get('/', (req, res) => res.send('Solana Alpha Webhook is running'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
