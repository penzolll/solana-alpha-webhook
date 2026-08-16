const { SEEN_TTL_MS } = require('../config');

const seen = new Map();

function isSeen(mint) {
  if (seen.has(mint) && Date.now() - seen.get(mint) < SEEN_TTL_MS) {
    return true;
  }
  seen.set(mint, Date.now());
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [mint, ts] of seen.entries()) {
    if (now - ts > SEEN_TTL_MS) seen.delete(mint);
  }
}, 1000 * 60 * 10);

module.exports = { isSeen };
