import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Tests never reach the network for rates.
export default defineConfig({ test: { env: { TALLY_RATES_URL: path.join(import.meta.dirname, 'test', 'rates.xml') } } });
