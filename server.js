async function processCandidate(mint, source) {
  // Skip kalau baru saja diproses
  if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL) return;
  seen.set(mint, Date.now());

  console.log(`[CANDIDATE:${source}] ${mint} - fetching DexScreener...`);

  // Retry DexScreener (token baru sering belum ke-index)
  const RETRY_DELAYS_MS = [15000, 30000, 45000];
  let pair = await getDexScreenerPair(mint);

  for (let i = 0; !pair && i < RETRY_DELAYS_MS.length; i++) {
    console.log(`[RETRY-PAIR] ${mint} belum ada di DexScreener, coba lagi dalam ${RETRY_DELAYS_MS[i] / 1000}s`);
    await sleep(RETRY_DELAYS_MS[i]);
    pair = await getDexScreenerPair(mint);
  }

  if (!pair) {
    console.log(`[SKIP-NO-PAIR] ${mint} tetap tidak ada di DexScreener setelah retry`);
    return;
  }

  const a = analyze(pair);

  // ========== HARD GATE: keamanan kontrak (RugCheck) ==========
  const rc = await getRugCheckReport(mint);
  if (rc && (rc.mintAuthorityActive || rc.freezeAuthorityActive)) {
    console.log(`[SKIP-RUGCHECK] ${mint} | mintAuth=${rc.mintAuthorityActive} freezeAuth=${rc.freezeAuthorityActive}`);
    return;
  }

  // Top holder terlalu dominan
  const MAX_TOP_HOLDER_PCT = 40;
  if (rc && rc.topHolderPct != null && rc.topHolderPct > MAX_TOP_HOLDER_PCT) {
    console.log(`[SKIP-RUGCHECK] ${mint} | topHolderPct=${rc.topHolderPct}% > ${MAX_TOP_HOLDER_PCT}%`);
    return;
  }

  // Risk score terlalu tinggi
  const MAX_RUGCHECK_RISK = 50;
  if (rc && rc.riskScore != null && rc.riskScore > MAX_RUGCHECK_RISK) {
    console.log(`[SKIP-RUGCHECK] ${mint} | riskScore=${rc.riskScore} > ${MAX_RUGCHECK_RISK}`);
    return;
  }

  // ========== LOGIKA ALERT ==========
  const isMigration = source === 'pumpswap-migration';

  // Untuk migrasi Pump.fun → selalu kirim alert
  // Untuk sumber lain → tetap pakai filter early ketat
  if (!isMigration) {
    const ageMinutes = a.age !== null ? a.age * 60 : 999;
    const isEarly = ageMinutes < 20;
    const isLowMcap = a.mcap > 0 && a.mcap < 90000;
    const isDecentLiq = a.liq >= 3000 && a.liq <= 60000;
    const hasActivity = a.vol24 > 5000;
    const passFilter = isEarly && isLowMcap && isDecentLiq && hasActivity && a.score >= 58;

    console.log(
      `[CHECK:${source}] ${pair.baseToken?.symbol || mint} | age=${ageMinutes.toFixed(1)}m(${isEarly}) ` +
      `mcap=${Math.round(a.mcap)} liq=${Math.round(a.liq)} vol24=${Math.round(a.vol24)} score=${a.score} -> ${passFilter ? 'LOLOS' : 'SKIP'}`
    );

    if (!passFilter) return;
  } else {
    console.log(`[MIGRATION] ${pair.baseToken?.symbol || mint} | MCap: $${Math.round(a.mcap).toLocaleString()} | Score: ${a.score} → KIRIM SEMUA`);
  }

  // ========== FORMAT PESAN ==========
  const name = pair.baseToken?.name || 'Unknown';
  const sym = pair.baseToken?.symbol || '???';
  const price = pair.priceUsd ? `$${Number(pair.priceUsd).toPrecision(4)}` : '—';
  const ageStr = a.age == null ? '—' : (a.age < 1 ? Math.round(a.age * 60) + 'm' : a.age.toFixed(1) + 'h');
  const url = pair.url || `https://dexscreener.com/solana/${mint}`;
  const streamflowTag = lockedMints.has(mint) ? ' + Streamflow' : '';

  let rcLine = '⚠️ RugCheck: data tidak tersedia';
  if (rc) {
    const lpStr = rc.lpLockedPct != null ? `LP locked ${Math.round(rc.lpLockedPct)}%` : 'LP lock tidak diketahui';
    const holderStr = rc.topHolderPct != null ? ` | Top holder ${rc.topHolderPct.toFixed(1)}%` : '';
    const scoreStr = rc.riskScore != null ? ` | Risk ${rc.riskScore}` : '';
    rcLine = `✅ Mint/Freeze revoked | ${lpStr}${streamflowTag}${holderStr}${scoreStr}`;
  }

  const sourceTag = isMigration
    ? '🎓 Migrasi Pump.fun → PumpSwap'
    : source === 'rugcheck-poll'
      ? '🔍 via RugCheck'
      : '📡 via Helius';

  const title = isMigration
    ? `🎓 <b>MIGRASI PUMP.FUN</b> · Score ${a.score}`
    : `🚀 <b>EARLY · Score ${a.score}</b>`;

  const msg = `
${title}  <i>${sourceTag}</i>

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
  console.log(`[${isMigration ? 'MIGRATION' : 'EARLY'}:${source}] ${sym} | Age: ${ageStr} | MCap: ${Math.round(a.mcap)} | Score: ${a.score}`);
}
