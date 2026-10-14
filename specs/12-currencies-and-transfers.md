# Spec 12: Currencies and transfers

Follows specs 01 to 10, which stay the reference for everything not changed here. Spec 11 is being built at the same time on another branch; it does not touch pockets or transfers.

## Goal

From `ROADMAP.md`, "Pockets" and "Currencies and net worth":

- A pocket can be in any currency. Totals are shown in the person's base currency at the day's reference rate.
- Money moves between pockets by a transfer, including a currency conversion recorded at the rate the person actually got.
- The Pockets page shows net worth in the base currency.

## Out of scope

- Where each subsection's money sits (the table on the Pockets page) and net worth over time: the next spec. A transfer already records an optional subsection for it.
- Currencies whose minor unit is not two decimals (JPY, ISK, KRW and the like). They are not offered.
- Rates typed by hand, and any rate source other than the one below.
- Investments, holdings and brokers' values (phase 2).

## Shared contract

### Reference rates

- The server reads the European Central Bank's euro reference rates: the XML at `TALLY_RATES_URL`, by default `https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml`. When the value is not an `http(s)` URL it is a path to a local file in the same format (the tests use this).
- It reads them when it starts and then whenever a rate is needed and the last read is more than 6 hours old. A failed read keeps the rates it already has and is retried at most every 10 minutes. Rates are stored in the database and shared by every account on the server; they are not personal data.
- The rate of X in Y on date D uses each currency's rate per euro on the latest stored date on or before D, or else the earliest stored date after D (euro is 1). X in Y = (Y per euro) ÷ (X per euro).
- Offered currencies: the euro, every currency in the stored rates with two decimals (by `Intl.NumberFormat`'s `maximumFractionDigits`), and the person's base currency.
- Converting an amount: amount × rate, rounded to the nearest cent, halves away from zero.
- With no stored rate for a currency, an operation that needs one answers 409 `no_rate`: "There is no exchange rate for USD yet."

`GET /api/rates?date=YYYY-MM-DD` (date optional, default today) → 200 `{ "date": "2026-10-13", "base": "EUR", "currencies": [ { "currency": "USD", "rate": "1.0860" } ] }`: the rate of 1 unit of the person's base currency in each offered currency, as a decimal string with 4 decimals, and the stored date it comes from.

### Pockets

- `POST /api/pockets` takes an optional `currency` (one of the offered currencies, default the base currency): 400 on `currency`, "Choose a currency."
- `PATCH /api/pockets/:id` may change `currency` only while the pocket has no transaction: otherwise 400 on `currency`, "A pocket with transactions keeps its currency."
- `Pocket` gains `hasTransactions` (true when any transaction or transfer uses it), `balanceMinor` (in its own currency: opening + income − expenses − transfers out + transfers in) and `baseBalanceMinor` (that converted to the base currency at today's rate, or `null` when there is no rate).

### Transactions

```ts
type Transaction = {
  id: number; date: string; kind: 'expense' | 'income' | 'transfer';
  amountMinor: number;        // in the pocket's currency; for a transfer, what left pocketId
  baseAmountMinor: number;    // amountMinor in the base currency at the date's rate (equal when the pocket is in the base currency)
  pocketId: number; subsectionId: number | null; sourceId: number | null;
  toPocketId: number | null; toAmountMinor: number | null;  // transfers only: where it went and what arrived, in that pocket's currency
  payee: string; note: string; source: 'manual';
};
```

- An expense or income in a pocket not in the base currency stores `baseAmountMinor` at the date's rate when it is saved, and again when its date, amount or pocket changes. The budget, the pipeline, closing and every month figure use `baseAmountMinor`.
- A transfer: `{ date, kind: 'transfer', pocketId, toPocketId, amountMinor, toAmountMinor?, subsectionId?, note? }`.
  - `toPocketId` is another of the person's pockets: 400 on `toPocketId`, "Choose a different pocket."
  - Same currency: `toAmountMinor` is left out or equal to `amountMinor`; it is stored equal. Different currencies: `toAmountMinor` is required, an integer from 1 to 10^13: "Enter the amount that arrived."
  - `subsectionId` is optional (whose money moved); `sourceId` must be absent or null; `payee` is stored as "".
  - A transfer is not income or spending: it changes no budget, pipeline or month figure. Its `baseAmountMinor` is `amountMinor` converted, kept for display.
  - Closed months lock transfers like every other transaction (spec 09).
- `GET /api/transactions` returns transfers for the month whatever the `pocketId` filter matches: a transfer matches a pocket filter when either pocket is it.

### Net worth

`GET /api/networth` → 200 `{ "currency": "EUR", "totalMinor": 1221143, "byCurrency": [ { "currency": "EUR", "amountMinor": 894255, "baseMinor": 894255, "rate": null }, { "currency": "USD", "amountMinor": 355000, "baseMinor": 326888, "rate": "0.9208" } ], "missingRates": [] }`: the sum of the pockets' balances per currency, the base currency first and the others alphabetically, each converted at today's rate (the exact cross rate, 355000 ÷ 1.0860 here; `rate` is only its display, rounded to 4 decimals). A currency without a rate is listed in `missingRates` and left out of `totalMinor`.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Work in `C:\Users\obeid\Projects\Tally-s12` (its own branch, `spec-12-currencies`); run `npm ci` in `server`, `web` and `e2e` there first.

1. Migration `006_currencies.sql`: the rates table, the transaction columns. Existing transactions get `baseAmountMinor` = `amountMinor`. (Spec 11 also adds a `006`; the merge renames one of them, so keep this one self-contained.)
2. The rate reader, the routes and rules above.
3. Tests with a fixture rates file (two dates, USD and GBP): conversion and rounding; the date fallback both ways; a failed read keeping old rates; an expense in a USD pocket counting at its base amount in the budget and the pipeline; a transfer in one currency and across two; pocket balances; the pocket filter; net worth with a missing rate; the currency change rule; every field rule; a transfer in a closed month refused.

## UI

Owner: `ui-dev`. Paths: `web/**`. Work in `C:\Users\obeid\Projects\Tally-s12` (its own branch, `spec-12-currencies`); run `npm ci` in `server`, `web` and `e2e` there first.

Read `design/components/PocketsScreen`, `PocketCard`, `TransactionRow`, `TransactionDialog`, `Amount` and `Segmented` again: the converted amounts, the net worth header, the USD pill and the transfer row are already designed there.

- **Pocket dialog:** a "Currency" select after "Kind": the base currency first, then the others alphabetically, each as its code and English name ("USD · US Dollar", via `Intl.DisplayNames`). Editing a pocket with transactions shows it disabled with the hint "A pocket with transactions keeps its currency."
- **Pocket cards:** the balance in the pocket's currency, always followed by its code (as the card did before and `PocketCard` shows), the `ty-pill` with the code, and under it in `ty-cap` "≈ 1,141.80 EUR", as `PocketCard` shows.
- **Pockets page header:** "Net worth" over the total in `num-hero` with the base code, then in `ty-cap` each currency joined with " · ": "8,942.55 in EUR", then "3,550.00 USD, worth 3,268.85 EUR at 0.9208". A missing rate reads "No exchange rate for USD yet." The header's "Transfer" button opens the transaction dialog on "Transfer". On phones, where the top bar only has room for "Add", "Transfer" shows as a full-width button under the net worth line, as the Budget page does with "Add income". Cards keep their balance on the same line whether or not they have a "≈" line, as `PocketCard` does with an empty `ty-cap`.
- **Transaction dialog:** "Type" gains "Transfer" after "Income". On "Transfer" the title is "Add transfer" (or "Edit transfer") and the primary button "Add transfer" (or "Save"). Field labels never contain the currency code; the code shows after the input as on every amount. A transfer's fields, in order: "Type", "Date", "From" (pocket chips), "To" (pocket chips, without the "From" pocket), "Amount" with the From pocket's code, then, when the two currencies differ, "Amount received" with the To pocket's code and the hint "Rate {received ÷ amount, 4 decimals}. Today's reference rate is {rate}." (left out with no rate), then "Subsection (optional)" (a select whose first choice is "None") and "Note (optional)". Expense and income show the chosen pocket's code on "Amount".
- **Transactions page:** a transfer row as `TransactionRow` shows: "Moved to {To pocket}" in bold, then in `ty-cap` "Transfer · 85.00 EUR became 92.31 USD at 1.0860" (same currency: "Transfer · 85.00 EUR"), then the subsection (if any) and the From pocket. Its amount is the amount that left the From pocket, as money out: plain ink with a minus sign ("−85.00"), as `TransactionRow` shows. An expense or income in another currency shows its amount with the code and "≈ {base} EUR" under it.
- **Budget and Pipeline:** unchanged; they show base amounts from the server.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Work in `C:\Users\obeid\Projects\Tally-s12`; run `npm ci` in `server`, `web` and `e2e` there first, and run with `E2E_PORT=3220` so you never meet spec 11's tests on 3210. The server under test needs `TALLY_RATES_URL` set to a fixture rates file you add under `e2e/` (start it from `e2e/start-server.mjs`).

- Tests for acceptance criteria 2 to 7.
- Screenshots, light and dark, desktop and phone: the Pockets page with a USD pocket; the transaction dialog on "Transfer" across currencies; the Transactions page with a transfer.

## Acceptance criteria

1. In `Tally-s12`, from the root, `npm run build`, `npm test` and `npm run test:e2e` (with `E2E_PORT=3220`) succeed.
2. A pocket created in USD shows its balance in USD, the USD pill and "≈ … EUR" at the fixture's rate.
3. The net worth header shows the total and the per-currency line as the contract says.
4. A transfer from a EUR pocket to a USD pocket of 85.00, received 92.31, shows "Rate 1.0860" in the dialog, moves the two balances, leaves the Budget page's figures unchanged, and shows "Moved to Revolut USD" with "Transfer · 85.00 EUR became 92.31 USD at 1.0860" on the Transactions page.
5. An expense of 10.00 from the USD pocket counts in the budget at its base amount at the date's rate.
6. A pocket with transactions cannot change currency, and the dialog says why.
7. A transfer to the same pocket is refused with "Choose a different pocket."
8. The backend tests cover every rule in the contract.
9. The screenshots match `PocketsScreen`, `PocketCard` and `TransactionRow`.
