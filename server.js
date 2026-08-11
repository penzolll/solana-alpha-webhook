require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

// Program address
const PUMPSWAP_PROGRAM_ID = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
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

  if (t24 >= 25) {
    if (bp24 >= 0.68) score += 18;
    else if (bp24 >= 0.58) score += 11;
    else if (bp24 < 0.42) score -= 14;
  }
  if (t1h >= 8) {
    if (bp1h >= 0.65) score += 12;
    else if (bp1h < 0.4) score -= 10;
  }
  if (t5m >= 4) {
    if (bp5m >= 0.65) score += 8;
    else if (bp5m < 0.35) score -= 8;
  }
  if (bp24 >= 0.55 && bp1h >= 0.55 && t24 >= 20 && t1h >= 6) score += 8;

  if (vol24 > 20000) {
    const s1 = vol1h / vol24;
    const s5 = vol5m / vol24;
    if (s1 > 0.25 && chg1h > 0) score += 10;
    if (s5 > 0.08 && chg5m > 0 && bp5m >= 0.5) score += 8;
  }

  if (age != null) {
    if (age < 1.5 && vol24 > 25000 && t24 >= 15) score += 18;
    else if (age < 4 && vol24 > 60000) score += 13;
    else if (age < 12 && vol24 > 120000) score += 7;
    else if (age > 48 && chg24 > 100) score -= 12;
  }

  if (liq >= 100000) score += 12;
  else if (liq >= 35000) score += 8;
  else if (liq >= 12000) score += 3;
  else if (liq < 6000) score -= 18;
  else if (liq < 12000) score -= 6;

  if (chg24 > 12 && chg24 <= 70) score += 14;
  else if (chg24 > 70 && chg24 <= 130) score += 4;
  else if (chg24 > 180) score -= 16;
  else if (chg24 < -30) score -= 10;

  if (mcap > 0) {
    if (mcap < 250000 && vol24 > 40000) score += 11;
    else if (mcap < 1200000 && vol24 > 80000) score += 5;
    else if (mcap > 15e6 && chg24 > 40) score -= 10;
  }

  if (boosts >= 5) score += 7;
  else if (boosts >= 1) score += 2;

  if (liq < 4000 && vol24 < 15000) score -= 20;
  if (chg24 > 100 && bp24 < 0.45 && t24 > 20) score -= 12;

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, bp24, age, liq, vol24, mcap, chg24 };
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

function isPumpSwapMigrationTx(tx) {
  const ixs = tx.instructions || [];
  return ixs.some(ix => ix.programId === PUMPSWAP_PROGRAM_ID);
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

async function getRugCheckReport(mint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();

    const mintAuthority = data?.token?.mintAuthority || data?.mintAuthority || null;
    const freezeAuthority = data?.token?.freezeAuthority || data?.freezeAuthority || null;

    let lpLockedPct = null;
    for (const m of (data?.markets || [])) {
      const pct = m?.lp?.lpLockedPct ?? m?.lp?.lpLockedPercent ?? null;
      if (pct != null) { lpLockedPct = pct; break; }
    }

    const topHolders = data?.topHolders || [];
    const topHolderPct = topHolders.length > 0 ? (topHolders[0]?.pct || 0) : null;
    const riskScore = data?.score_normalised ?? data?.score ?? null;

    return {
      mintAuthorityActive: !!mintAuthority,
      freezeAuthorityActive: !!freezeAuthority,
      lpLockedPct,
      topHolderPct,
      riskScore,
    };
  } catch (e) {
    console.error('RugCheck error:', e.message);
    return null;
  }
}

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('Telegram belum diset:', message);
    return;
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
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

const seen = new Map();
const SEEN_TTL = 1000 * 60 * 45;
const lockedMints = new Map();

function isStreamflowTx(tx) {
  if (tx.source === 'STREAMFLOW_TIMELOCK') return true;
  return (tx.instructions || []).some(ix => ix.programId === STREAMFLOW_PROGRAM_ID);
}

function isStreamflowLockTx(tx) {
  if (!isStreamflowTx(tx)) return false;
  if (tx.type === 'WITHDRAW') return false;
  if (tx.type === 'DEPOSIT') return true;
  console.log(`[STREAMFLOW-UNKNOWN] type=${tx.type} sig=${tx.signature}`);
  return false;
}

function extractLockInfo(tx) {
  const transfer = (tx.tokenTransfers || []).find(t => t.mint && t.mint !== 'So11111111111111111111111111111111111111112');
  const streamflowIx = (tx.instructions || []).find(ix => ix.programId === STREAMFLOW_PROGRAM_ID);
  return {
    mint: transfer?.mint || null,
    amount: transfer?.tokenAmount || null,
    vault: streamflowIx?.accounts?.[0] || null,
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
  console.log(`[LOCK] ${info.mint}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function processMigration(mint) {
  if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) return;
  seen.set(mint, Date.now());

  console.log(`[MIGRATION] ${mint} - fetching data...`);

  // Retry karena kadang belum muncul di DexScreener
  const delays = [10000, 20000, 30000];
  let pair = await getDexScreenerPair(mint);
  for (let i = 0; !pair && i < delays.length; i++) {
    console.log(`[RETRY] ${mint} belum ada, tunggu ${delays[i]/1000}s`);
    await sleep(delays[i]);
    pair = await getDexScreenerPair(mint);
  }

  if (!pair) {
    console.log(`[SKIP] ${mint} tidak ditemukan di DexScreener`);
    return;
  }

  const a = analyze(pair);
  const rc = await getRugCheckReport(mint);

  // Hard gate keamanan
  if (rc && (rc.mintAuthorityActive || rc.freezeAuthorityActive)) {
    console.log(`[SKIP-RUG] ${mint} masih ada mint/freeze authority`);
    return;
  }
  if (rc && rc.topHolderPct != null && rc.topHolderPct > 40) {
    console.log(`[SKIP-RUG] ${mint} top holder ${rc.topHolderPct}%`);
    return;
  }
  if (rc && rc.riskScore != null && rc.riskScore > 50) {
    console.log(`[SKIP-RUG] ${mint} risk score ${rc.riskScore}`);
    return;
  }

  const name = pair.baseToken?.name || 'Unknown';
  const sym = pair.baseToken?.symbol || '???';
  const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
  const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
  const url = pair.url || `https://dexscreener.com/solana/${mint}`;
  const streamflowTag = lockedMints.has(mint) ? ' + Streamflow' : '';

  let rcLine = '⚠️ RugCheck: data tidak tersedia';
  if (rc) {
    const lpStr = rc.lpLockedPct != null ? `LP locked ${Math.round(rc.lpLockedPct)}%` : 'LP lock ?';
    const holderStr = rc.topHolderPct != null ? ` | Top ${rc.topHolderPct.toFixed(1)}%` : '';
    const scoreStr = rc.riskScore != null ? ` | Risk ${rc.riskScore}` : '';
    rcLine = `✅ Mint/Freeze revoked | ${lpStr}${streamflowTag}${holderStr}${scoreStr}`;
  }

  const msg = `
🎓 <b>MIGRASI PUMP.FUN → PUMPSWAP</b> · Score ${a.score}

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
  console.log(`[SENT] ${sym} | MCap $${Math.round(a.mcap)} | Score ${a.score}`);
}

// ============== WEBHOOK ==============
app.post('/webhook', async (req, res) => {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (AUTH_HEADER && auth !== AUTH_HEADER) {
    return res.status(401).send('Unauthorized');
  }

  res.status(200).send('OK');

  try {
    const transactions = Array.isArray(req.body) ? req.body : [req.body];
    console.log(`[WEBHOOK] ${transactions.length} tx`);

    for (const tx of transactions) {
      // Streamflow lock (opsional, tetap dipertahankan)
      if (isStreamflowLockTx(tx)) {
        await handleStreamflowLock(tx);
        continue;
      }

      // HANYA migrasi Pump.fun → PumpSwap
      if (isPumpSwapMigrationTx(tx)) {
        const mints = extractMints(tx);
        for (const mint of mints) {
          await processMigration(mint);
        }
      }
    }
  } catch (err) {
    console.error('Webhook error:', err);
  }
});

app.get('/locked', (req, res) => {
  const list = [...lockedMints.entries()].map(([mint, data]) => ({ mint, ...data }));
  res.json(list);
});

app.get('/', (req, res) => res.send('Pump.fun Migration Webhook is running'));

app.listen(PORT, () => {
  console.log(`🚀 Pump.fun Migration Webhook running on port ${PORT}`);
});
