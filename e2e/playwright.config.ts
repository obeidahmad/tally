import { defineConfig } from '@playwright/test';

const port = process.env.E2E_PORT ?? '3210';

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  use: { baseURL: `http://localhost:${port}`, locale: 'en-GB', timezoneId: 'UTC', trace: 'retain-on-failure' },
  webServer: {
    command: 'node start-server.mjs',
    url: `http://localhost:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    { name: 'setup', testMatch: /00-first-run\.spec\.ts/ },
    { name: 'app', testIgnore: /00-first-run\.spec\.ts/, dependencies: ['setup'] },
  ],
});
