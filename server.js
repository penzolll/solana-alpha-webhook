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

  // Fallback: kadang Helius taruh mint di accountData.tokenBalanceChanges,
  // bukan (atau selain) di tokenTransfers. Jaring lebih lebar biar tidak
  // ada tx TOKEN_MINT yang lolos tanpa mint terdeteksi.
  if (tx.accountData) {
    for (const acc of tx.accountData) {
      if (!acc.tokenBalanceChanges) continue;
      for (const c of acc.tokenBalanceChanges) {
        if (c.mint && c.mint !== 'So11111111111111111111111111111111111111112') {
          mints.add(c.mint);
        }
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

// ============== RUGCHECK (keamanan kontrak) ==============
// Endpoint publik, tidak butuh API key untuk data dasar.
// Docs tidak resmi dipublikasikan lengkap - field diambil dari observasi komunitas,
// jadi parsing dibuat defensif (banyak fallback ?.) biar tidak crash kalau field berubah.
async function getRugCheckReport(mint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();

    const mintAuthority = data?.token?.mintAuthority || data?.mintAuthority || null;
    const freezeAuthority = data?.token?.freezeAuthority || data?.freezeAuthority || null;

    // LP locked % - coba beberapa kemungkinan lokasi field, ambil market pertama yang ada datanya
    let lpLockedPct = null;
    const markets = data?.markets || [];
    for (const m of markets) {
      const pct = m?.lp?.lpLockedPct ?? m?.lp?.lpLockedPercent ?? null;
      if (pct != null) { lpLockedPct = pct; break; }
    }

    // Top holder tunggal terbesar (di luar LP/pool), buat deteksi konsentrasi ekstrem
    const topHolders = data?.topHolders || [];
    const topHolderPct = topHolders.length > 0 ? (topHolders[0]?.pct || 0) : null;

    const riskScore = data?.score_normalised ?? data?.score ?? null;
    const risks = (data?.risks || []).map(r => r?.name).filter(Boolean);

    return {
      mintAuthorityActive: !!mintAuthority,
      freezeAuthorityActive: !!freezeAuthority,
      lpLockedPct,
      topHolderPct,
      riskScore,
      risks,
    };
  } catch (e) {
    console.error('RugCheck error:', e.message);
    return null; // gagal fetch -> jangan block alert, cuma skip info tambahan ini
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

// CONFIRMED dari payload nyata (11 Aug 2026): Helius decode Streamflow dengan
// source: "STREAMFLOW_TIMELOCK" - TIDAK ada di dokumentasi resmi publik Helius,
// jadi kemungkinan fitur baru yang belum di-dokumentasikan.
// type: "WITHDRAW" sudah dikonfirmasi = penarikan dari vault yang sudah ada (BUKAN lock baru).
// type untuk create-lock BELUM dikonfirmasi - dugaan "DEPOSIT" berdasarkan pola source lain
// (mis. PUMP_AMM yang punya pasangan DEPOSIT/WITHDRAW). Perlu divalidasi kalau ada contoh nyata.
function isStreamflowTx(tx) {
  if (tx.source === 'STREAMFLOW_TIMELOCK') return true;
  const ixs = tx.instructions || [];
  return ixs.some(ix => ix.programId === STREAMFLOW_PROGRAM_ID);
}

function isStreamflowLockTx(tx) {
  if (!isStreamflowTx(tx)) return false;

  if (tx.type === 'WITHDRAW') return false; // dikonfirmasi = penarikan, bukan lock baru
  if (tx.type === 'DEPOSIT') return true;   // dugaan = lock/deposit baru

  // Type Streamflow lain yang belum pernah ketemu - log dulu, jangan alert dulu
  // biar type-nya bisa dikonfirmasi sebelum dianggap lock beneran.
  console.log(`[STREAMFLOW-UNKNOWN-TYPE] type="${tx.type}" source="${tx.source}" sig=${tx.signature}`);
  return false;
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
    console.log(`[WEBHOOK] Diterima ${transactions.length} tx`);

    for (const tx of transactions) {
      // Rute 1: event lock Streamflow
      if (isStreamflowLockTx(tx)) {
        await handleStreamflowLock(tx);
        continue;
      }

      // Rute 2: token baru (hanya diproses kalau memang tx TOKEN_MINT/Token Metadata Program)
      if (!isNewTokenMintTx(tx)) continue;

      const mints = extractMints(tx);
      if (mints.length === 0) {
        console.log(`[SKIP-NO-MINT] sig=${tx.signature} type=${tx.type} tidak ada mint terdeteksi`);
        continue;
      }

      for (const mint of mints) {
        // Skip kalau baru saja diproses
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        console.log(`[CANDIDATE] ${mint} - fetching DexScreener...`);
        const pair = await getDexScreenerPair(mint);
        if (!pair) {
          console.log(`[SKIP-NO-PAIR] ${mint} belum ada di DexScreener (kemungkinan indexing delay)`);
          continue;
        }

        const a = analyze(pair);

        // ========== FILTER EARLY KETAT ==========
        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < 20;                 // maksimal 20 menit
        const isLowMcap = a.mcap > 0 && a.mcap < 90000;  // MCap di bawah $90k
        const isDecentLiq = a.liq >= 3000 && a.liq <= 60000;
        const hasActivity = a.vol24 > 5000;
        const passFilter = isEarly && isLowMcap && isDecentLiq && hasActivity && a.score >= 58;

        console.log(
          `[CHECK] ${pair.baseToken?.symbol || mint} | age=${ageMinutes.toFixed(1)}m(${isEarly}) `
          + `mcap=${Math.round(a.mcap)}(${isLowMcap}) liq=${Math.round(a.liq)}(${isDecentLiq}) `
          + `vol24=${Math.round(a.vol24)}(${hasActivity}) score=${a.score}(${a.score >= 58}) -> ${passFilter ? 'LOLOS' : 'SKIP'}`
        );

        if (passFilter) {
          // ========== HARD GATE: keamanan kontrak (RugCheck) ==========
          // Kalau mint/freeze authority masih aktif, skip total - jangan alert
          // sama sekali. Ini risiko fatal, bukan sekadar poin skor pasar.
          const rc = await getRugCheckReport(mint);
          if (rc && (rc.mintAuthorityActive || rc.freezeAuthorityActive)) {
            console.log(`[SKIP-RUGCHECK] ${mint} | mintAuth=${rc.mintAuthorityActive} freezeAuth=${rc.freezeAuthorityActive}`);
            continue;
          }

          const name = pair.baseToken?.name || 'Unknown';
          const sym = pair.baseToken?.symbol || '???';
          const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
          const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
          const url = pair.url || `https://dexscreener.com/solana/${mint}`;
          const streamflowTag = lockedMints.has(mint) ? ' + Streamflow' : '';

          // Ringkasan RugCheck buat ditampilkan (kalau fetch berhasil)
          let rcLine = '⚠️ RugCheck: data tidak tersedia';
          if (rc) {
            const lpStr = rc.lpLockedPct != null ? `LP locked ${Math.round(rc.lpLockedPct)}%` : 'LP lock tidak diketahui';
            const holderStr = rc.topHolderPct != null ? ` | Top holder ${rc.topHolderPct.toFixed(1)}%` : '';
            const scoreStr = rc.riskScore != null ? ` | Risk ${rc.riskScore}` : '';
            rcLine = `✅ Mint/Freeze revoked | ${lpStr}${streamflowTag}${holderStr}${scoreStr}`;
          }

          const msg = `
🚀 <b>EARLY · Score ${a.score}</b>

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()}  |  Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap).toLocaleString()}
Buy% 24h: ${Math.round(a.bp24 * 100)}%
${rcLine}

🔗 <a href="${url}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

<code>${mint}</code>
`.trim();

          await sendTelegram(msg);
          console.log(`[EARLY] ${sym} | Age: ${ageStr} | MCap: ${Math.round(a.mcap)} | Score: ${a.score} | ${rcLine}`);
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
