# Spec 17: Bank connections through Enable Banking

Follows specs 01 to 15, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`, phase 3: banks (Revolut, Bank of Cyprus) connect through Enable Banking, which is free for a private individual reading their own accounts. Each person on the server uses their own Enable Banking registration. Imported transactions keep the pocket the bank reported; the subsection can be changed (spec 15's rules and "needs sorting" apply). Bank access has to be re-approved from time to time; the app reminds the person before it lapses.

## Out of scope

- Payments, or anything but reading balances and transactions.
- Any aggregator other than Enable Banking.
- Getting the server an HTTPS address: the person sets `TALLY_PUBLIC_URL` (an open decision in `ROADMAP.md`).

## Shared contract

### Registration (per person)

- Settings gains "Bank connections". The person enters their Enable Banking **application ID** and **private key** (the PEM file's text) from their own registration at enablebanking.com, whose redirect URL they set to `{TALLY_PUBLIC_URL}/api/banks/callback`.
- `PUT /api/banks/registration` `{ applicationId, privateKey }` → 204. `applicationId` a UUID ("Enter the application ID from Enable Banking."); `privateKey` an RSA private key in PEM ("Paste the private key file's contents."). `GET /api/banks/registration` → `{ applicationId, configured: true, publicUrl }` or `{ configured: false, publicUrl }`, where `publicUrl` is `TALLY_PUBLIC_URL` or null. The key is never returned.
- Secrets (this key, and spec 16's broker key) are stored encrypted with AES-256-GCM under a server key: `TALLY_SECRET` (64 hex characters) if set, otherwise a random key the server creates once in `<data dir>/secret.key`. One helper does this for both specs.
- Without `TALLY_PUBLIC_URL` set, the card says "Set TALLY_PUBLIC_URL to this server's HTTPS address to connect a bank." and connecting is disabled.

### Talking to Enable Banking

- Base URL `TALLY_ENABLEBANKING_URL`, default `https://api.enablebanking.com`. Every request carries `Authorization: Bearer <JWT>`: RS256, header `{ typ: 'JWT', alg: 'RS256', kid: applicationId }`, claims `{ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 3600 }`, signed with the person's key (Node's `crypto`, no new dependency).
- `GET /aspsps?country=CY` lists banks. `POST /auth` with `{ access: { valid_until }, aspsp: { name, country }, state, redirect_url, psu_type: 'personal' }` answers `{ url }`. The bank sends the person back to the callback with `code` and `state`. `POST /sessions` `{ code }` answers `{ session_id, accounts: [{ uid, account_id: { iban }, currency, name }], access: { valid_until } }`. `GET /accounts/{uid}/balances` and `GET /accounts/{uid}/transactions?date_from=…` (following `continuation_key`) read an account.
- `valid_until` asked for: 180 days from now. `state` is a random value tied to the person and kept until the callback; a callback with an unknown or used `state` answers 400 and changes nothing.

### Tally's routes

| Route | Body | Success |
|---|---|---|
| `GET /api/banks?country=CY` | | 200 `{ banks: [{ name, country }] }` |
| `POST /api/banks/connect` | `{ name, country }` | 200 `{ url }` (the browser goes there) |
| `GET /api/banks/callback?code&state` | | 302 to `/settings?bank=connected` (or `?bank=failed`) |
| `GET /api/banks/connections` | | 200 `{ connections: [{ id, bank, country, validUntil, syncedAt, accounts: [{ uid, name, iban, currency, pocketId }] }] }` (`syncedAt` the connection's last sync, or null) |
| `PATCH /api/banks/accounts/:uid` | `{ pocketId }` | 200: links the account to a pocket of the same currency ("Choose a pocket in {currency}."), or `null` to unlink |
| `POST /api/banks/connections/:id/sync` | | 200 `{ added, duplicates, unsorted }` |
| `DELETE /api/banks/connections/:id` | | 204: forgets the session; imported transactions stay |

- **Sync** reads each linked account's booked transactions since the later of 90 days ago and its last sync minus 7 days, and imports them into its pocket exactly as spec 15 imports statement rows (rules, needs sorting, closed months skipped), with `source: 'bank'` and the bank's `entry_reference` kept: a transaction whose reference is already stored for that account is a duplicate. `DBIT` is spending, `CRDT` income; payee is the creditor's name for spending, the debtor's for income, else the first remittance line.
- Syncing also stores the account's latest balance on the pocket: `Pocket` gains `syncedBalanceMinor` and `syncedAt` (null when not linked). A linked pocket's card shows the bank's balance, its last line "Synced {time} from {bank}" (as `PocketCard` says), and, when it differs from Tally's own figure, "Tally counts {balance}." in `ty-cap`.
- Each linked connection syncs on its own when the Transactions or Pockets page loads and its last sync is more than 6 hours old.
- **Reminder:** from 14 days before `validUntil`, the Budget page shows a `ty-inset` notice "Your connection to {bank} ends on 12 March. Reconnect it to keep importing." with the button "Reconnect" (a new `connect` for the same bank; the new session replaces the old one and keeps its pocket links). After it ends: "Your connection to {bank} has ended."

## Backend

Owner: `backend-dev`. Paths: `server/**`. Migration `011_banks.sql` (010 is taken on the main line). Put the secrets helper in `server/src/secrets.ts` (`encrypt(text): string`, `decrypt(blob): string`); spec 16 will reuse it. Tests run against a small fake Enable Banking server started inside the tests (check the JWT's header and claims with the public key), covering: registration rules and that the key is stored encrypted and never returned; connect and callback with good, unknown and reused `state`; sync with continuation, duplicates by reference, rules and closed months; balances; pocket currency check; the reminder dates; deleting a connection; isolation between two people.

## UI

Owner: `ui-dev`. Paths: `web/**`. No new design component: a Settings card built like the existing ones, `Dialog`, `Field`, `Chips`, `ty-inset`.

- **Settings, "Bank connections" card:** without a registration, the two fields "Application ID" and "Private key" (a textarea) with the hint "From your own registration at enablebanking.com. Its redirect URL must be {TALLY_PUBLIC_URL}/api/banks/callback." and "Save". With one: "Connect a bank" (a dialog with "Country" — Cyprus first, then the others Enable Banking lists — and "Bank", then "Continue", which sends the browser to the bank), and one row per connection: the bank, "until 12 March 2027", its accounts each with a "Pocket" select (pockets in that currency, and "Not linked"), "Sync now" and "Disconnect". Back from the bank, a toast says "Bank connected." or "The bank did not connect. Try again."
- **Pockets and Budget** as the contract says.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Run the fake Enable Banking server from the e2e setup (`TALLY_ENABLEBANKING_URL` and `TALLY_PUBLIC_URL` pointing at it and at the test server); its "bank" redirects straight back with a code. Tests: saving a registration; connecting and returning; linking an account to a pocket; syncing imports transactions, sorted by a rule, with the pocket's synced balance; the reminder notice two weeks before the end. Screenshots light and dark, desktop and phone, of the Settings card with a connection.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. A registration saves, and its key never comes back from the server.
3. Connecting goes to the bank and back, and lists the bank's accounts.
4. A linked account's sync imports its transactions into its pocket once, applies rules, and shows the bank's balance on the card.
5. The reminder shows 14 days before the access ends, and "Reconnect" keeps the pocket links.
6. The backend tests cover every rule in the contract.
