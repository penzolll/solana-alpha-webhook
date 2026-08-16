const fetch = require('node-fetch');
const { RUGCHECK_TIMEOUT_MS } = require('../config');

async function getRugCheck(mint) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), RUGCHECK_TIMEOUT_MS);

    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

module.exports = { getRugCheck };
