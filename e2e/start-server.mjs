// Starts the built server on a spare port with a new temporary database for each run.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tally-e2e-'));
process.env.PORT = process.env.E2E_PORT ?? '3210';
process.env.TALLY_DATA_DIR = dir;
process.on('exit', () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* db may still be locked */ } });
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => process.exit(0));
await import('../server/dist/index.js');
