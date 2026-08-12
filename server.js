require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const app = express();
app.use(express.json({ limit: '10mb' }));
const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

// Program address (sudah dioptimasi)
const PUMPFUN_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMPFUN_MIGRATION_PROGRAM_ID = '39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg';
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

function isPumpfunMigrationTx(tx) {
  const ixs = tx.instructions || [];
  return ixs.some(ix =>
    (ix.programId === PUMPFUN_PROGRAM_ID && ix.name === 'migrate') ||
    ix.programId === PUMPFUN_MIGRATION_PROGRAM_ID
  );
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
  const msg = `
🔒 <b>Streamflow Lock Terdeteksi</b>
Mint: <code>${info.mint}</code>
${info.amount ? `Jumlah: ${info.amount}\n` : ''}
${info.vault ? `Vault: <code>${info.vault}</code>\n` : ''}
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

  const rc = await getRugCheckReport(mint);

  if (rc && (rc.mintAuthorityActive || rc.freezeAuthorityActive)) {
    console.log(`[SKIP-RUG] ${mint} masih ada mint/freeze authority`);
    return;
  }
  if (rc && rc.riskScore != null && rc.riskScore > 50) {
    console.log(`[SKIP-RUG] ${mint} risk score ${rc.riskScore}`);
    return;
  }

  const name = pair.baseToken?.name || 'Unknown';
  const sym = pair.baseToken?.symbol || '???';
  const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
  const url = pair.url || `https://dexscreener.com/solana/${mint}`;

  let rcLine = '⚠️ RugCheck: data tidak tersedia';
  if (rc) {
    const lpStr = rc.lpLockedPct != null ? `LP locked ${Math.round(rc.lpLockedPct)}%` : 'LP lock ?';
    const holderStr = rc.topHolderPct != null ? ` | Top ${rc.topHolderPct.toFixed(1)}%` : '';
    const scoreStr = rc.riskScore != null ? ` | Risk ${rc.riskScore}` : '';
    rcLine = `✅ Mint/Freeze revoked | ${lpStr}${holderStr}${scoreStr}`;
  }

  const msg = `
🎓 <b>MIGRASI PUMP.FUN → PUMPSWAP</b>
<b>${name}</b> ($${sym})
💰 ${price}
${rcLine}
🔗 <a href="${url}">DexScreener</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>
<code>${mint}</code>
`.trim();

  await sendTelegram(msg);
  console.log(`[SENT] ${sym} | ${rcLine}`);
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
      if (isStreamflowLockTx(tx)) {
        await handleStreamflowLock(tx);
        continue;
      }

      if (isPumpfunMigrationTx(tx)) {
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

app.get('/', (req, res) => res.send('Pump.fun Migration Webhook running — ONLY Pump.fun Migration sekarang aktif'));

app.listen(PORT, () => {
  console.log(`🚀 Pump.fun Migration Webhook running on port ${PORT} (sudah dioptimasi)`);
});
