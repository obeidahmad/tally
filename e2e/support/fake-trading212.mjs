// Spec 16: a fake Trading212, started by start-server.mjs on E2E_PORT+2. Never reaches the real API.
// Tests register one "account" per API key through POST /__fake/keys, so tests never share state.
// It enforces the documented limits (portfolio 1 per 5 s, cash 1 per 2 s) by answering 429 and counting the hit, so a server that does not wait is caught.
import { createServer } from 'node:http';

const PAGE = 2; // dividends per page, so a sync has to follow nextPagePath
const accounts = new Map(); // key -> { secret?, currencyCode, free, positions, instruments, dividends, mode, log }
const LIMIT_MS = { portfolio: 5000, cash: 2000 };

const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s ? JSON.parse(s) : {})); });

function authenticate(req) {
  const h = req.headers.authorization ?? '';
  let key = h, secret = null;
  if (h.startsWith('Basic ')) {
    const [k, ...rest] = Buffer.from(h.slice(6), 'base64').toString().split(':');
    key = k; secret = rest.join(':');
  }
  const acc = accounts.get(key);
  if (!acc) return { error: 'unknown key' };
  if (acc.secret ? secret !== acc.secret : secret !== null) return { acc, error: 'wrong auth scheme' };
  return { acc };
}

export function startFakeTrading212(port) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname.replace(/^\/api\/v0/, '');
    if (path.startsWith('/__fake/keys')) {
      const parts = path.split('/').filter(Boolean); // __fake, keys, :key?, log?
      if (req.method === 'POST' && parts.length === 2) {
        const b = await readBody(req);
        accounts.set(b.key, { secret: b.secret ?? null, currencyCode: 'EUR', free: 0, positions: [], instruments: [], dividends: [], mode: 'ok', ...b.config, log: { calls: [], errors: [], limitHits: 0, last: {} } });
        return send(res, 204);
      }
      const acc = accounts.get(decodeURIComponent(parts[2] ?? ''));
      if (!acc) return send(res, 404, { error: 'no such fake key' });
      if (req.method === 'PATCH') { Object.assign(acc, await readBody(req)); return send(res, 204); }
      if (req.method === 'GET' && parts[3] === 'log') return send(res, 200, acc.log);
      return send(res, 405);
    }
    const { acc, error } = authenticate(req);
    if (error) { acc?.log.errors.push(`${req.method} ${req.url}: ${error}`); return send(res, 401, { error }); }
    acc.log.calls.push({ at: Date.now(), path: path + url.search, authorization: req.headers.authorization.startsWith('Basic ') ? 'basic' : 'key' });
    if (acc.mode === 'refuse') return send(res, 401, { error: 'bad key' });
    if (acc.mode === 'down') return send(res, 503, { error: 'unavailable' });
    if (acc.mode === 'slow') return send(res, 429, { error: 'slow down' }, { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1) });
    const gap = LIMIT_MS[path === '/equity/portfolio' ? 'portfolio' : path === '/equity/account/cash' ? 'cash' : ''];
    if (gap) {
      const now = Date.now(), prev = acc.log.last[path];
      if (prev && now - prev < gap - 100) { acc.log.limitHits++; return send(res, 429, { error: 'rate limited' }, { 'x-ratelimit-reset': String(Math.ceil((prev + gap) / 1000)) }); }
      acc.log.last[path] = now;
    }
    if (path === '/equity/account/info') return send(res, 200, { currencyCode: acc.currencyCode, id: 1234567 });
    if (path === '/equity/account/cash') return send(res, 200, { free: acc.free, total: acc.free, ppl: 0, result: 0, invested: 0, pieCash: 0, blocked: 0 });
    if (path === '/equity/portfolio') return send(res, 200, acc.positions.map((p) => ({ averagePrice: p.currentPrice, initialFillDate: '2025-01-01T10:00:00Z', frontend: 'API', maxBuy: 1000, maxSell: p.quantity, pieQuantity: 0, ...p })));
    if (path === '/equity/metadata/instruments') return send(res, 200, acc.instruments);
    if (path === '/history/dividends') {
      const from = Number(url.searchParams.get('cursor') ?? 0);
      const items = acc.dividends.slice(from, from + PAGE).map((d) => ({ type: 'ORDINARY', quantity: 1, amountInEuro: d.amount, ...d }));
      const more = from + PAGE < acc.dividends.length;
      return send(res, 200, { items, nextPagePath: more ? `/api/v0/history/dividends?cursor=${from + PAGE}&limit=${PAGE}` : null });
    }
    send(res, 404, { error: `fake Trading212 has no ${path}` });
  });
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', () => ok(server)); });
}
