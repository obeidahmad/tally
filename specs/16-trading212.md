# Spec 16: Trading212

Follows specs 01 to 14, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`, phase 3: Trading212 connects through the person's own API key (the official API is in beta and covers Invest and Stocks ISA accounts). A holding's current value comes from the connected broker (spec 14 left that out). Dividends actually paid out count as income from their own source.

## Out of scope

- Placing orders, pies, and any broker but Trading212.
- History of values over time (the reports spec).

## Shared contract

### Connection

- `PUT /api/brokers/trading212` `{ pocketId, apiKey, apiSecret?, environment: 'live' | 'demo', subsectionId }` → 200 `{ connection }`; `GET` → `{ connection: { pocketId, environment, subsectionId, keyEnd, syncedAt, error } | null }` (`keyEnd` the key's last 4 characters; the key is never returned); `DELETE` → 204 (holdings it made stay, marked as typed by hand from then on).
- `pocketId` a broker pocket of the person ("Choose a broker pocket."); `subsectionId` where its holdings go by default ("Choose a subsection."); `apiKey` 10 to 200 characters ("Paste your Trading212 API key.").
- The key (and secret) are stored encrypted with the server key helper (`TALLY_SECRET`, or `<data dir>/secret.key` created once with a random key; AES-256-GCM). If spec 17 already added the helper, use it; otherwise add it in `server/src/secrets.ts` for both.
- Base URL `TALLY_T212_URL` if set, else `https://live.trading212.com/api/v0` or `https://demo.trading212.com/api/v0`. With a secret, requests carry `Authorization: Basic base64(key:secret)`; without, `Authorization: <key>`. Saving checks the key with `GET /equity/account/info` and stores the account's `currencyCode`; a pocket in another currency answers 400 on `pocketId`: "This Trading212 account is in {code}. Choose a pocket in {code}."; a refused key 400 on `apiKey`: "Trading212 refused this key."

### Sync

`POST /api/brokers/trading212/sync` → 200 `{ holdings, dividends }`, and on its own when the Pockets or Investments page loads and the last sync is over an hour old. Each call respects Trading212's limits (one portfolio read per 5 s, cash per 2 s, dividends 6 per minute) by waiting, never by failing.

1. `GET /equity/account/cash`: the pocket's `syncedBalanceMinor` (spec 17's field; add it here if spec 17 is not in yet) is `free` in the account currency, and `syncedAt` is now.
2. `GET /equity/portfolio` and, once a day, `GET /equity/metadata/instruments` for each ticker's name and currency. For each position: a holding with `source: 'trading212'` and the ticker as its key, named after the instrument, in the connection's subsection when new; `worthMinor` = quantity × `currentPrice` in the instrument's currency (`worthCurrency`); `paidMinor` = that worth converted to the account currency at today's rate (spec 12) − `ppl` − (`fxPpl` or 0), in the account currency. A broker holding's paid and worth cannot be changed by hand (400 on the field: "This holding's figures come from Trading212."); its name and subsection can.
3. A ticker no longer in the portfolio: its holding gets `soldDate` today with no transaction (the sale's money is already in the synced cash).
4. `GET /history/dividends` (following `nextPagePath`) since the last sync: each new one (by `reference`) becomes an income into the pocket on `paidOn`, amount `amount` in the account currency, from a source named "Trading212 dividends" (created in a box of its own if missing), payee the ticker, `source: 'broker'`. Closed months are skipped.
5. **Cash and value of a synced pocket.** A pocket with a `syncedBalanceMinor` (Trading212 here, a bank in spec 17) takes that figure as its cash: its `valueMinor` is the synced cash plus its held holdings' worth, and net worth uses that. Tally's own computed figure stays only for the "Tally counts …" line, which shows for bank-linked pockets and never for a Trading212 pocket (its trades are not Tally transactions).
6. A failure keeps everything as it was and stores `error`: "Trading212 refused the key.", "Trading212 is not answering. Tally will try again." or "Trading212 asked Tally to slow down. Tally will try again."

## Backend

Owner: `backend-dev`. Paths: `server/**`. Migration `012_trading212.sql`. Reuse `server/src/secrets.ts` (spec 17) and the pocket's `syncedBalanceMinor`/`syncedAt` (spec 17); a broker pocket linked to Trading212 keeps its currency like a bank-linked one. Tests against a fake Trading212 server started inside the tests: saving (good key, refused key, wrong currency, encrypted storage, key never returned); a sync creating, updating and selling holdings with the paid and worth rule in two currencies; dividends once each, into the right source, skipping closed months; the hand-edit refusal; the waits between calls (with a fake clock); failures keeping data; isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. No new design component.

- **Settings, "Trading212" card:** "Pocket" (broker pockets), "Environment" (`Segmented`: "Live" / "Demo"), "API key", "API secret (optional)", "Holdings go to" (subsection), "Connect". Connected: "Connected to {pocket} · key ending {keyEnd} · synced {time}", the error if any in `ty-cap` with `ty-pill--warning`, "Sync now", "Disconnect".
- **Investments page:** a broker holding shows "from Trading212" in place of "updated 3 Oct", and no "Update value" or "Sell"; the pocket card says "Synced {time} from Trading212".

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Run a fake Trading212 server from the e2e setup (`TALLY_T212_URL`). Tests: connecting with a good and a refused key; a sync showing holdings with their paid, worth and change, the synced cash, and the dividends as income from "Trading212 dividends"; a later sync after a position disappears moving it to "Sold". Screenshots light and dark, desktop and phone, of the Settings card and the Investments page with broker holdings.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Connecting checks the key and the pocket's currency, and the key never comes back.
3. A sync fills the Investments page and the pocket's cash from the fake server, and records dividends once.
4. Broker holdings cannot be edited or sold by hand; a disappeared position is sold.
5. The backend tests cover every rule in the contract.
