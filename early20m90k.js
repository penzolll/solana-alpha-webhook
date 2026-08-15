require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3000;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const AUTH_HEADER = process.env.AUTH_HEADER || 'supersecret123';

// ============== SOLSCAN CONFIG ==============
const SOLSCAN_API_KEY = process.env.SOLSCAN_API_KEY; // wajib diisi, Solscan Pro API berbayar/butuh key
const SOLSCAN_BASE = 'https://pro-api.solscan.io/v2.0';

if (!SOLSCAN_API_KEY) {
  console.warn('[WARN] SOLSCAN_API_KEY belum diset di .env — request ke Solscan akan gagal (401).');
}

// ============== ANALYZE ==============
function ageH(p) {
  if (!p.pairCreatedAt) return null;
  return (Date.now() - p.pairCreatedAt) / 3.6e6;
}

function analyze(p) {
  const vol24 = p.volume24 || 0;
  const volChg24 = p.volChange24; // % perubahan dex volume 24h (dex_vol_change_24h dari Solscan), bisa null
  const liq = p.liquidity || 0;
  const chg24 = p.priceChange24 ?? 0;
  const trades24 = p.trades24 || 0;
  const tradesPrev24 = p.tradesPrev24 || 0;
  const age = ageH(p);
  const mcap = p.marketCap || 0;
  const holder = p.holder || 0;

  let score = 40;
  const pos = [];
  const neg = [];

  // ---- Momentum trade (pengganti buy/sell pressure DexScreener) ----
  // Solscan tidak memecah jumlah buy vs sell per timeframe seperti DexScreener,
  // jadi dipakai pertumbuhan jumlah trade 24h vs 24h sebelumnya sebagai proxy momentum.
  if (tradesPrev24 > 0) {
    const tradesGrowth = (trades24 - tradesPrev24) / tradesPrev24;
    if (tradesGrowth >= 0.6) { score += 16; pos.push(`Trade count naik +${Math.round(tradesGrowth * 100)}%`); }
    else if (tradesGrowth >= 0.2) { score += 9; pos.push('Trade count naik solid'); }
    else if (tradesGrowth <= -0.35) { score -= 12; neg.push('Trade count turun tajam'); }
  } else if (trades24 >= 20) {
    score += 6; pos.push('Aktivitas trade awal terdeteksi');
  }

  // ---- Volume dex 24h & perubahannya ----
  if (typeof volChg24 === 'number') {
    if (volChg24 > 40) { score += 10; pos.push(`Volume dex naik +${volChg24.toFixed(0)}%`); }
    else if (volChg24 > 15) { score += 5; pos.push('Volume dex naik'); }
    else if (volChg24 < -35) { score -= 8; neg.push('Volume dex turun tajam'); }
  }

  // ---- Umur pool/token ----
  if (age != null) {
    if (age < 1.5 && vol24 > 25000 && trades24 >= 15) { score += 18; pos.push('Sangat early (<1.5j) + hidup'); }
    else if (age < 4 && vol24 > 60000) { score += 13; pos.push('Early (<4j)'); }
    else if (age < 12 && vol24 > 120000) { score += 7; pos.push('Relatif fresh'); }
    else if (age > 48 && chg24 > 100) { score -= 12; neg.push('Tua + pump besar'); }
  }

  // ---- Liquidity ----
  // NOTE: field liquidity/TVL per pool tidak selalu terdokumentasi jelas di
  // /market/info Solscan Pro API. Cek response mentah (console.log) dan sesuaikan
  // nama field di getSolscanTokenPair() bila perlu (mis. tvl, reserve, dsb).
  if (liq >= 100000) { score += 12; pos.push('Liq aman'); }
  else if (liq >= 35000) score += 8;
  else if (liq >= 12000) score += 3;
  else if (liq > 0 && liq < 6000) { score -= 18; neg.push('Liq tipis'); }
  else if (liq > 0 && liq < 12000) { score -= 6; neg.push('Liq rendah'); }

  // ---- Price change 24h ----
  if (chg24 > 12 && chg24 <= 70) { score += 14; pos.push(`Momentum sehat +${chg24.toFixed(0)}%`); }
  else if (chg24 > 70 && chg24 <= 130) { score += 4; pos.push('Naik, ruang terbatas'); }
  else if (chg24 > 180) { score -= 16; neg.push('Parabolic late'); }
  else if (chg24 < -30) { score -= 10; neg.push('Dump 24h'); }

  // ---- Market cap ----
  if (mcap > 0) {
    if (mcap < 250000 && vol24 > 40000) { score += 11; pos.push('MCap early-stage'); }
    else if (mcap < 1200000 && vol24 > 80000) score += 5;
    else if (mcap > 15e6 && chg24 > 40) { score -= 10; neg.push('MCap besar'); }
  }

  // ---- Holder count (pengganti sinyal "boosts" DexScreener) ----
  if (holder > 0) {
    if (holder < 40) { score -= 6; neg.push('Holder masih sangat sedikit'); }
    else if (holder >= 300) { score += 7; pos.push('Holder base luas'); }
    else if (holder >= 100) { score += 3; }
  }

  if (liq > 0 && liq < 4000 && vol24 < 15000) score -= 20;
  if (chg24 > 100 && tradesPrev24 > 0 && trades24 < tradesPrev24 * 0.7 && trades24 > 20) {
    score -= 12; neg.push('Pump + trade melambat = kemungkinan distribusi');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let verdict = 'SKIP';
  const hard = neg.some(n => n.includes('tipis') || n.includes('Parabolic') || n.includes('turun tajam') || n.includes('distribusi'));
  if (score >= 68 && !hard) verdict = 'ALPHA';
  else if (score >= 52 && !neg.some(n => n.includes('tipis') || n.includes('Parabolic'))) verdict = 'WATCH';

  return { score, pos, neg, verdict, age, liq, vol24, mcap, chg24, holder, trades24 };
}

// ============== HELPER ==============
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

// ============== RATE LIMITER ==============
// Akun Solscan Free (Level 1) dibatasi KERAS 60 request/menit oleh Solscan sendiri
// (lihat dashboard API Management). Ini bukan soal hemat kuota (CU bulanan kamu longgar,
// 10.000.000 CU), tapi supaya request TIDAK kena 429 saat webhook kirim banyak mint
// sekaligus — karena request yang gagal karena 429 justru bikin data hilang/tidak akurat.
// Buffer dipasang ke 50/menit (bukan mepet 60) untuk jaga-jaga request lain yang mungkin
// jalan bersamaan (mis. kamu buka dashboard Solscan di tab lain).
const RATE_LIMIT_PER_MIN = 50;
const requestTimestamps = [];
const rateQueue = [];
let pumping = false;

function withinRateLimit() {
  const now = Date.now();
  while (requestTimestamps.length && now - requestTimestamps[0] > 60000) {
    requestTimestamps.shift();
  }
  return requestTimestamps.length < RATE_LIMIT_PER_MIN;
}

function pumpQueue() {
  if (pumping) return;
  pumping = true;

  const tick = () => {
    if (rateQueue.length === 0) { pumping = false; return; }
    if (!withinRateLimit()) { setTimeout(tick, 200); return; }

    requestTimestamps.push(Date.now());
    const job = rateQueue.shift();
    job();

    // Sebar merata: 50/menit ≈ 1 request tiap 1.2 detik
    setTimeout(tick, 1200);
  };

  tick();
}

function rateLimited(fn) {
  return new Promise((resolve) => {
    rateQueue.push(async () => resolve(await fn()));
    pumpQueue();
  });
}

// ============== SOLSCAN CLIENT ==============
async function solscanFetchRaw(path, params = {}) {
  const url = new URL(SOLSCAN_BASE + path);
  Object.entries(params).forEach(([key, val]) => {
    if (val === undefined || val === null) return;
    if (Array.isArray(val)) {
      val.forEach(v => url.searchParams.append(`${key}[]`, v));
    } else {
      url.searchParams.set(key, val);
    }
  });

  const res = await fetch(url.toString(), {
    headers: { token: SOLSCAN_API_KEY }
  });

  if (res.status === 429) {
    // Fallback jaga-jaga kalau rate limiter tetap kebobolan (mis. request lain di luar proses ini)
    console.warn(`Solscan ${path} kena 429, retry sekali setelah delay...`);
    await new Promise(r => setTimeout(r, 1500));
    return solscanFetchRaw(path, params);
  }

  if (!res.ok) {
    console.error(`Solscan ${path} HTTP ${res.status}`);
    return null;
  }

  const json = await res.json();
  if (!json || json.success === false) return null;
  return json.data ?? null;
}

function solscanFetch(path, params = {}) {
  return rateLimited(() => solscanFetchRaw(path, params).catch(e => {
    console.error(`Solscan ${path} error:`, e.message);
    return null;
  }));
}

async function getSolscanTokenPair(mint) {
  try {
    // 1) Metadata token: price, market cap, volume 24h, price change, holder, waktu dibuat
    const meta = await solscanFetch('/token/meta', { address: mint });
    if (!meta) return null;

    // 2) SEMUA pool/market token ini (bukan cuma top-1), supaya liquidity & momentum trade
    //    dihitung dari keseluruhan pool yang beredar (pump.fun tokens sering punya >1 pool:
    //    bonding curve + Raydium/Meteora setelah migrasi). Kalau cuma ambil 1 pool teratas,
    //    liquidity riil token bisa under-reported.
    const markets = await solscanFetch('/token/markets', {
      token: [mint],
      sort_by: 'volume',
      page_size: 20
    });

    let trades24 = 0;
    let tradesPrev24 = 0;
    let marketVol24 = 0;
    let pairCreatedAt = meta.created_time ? meta.created_time * 1000 : null;
    let liquidity = 0;

    if (Array.isArray(markets) && markets.length > 0) {
      // Ambil sampai 3 pool teraktif untuk di-detail-kan lewat market/info.
      // Menghindari flood call kalau token punya puluhan pool micro-liquidity yang tidak relevan.
      const topPools = markets.slice(0, 3);

      // Jalankan market/info untuk tiap pool SECARA PARALEL (tetap lewat rate limiter,
      // jadi tetap aman terhadap limit 60 req/menit meski dipanggil bersamaan).
      const infos = await Promise.all(
        topPools.map(m => solscanFetch('/market/info', { address: m.pool_id }))
      );

      topPools.forEach((m, i) => {
        trades24 += m.total_trades_24h || 0;
        tradesPrev24 += m.total_trades_prev_24h || 0;
        marketVol24 += m.total_volume_24h || 0;

        const info = infos[i];
        if (info) {
          // Pool tertua di antara yang terdeteksi dianggap sebagai waktu pair pertama kali dibuat
          if (info.create_block_time) {
            const t = info.create_block_time * 1000;
            if (pairCreatedAt === null || t < pairCreatedAt) pairCreatedAt = t;
          }
          // TODO: sesuaikan nama field ini dengan response asli akun Solscan kamu —
          // dokumentasi publik tidak menegaskan nama field liquidity/TVL di endpoint ini.
          // Jalankan sekali console.log(JSON.stringify(info)) untuk konfirmasi field aslinya.
          liquidity += info.liquidity || info.tvl || info.total_liquidity || 0;
        }
      });
    }

    return {
      mint,
      baseToken: { name: meta.name || 'Unknown', symbol: meta.symbol || '???' },
      priceUsd: meta.price || 0,
      marketCap: meta.market_cap || 0,
      liquidity,
      volume24: meta.total_dex_vol_24h || marketVol24 || meta.volume_24h || 0,
      volChange24: typeof meta.dex_vol_change_24h === 'number' ? meta.dex_vol_change_24h : null,
      priceChange24: meta.price_change_24h ?? 0,
      trades24,
      tradesPrev24,
      holder: meta.holder || 0,
      pairCreatedAt,
      poolCount: Array.isArray(markets) ? markets.length : 0
    };
  } catch (e) {
    console.error('getSolscanTokenPair error:', e.message);
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
      const mints = extractMints(tx);
      if (mints.length === 0) continue;

      for (const mint of mints) {
        // Skip kalau baru saja diproses
        if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) continue;
        seen.set(mint, Date.now());

        const pair = await getSolscanTokenPair(mint);
        if (!pair) continue;

        const a = analyze(pair);

        // ========== FILTER EARLY KETAT ==========
        const ageMinutes = a.age !== null ? a.age * 60 : 999;
        const isEarly = ageMinutes < 20;                 // maksimal 20 menit
        const isLowMcap = a.mcap > 0 && a.mcap < 90000;  // MCap di bawah $90k
        const isDecentLiq = a.liq === 0 || (a.liq >= 3000 && a.liq <= 60000); // fallback longgar kalau liq belum kebaca
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

          const msg = `
🚀 <b>EARLY · Score ${a.score}</b>

<b>${name}</b> ($${sym})
💰 ${price}  |  📈 ${a.chg24 >= 0 ? '+' : ''}${a.chg24.toFixed(1)}%
💧 Liq: $${Math.round(a.liq).toLocaleString()}  |  Vol24: $${Math.round(a.vol24).toLocaleString()}
⏱ Age: ${ageStr}  |  MCap: $${Math.round(a.mcap).toLocaleString()}
👥 Holder: ${a.holder.toLocaleString()}  |  Trades24h: ${a.trades24.toLocaleString()}
🏊 Pool terdeteksi: ${pair.poolCount}

🔗 <a href="https://solscan.io/token/${mint}">Solscan</a>
🔗 <a href="https://birdeye.so/token/${mint}?chain=solana">Birdeye</a>
🔗 <a href="https://rugcheck.xyz/tokens/${mint}">RugCheck</a>

<code>${mint}</code>
`.trim();

          await sendTelegram(msg);
          console.log(`[EARLY] ${sym} | Age: ${ageStr} | MCap: ${Math.round(a.mcap)} | Score: ${a.score}`);
        }
      }
    }
  } catch (err) {
    console.error('Webhook process error:', err);
  }
});

app.get('/', (req, res) => res.send('Solana Alpha Webhook (Solscan) is running'));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
