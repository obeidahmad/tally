import { test, expect, OWNER, signInByApi, shot } from '../support/fixtures';

const pages = [
  { path: '/budget', ready: /No sections yet/, who: 'person' },
  { path: '/pipeline', ready: /No income sources yet/, who: 'person' },
  { path: '/transactions', ready: /No transactions in/, who: 'person' },
  { path: '/pockets', ready: /No pockets yet/, who: 'person' },
  { path: '/settings', ready: /Change password/, who: 'owner' },
] as const;

// Everything under /api except the sign-in check, so the app knows who is signed in but cannot load page data.
const isData = (url: URL) => url.pathname.startsWith('/api/') && url.pathname !== '/api/auth/state';

for (const p of pages) {
  test(`${p.path}: shows Loading… while waiting, then the content`, async ({ page, me }) => {
    if (p.who === 'owner') await signInByApi(page, OWNER);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await page.route(isData, async (route) => {
      await gate;
      await route.continue();
    });
    await page.goto(p.path);
    await expect(page.getByText('Loading…').first()).toBeVisible();
    await expect(page.getByText('Loading…').first()).toHaveClass(/ty-cap/);
    await shot(page, `loading${p.path.replace('/', '-')}-desktop-light`);
    release();
    await expect(page.getByText(p.ready).first()).toBeVisible();
    await expect(page.getByText('Loading…')).toHaveCount(0);
  });

  test(`${p.path}: shows the failure card when the server cannot be reached, and Try again recovers`, async ({ page, me }) => {
    if (p.who === 'owner') await signInByApi(page, OWNER);
    await page.route(isData, (route) => route.abort());
    await page.goto(p.path);
    await expect(page.getByText("Couldn't load this page. Check that Tally's server is running.")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await shot(page, `failure${p.path.replace('/', '-')}-desktop-light`);
    await page.unroute(isData);
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText(p.ready).first()).toBeVisible();
    await expect(page.getByText("Couldn't load this page.")).toHaveCount(0);
  });
}
