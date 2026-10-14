// Starts the built server on a spare port with a new temporary database for each run.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeEnableBanking } from './support/fake-enable-banking.mjs';
import { startFakeTrading212 } from './support/fake-trading212.mjs';

const dir = mkdtempSync(join(tmpdir(), 'tally-e2e-'));
process.env.PORT = process.env.E2E_PORT ?? '3210';
process.env.TALLY_DATA_DIR = dir;
// Spec 12: a local rates file, so the run never reaches the ECB. USD 1.0860 and GBP 0.8650 from 2026-01-05, USD 1.1000 and GBP 0.8700 from 2026-01-02, JPY (not offered).
process.env.TALLY_RATES_URL = fileURLToPath(new URL('./rates-fixture.xml', import.meta.url));
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* db may still be locked */ } });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));
// Spec 17: a fake Enable Banking on the next port; the server is told to use it and to call itself by its own address.
const bankPort = Number(process.env.PORT) + 1;
await startFakeEnableBanking(bankPort);
process.env.TALLY_ENABLEBANKING_URL = `http://127.0.0.1:${bankPort}`;
// Spec 16: a fake Trading212 two ports up.
const t212Port = Number(process.env.PORT) + 2;
await startFakeTrading212(t212Port);
process.env.TALLY_T212_URL = `http://127.0.0.1:${t212Port}`;
process.env.TALLY_PUBLIC_URL = `http://localhost:${process.env.PORT}`;
await import('../server/dist/index.js');
