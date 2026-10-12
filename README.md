# Tally

Tally is a self-hosted household budgeting app. Each person signs in to their own account, keeps pockets, budget sections and transactions, and sees only their own data.

## Install

Needs Node 24 and npm.

```
npm run setup
```

## Run in development

Two terminals. The server runs on port 3000 and restarts on change; the web app runs on port 5173 and proxies `/api` to the server.

```
npm run dev:server
npm run dev:web
```

Open http://localhost:5173. The first visit asks you to create the owner account.

## Build and start

```
npm run build
npm start
```

`npm start` serves the API and the built app from one process at http://localhost:3000. Sign-in is limited to 10 failed attempts per 15 minutes per address; behind a reverse proxy every attempt appears to come from one address, so the limit is shared. Run `npm test` to run both test suites.

## Browser tests

The `e2e/` folder is a third package that drives the built app in a real browser with Playwright. Once, run `npm install --prefix e2e` and then `npx playwright install chromium` inside `e2e/`. Then `npm run test:e2e` builds the app and runs the suite. It starts its own server on port 3210 with a new temporary database, so it never touches `server/data` or a Tally that is already running. Screenshots go to `e2e/screenshots/`.

## Where the data lives

In one SQLite file, `tally.db`, inside `server/data` (created on first start). Back up that file to back up Tally.

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port the server listens on. |
| `TALLY_DATA_DIR` | `server/data` | Folder that holds `tally.db`. |
| `TALLY_COOKIE_SECURE` | `false` | Set to `true` when Tally is reached over HTTPS, so the session cookie is only sent over HTTPS. |
