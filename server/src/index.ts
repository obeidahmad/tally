import fs from 'node:fs';
import path from 'node:path';
import { createApp } from './app';
import { openDb } from './db';

const dir = process.env.TALLY_DATA_DIR ?? path.join(__dirname, '..', 'data');
fs.mkdirSync(dir, { recursive: true });
const port = Number(process.env.PORT ?? 3000);
const app = createApp({ db: openDb(path.join(dir, 'tally.db')), cookieSecure: process.env.TALLY_COOKIE_SECURE === 'true' });
void app.locals.rates.ensure();
app.listen(port, () => console.log(`Tally listening on http://localhost:${port}`));
