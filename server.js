// MemeSentinel backend - local dev server
// Purpose: check/scan Solana meme coins
// Run with: node server.js
// Listens on http://localhost:3001 (matches extension's "Local dev" setting)

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ---- Status / health endpoints ----
// Extension's "Test" button might call any of these paths, so we cover the common ones.
const statusHandler = (req, res) => {
  res.json({ status: 'ok', service: 'memesentinel-backend', chain: 'solana' });
};

app.get('/', statusHandler);
app.get('/health', statusHandler);
app.get('/status', statusHandler);
app.get('/api/status', statusHandler);
app.get('/api/health', statusHandler);
app.get('/ping', statusHandler);

// ---- Solana meme coin check ----
// Uses DexScreener public API (no key required) to pull token info.
// GET /api/token/:address  -> basic info for a single Solana token/pair
app.get('/api/token/:address', async (req, res) => {
  const { address } = req.params;
  try {
    const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    if (!resp.ok) {
      return res.status(resp.status).json({ error: 'Failed to fetch token data' });
    }
    const data = await resp.json();

    const pairs = (data.pairs || []).filter((p) => p.chainId === 'solana');
    if (pairs.length === 0) {
      return res.status(404).json({ error: 'No Solana pairs found for this token' });
    }

    // Use the pair with the highest liquidity as the primary result
    const best = pairs.sort(
      (a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];

    res.json({
      address,
      name: best.baseToken?.name,
      symbol: best.baseToken?.symbol,
      priceUsd: best.priceUsd,
      liquidityUsd: best.liquidity?.usd,
      fdv: best.fdv,
      volume24h: best.volume?.h24,
      priceChange24h: best.priceChange?.h24,
      pairCreatedAt: best.pairCreatedAt,
      dexUrl: best.url,
    });
  } catch (err) {
    console.error('[API] Token check error:', err.message);
    res.status(500).json({ error: 'Internal error fetching token data' });
  }
});

// ---- HTTP + WebSocket server ----
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let connectedClients = 0;

wss.on('connection', (ws) => {
  connectedClients++;
  console.log(`[WS] Client connected (total: ${connectedClients})`);

  ws.send(JSON.stringify({ type: 'welcome', message: 'Connected to MemeSentinel backend' }));

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }

    console.log('[WS] Received:', msg);

    // Example protocol: { type: "check", address: "<solana token mint address>" }
    if (msg.type === 'check' && msg.address) {
      try {
        const resp = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${msg.address}`);
        const data = await resp.json();
        const pairs = (data.pairs || []).filter((p) => p.chainId === 'solana');
        const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

        ws.send(JSON.stringify({
          type: 'token_result',
          address: msg.address,
          data: best || null,
        }));
      } catch (err) {
        ws.send(JSON.stringify({ type: 'error', message: 'Failed to check token' }));
      }
    } else {
      // Default echo for unrecognized message types (useful while debugging protocol)
      ws.send(JSON.stringify({ type: 'echo', data: msg }));
    }
  });

  ws.on('close', () => {
    connectedClients--;
    console.log(`[WS] Client disconnected (total: ${connectedClients})`);
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`MemeSentinel backend running at http://localhost:${PORT}`);
  console.log(`WebSocket available at ws://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/api/token/<solana-token-address>`);
});
