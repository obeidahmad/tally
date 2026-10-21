// Spec 17: a fake Enable Banking, started by start-server.mjs. Never reaches the real API.
// Tests configure one "app" per application ID through POST /__fake/apps; the JWT's `kid` picks the app, so tests never share state.
import { createServer } from 'node:http';
import { createPublicKey, randomUUID, verify } from 'node:crypto';

const BANKS = [
  { name: 'Bank of Cyprus', country: 'CY' }, { name: 'Revolut', country: 'CY' },
  { name: 'Piraeus Bank', country: 'GR' }, { name: 'Revolut Bank UAB', country: 'LT' },
];
const PAGE = 2; // transactions per page, so a sync has to follow continuation_key
const apps = new Map(); // applicationId -> { publicKey, config, log, auths, codes }

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? '' : JSON.stringify(body));
};
const readBody = (req) => new Promise((ok) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => ok(s ? JSON.parse(s) : {})); });
const b64 = (s) => JSON.parse(Buffer.from(s, 'base64url').toString());

function authenticate(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '');
  if (!m) return { error: 'no bearer token' };
  const [h, c, sig] = m[1].split('.');
  if (!sig) return { error: 'not a JWT' };
  let header, claims;
  try { header = b64(h); claims = b64(c); } catch { return { error: 'unreadable JWT' }; }
  const app = apps.get(header.kid);
  if (!app) return { error: `unknown kid ${header.kid}` };
  const now = Date.now() / 1000;
  const problems = [];
  if (header.typ !== 'JWT' || header.alg !== 'RS256') problems.push(`header ${JSON.stringify(header)}`);
  if (claims.iss !== 'enablebanking.com') problems.push(`iss ${claims.iss}`);
  if (claims.aud !== 'api.enablebanking.com') problems.push(`aud ${claims.aud}`);
  if (claims.exp - claims.iat !== 3600) problems.push('exp - iat is not 3600');
  if (Math.abs(claims.iat - now) > 300) problems.push('iat is not now');
  if (!verify('RSA-SHA256', Buffer.from(`${h}.${c}`), app.publicKey, Buffer.from(sig, 'base64url'))) problems.push('bad signature');
  if (problems.length) { app.log.errors.push(problems.join('; ')); return { error: problems.join('; ') }; }
  return { app };
}

const money = (minor) => (minor / 100).toFixed(2);
const dayAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

function txOut(t, currency) {
  return {
    entry_reference: t.ref,
    transaction_amount: { amount: money(t.minor), currency },
    credit_debit_indicator: t.type,
    status: t.status ?? 'BOOK',
    booking_date: dayAgo(t.daysAgo),
    value_date: dayAgo(t.daysAgo),
    ...(t.creditor ? { creditor: { name: t.creditor } } : {}),
    ...(t.debtor ? { debtor: { name: t.debtor } } : {}),
    remittance_information: t.remittance ?? [],
  };
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // ---- control (tests only) ----
  if (p === '/__fake/apps' && req.method === 'POST') {
    const b = await readBody(req);
    apps.set(b.applicationId, {
      publicKey: createPublicKey(b.publicKeyPem),
      // config: { accounts: [{ uid, iban, currency, name, balanceMinor, transactions: [{ ref, type, minor, daysAgo, creditor, debtor, remittance, status }] }],
      //           validUntils: [iso...] (one per session made, the last repeats), failSessions }
      config: b.config,
      log: { errors: [], auths: [], sessions: 0, txCalls: [] },
      auths: new Map(), codes: new Map(),
    });
    return send(res, 204);
  }
  const ctl = /^\/__fake\/apps\/([^/]+)\/log$/.exec(p);
  if (ctl) { const a = apps.get(ctl[1]); return a ? send(res, 200, a.log) : send(res, 404, {}); }

  // ---- the bank's own page: sends the person straight back with a code ----
  if (p === '/bank/authorize') {
    for (const a of apps.values()) {
      const auth = a.auths.get(url.searchParams.get('id'));
      if (!auth) continue;
      const code = randomUUID();
      a.codes.set(code, auth);
      res.writeHead(302, { location: `${auth.redirect_url}?code=${code}&state=${encodeURIComponent(auth.state)}` });
      return res.end();
    }
    return send(res, 404, { message: 'unknown authorization' });
  }

  // ---- Enable Banking API ----
  const { app, error } = authenticate(req);
  if (error) return send(res, 401, { message: error });
  const cfg = app.config;

  if (p === '/aspsps' && req.method === 'GET') {
    const c = url.searchParams.get('country');
    return send(res, 200, { aspsps: BANKS.filter((b) => !c || b.country === c) });
  }
  if (p === '/auth' && req.method === 'POST') {
    const b = await readBody(req);
    const days = (new Date(b.access?.valid_until).getTime() - Date.now()) / 864e5;
    const bad = [];
    if (!(days > 179 && days < 181)) bad.push('access.valid_until is not 180 days from now');
    if (!BANKS.some((x) => x.name === b.aspsp?.name && x.country === b.aspsp?.country)) bad.push('unknown aspsp');
    if (!b.state) bad.push('no state');
    if (!/\/api\/banks\/callback$/.test(b.redirect_url ?? '')) bad.push('redirect_url');
    if (b.psu_type !== 'personal') bad.push('psu_type');
    if (bad.length) { app.log.errors.push(bad.join('; ')); return send(res, 400, { message: bad.join('; ') }); }
    const id = randomUUID();
    app.auths.set(id, { state: b.state, redirect_url: b.redirect_url, bank: b.aspsp });
    app.log.auths.push({ bank: b.aspsp.name, redirect_url: b.redirect_url });
    return send(res, 200, { url: `${process.env.TALLY_ENABLEBANKING_URL}/bank/authorize?id=${id}`, authorization_id: id });
  }
  if (p === '/sessions' && req.method === 'POST') {
    const b = await readBody(req);
    if (cfg.failSessions || !app.codes.has(b.code)) return send(res, 400, { message: 'cannot create a session' });
    app.codes.delete(b.code);
    const n = app.log.sessions++;
    const until = cfg.validUntils[Math.min(n, cfg.validUntils.length - 1)];
    return send(res, 200, {
      session_id: `session-${n + 1}`,
      accounts: cfg.accounts.map((a) => ({ uid: a.uid, account_id: { iban: a.iban }, currency: a.currency, name: a.name })),
      access: { valid_until: until },
    });
  }
  const acc = /^\/accounts\/([^/]+)\/(balances|transactions)$/.exec(p);
  if (acc && req.method === 'GET') {
    const a = cfg.accounts.find((x) => x.uid === acc[1]);
    if (!a) return send(res, 404, { message: 'unknown account' });
    if (acc[2] === 'balances') {
      return send(res, 200, { balances: [{ name: 'Closing booked', balance_type: 'CLBD', balance_amount: { amount: money(a.balanceMinor), currency: a.currency } }] });
    }
    const from = url.searchParams.get('date_from');
    app.log.txCalls.push({ uid: a.uid, date_from: from, continuation_key: url.searchParams.get('continuation_key') });
    const wantStatus = url.searchParams.get('transaction_status');
    const all = a.transactions.filter((t) => (!from || dayAgo(t.daysAgo) >= from) && (!wantStatus || (t.status ?? 'BOOK') === wantStatus));
    const start = Number(url.searchParams.get('continuation_key') ?? 0);
    const slice = all.slice(start, start + PAGE);
    return send(res, 200, {
      transactions: slice.map((t) => txOut(t, a.currency)),
      continuation_key: start + PAGE < all.length ? String(start + PAGE) : null,
    });
  }
  return send(res, 404, { message: `fake: ${req.method} ${p}` });
}

export function startFakeEnableBanking(port) {
  const server = createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { message: String(e) })));
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
