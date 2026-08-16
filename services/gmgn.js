const fetch = require('node-fetch');
const config = require('../config');

/**
 * Ambil data token dari GMGN (fallback kalau DexScreener masih kosong)
 * Return format mirip DexScreener supaya analyze() tetap bisa dipakai
 */
async function getGmgnToken(mint) {
  try {
    const url = `https://gmgn.ai/defi/quotation/v1/tokens/sol/${mint}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        ...(config.GMGN_API_KEY ? { 'X-APIKEY': config.GMGN_API_KEY } : {})
      },
      timeout: 4000
    });

    if (!res.ok) return null;
    const json = await res.json();
    const d = json?.data;
    if (!d) return null;

    // Normalisasi ke format mirip DexScreener
    const price = Number(d.price || d.price_usd || 0);
    const mcap = Number(d.market_cap || d.fdv || d.usd_market_cap || 0);
    const liq = Number(d.liquidity || d.liquidity_usd || 0);
    const vol24 = Number(d.volume_24h || d.volume || 0);
    const chg24 = Number(d.price_change_percent24h || d.price_change_24h || 0);
    const createdAt = d.open_timestamp
      ? d.open_timestamp * 1000
      : (d.created_timestamp ? d.created_timestamp * 1000 : null);

    return {
      baseToken: {
        name: d.name || d.symbol || 'Unknown',
        symbol: d.symbol || '???',
        address: mint
      },
      priceUsd: price > 0 ? String(price) : null,
      marketCap: mcap,
      fdv: mcap,
      liquidity: { usd: liq },
      volume: { h24: vol24, h1: Number(d.volume_1h || 0), m5: Number(d.volume_5m || 0) },
      priceChange: {
        h24: chg24,
        h1: Number(d.price_change_percent1h || 0),
        m5: Number(d.price_change_percent5m || 0)
      },
      txns: {
        h24: {
          buys: Number(d.buys_24h || d.buy_24h || 0),
          sells: Number(d.sells_24h || d.sell_24h || 0)
        },
        h1: {
          buys: Number(d.buys_1h || 0),
          sells: Number(d.sells_1h || 0)
        },
        m5: {
          buys: Number(d.buys_5m || 0),
          sells: Number(d.sells_5m || 0)
        }
      },
      pairCreatedAt: createdAt,
      url: `https://gmgn.ai/sol/token/${mint}`,
      _source: 'gmgn'
    };
  } catch (e) {
    console.error('GMGN error:', e.message);
    return null;
  }
}

module.exports = { getGmgnToken };
