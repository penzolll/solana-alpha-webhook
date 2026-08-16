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

  let score = 45; // base lebih tinggi untuk early
  const pos = [];
  const neg = [];

  // ===== BUY PRESSURE (sangat penting di early) =====
  if (t5m >= 3) {
    if (bp5m >= 0.70) { score += 14; pos.push('Buy% 5m sangat kuat'); }
    else if (bp5m >= 0.60) { score += 9; pos.push('Buy% 5m solid'); }
    else if (bp5m < 0.35) { score -= 10; neg.push('Sell pressure 5m'); }
  }

  if (t1h >= 6) {
    if (bp1h >= 0.65) { score += 12; pos.push('Buy% 1h kuat'); }
    else if (bp1h < 0.40) { score -= 9; neg.push('Sell dominance 1h'); }
  }

  if (t24 >= 15) {
    if (bp24 >= 0.62) { score += 8; pos.push('Buy% 24h bagus'); }
    else if (bp24 < 0.42) { score -= 8; neg.push('Sell dominance 24h'); }
  }

  // Multi timeframe pressure
  if (bp5m >= 0.58 && bp1h >= 0.58 && t5m >= 3 && t1h >= 5) {
    score += 10; pos.push('Buy pressure multi-TF');
  }

  // ===== VOLUME & MOMENTUM =====
  if (vol5m > 1500 && chg5m > 0 && bp5m >= 0.55) {
    score += 9; pos.push('Burst 5m + buy');
  }
  if (vol1h > 8000 && chg1h > 5) {
    score += 7; pos.push('Vol 1h hidup');
  }

  // ===== AGE (sangat penting) =====
  if (age != null) {
    if (age < 0.25) {          // < 15 menit
      score += 16; pos.push('Sangat fresh (<15m)');
    } else if (age < 0.5) {    // < 30 menit
      score += 11; pos.push('Fresh (<30m)');
    } else if (age < 1.5) {
      score += 6; pos.push('Early');
    } else if (age > 6) {
      score -= 8; neg.push('Sudah agak tua');
    }
  }

  // ===== LIQUIDITY (lebih toleran di early) =====
  if (liq >= 25000) { score += 9; pos.push('Liq bagus'); }
  else if (liq >= 10000) { score += 5; }
  else if (liq >= 4000) { score += 2; }
  else if (liq < 2500) { score -= 12; neg.push('Liq sangat tipis'); }
  else if (liq < 4000) { score -= 5; neg.push('Liq rendah'); }

  // ===== PRICE CHANGE =====
  if (chg5m > 8 && chg5m < 80) { score += 8; pos.push('Momentum 5m sehat'); }
  if (chg1h > 15 && chg1h < 120) { score += 6; pos.push('Momentum 1h bagus'); }
  if (chg24 > 200) { score -= 14; neg.push('Parabolic'); }
  if (chg24 < -25) { score -= 8; neg.push('Dump'); }

  // ===== MCAP =====
  if (mcap > 0) {
    if (mcap < 40000) { score += 10; pos.push('MCap sangat early'); }
    else if (mcap < 90000) { score += 6; pos.push('MCap early'); }
    else if (mcap > 300000) { score -= 7; neg.push('MCap sudah tinggi'); }
  }

  // ===== BOOST =====
  if (boosts >= 3) { score += 5; pos.push('Ada boost'); }

  // Hard penalties
  if (liq < 2000 && vol24 < 8000) score -= 15;
  if (chg24 > 150 && bp24 < 0.48) { score -= 10; neg.push('Pump + sell = distribusi'); }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Verdict
  let verdict = 'SKIP';
  const hard = neg.some(n => 
    n.includes('sangat tipis') || 
    n.includes('Parabolic') || 
    n.includes('distribusi')
  );

  if (score >= 70 && !hard) verdict = 'ALPHA';
  else if (score >= 55 && !hard) verdict = 'WATCH';

  return { score, pos, neg, verdict, bp24, bp1h, age, liq, vol24, mcap, chg24 };
}
