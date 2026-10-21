# Spec 14: Where money sits, and investments

Follows specs 01 to 13, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`:

- **Where each subsection's money sits** is calculated from the transactions, for example Car 6,000 = 4,000 in Bank A + 2,000 in the fund.
- **Investments (phase 2).** A holding belongs to a subsection and a pocket. It shows what was paid and what it is worth now, each in its own currency (paid 1,000 EUR, worth 1,050 EUR, or 900 USD if it changed currency). The value is typed in by the person (a connected broker comes later). Money actually paid out (interest, dividends, profit on a sale) counts as income with its own source like any other. Price changes only change the holding's value and the net worth. A fund that pays daily income records each payout as income from that fund.

## Out of scope

- Fetching values from a broker (Trading212 is its own spec).
- Net worth over time and charts (the reports spec).
- Quantities, prices per share, lots and tax. A holding is one paid amount and one value.

## Shared contract

### Home pocket

- Each person has a home pocket: where a subsection's money sits unless a transfer moved it. `GET /api/me` and `User` gain `homePocketId: number | null`; `PATCH /api/me` takes `{ homePocketId }` (one of the person's pockets: 400 on `homePocketId`, "Choose a pocket."). With none set, the home pocket is the person's oldest pocket.

### Where money sits

`GET /api/where?month=YYYY-MM` (default the current month) → 200:

```json
{ "currency": "EUR",
  "pockets": [ { "id": 1, "name": "Bank of Cyprus", "currency": "EUR" } ],
  "rows": [ { "subsectionId": 7, "totalMinor": 600000,
              "cells": [ { "pocketId": 1, "amountMinor": 400000 }, { "pocketId": 4, "amountMinor": 200000 } ] } ] }
```

For a subsection S, with T its `availableMinor` in that month (spec 13):

1. For every pocket P other than the home pocket, P's amount is: transfers tagged S into P (their `toAmountMinor`) − transfers tagged S out of P (`amountMinor`) − S's expenses paid from P − what S's holdings in P cost (`paidMinor`) + what they are worth now (`worthMinor` in P's currency), in P's currency. Transfers and expenses count up to the end of that month; a held holding counts at today's figures in every month (a holding has no purchase date), and a sold one counts nowhere.
2. The home pocket's amount is T minus the other pockets' amounts converted to the base currency at today's rate (spec 12), converted into the home pocket's currency.
3. `rows` lists subsections with T or any cell not 0, in section and subsection order; `cells` leaves out zeros; `pockets` lists only pockets that appear in some cell, oldest first.

Example: Car has T = 6,000.00. A transfer tagged Car of 2,000.00 from Bank (home) to Fund: Fund 2,000.00, Bank 4,000.00. Then an expense of 100.00 for Car paid from Fund: T = 5,900.00, Fund 1,900.00, Bank 4,000.00.

### Holdings

```ts
type Holding = {
  id: number; name: string; pocketId: number; subsectionId: number;
  paidMinor: number;                 // in the pocket's currency: what left the pocket's cash
  worthMinor: number; worthCurrency: string; worthDate: string;   // its value now, in its own currency, and when it was typed
  soldDate: string | null;
};
```

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/holdings` | | 200 `{ holdings }` | Held first, then sold; oldest first. |
| `POST /api/holdings` | `{ name, pocketId, subsectionId, paidMinor, worthMinor?, worthCurrency? }` | 201 `{ holding }` | Worth defaults to paid, in the pocket's currency, dated today. |
| `PATCH /api/holdings/:id` | any of `{ name, subsectionId, paidMinor, worthMinor, worthCurrency }` | 200 `{ holding }` | A new `worthMinor` or `worthCurrency` sets `worthDate` to today. |
| `POST /api/holdings/:id/sell` | `{ date, receivedMinor, sourceId? }` | 200 `{ holding, transaction }` | See below. |
| `DELETE /api/holdings/:id` | | 204 | Only a holding that is not sold. |

- **Pocket value.** A pocket's `balanceMinor` (spec 12) stays its cash: transactions only, minus what its held holdings cost. Its new `valueMinor` is that plus its held holdings' worth converted to the pocket's currency at today's rate. `baseBalanceMinor` becomes `baseValueMinor`, the value in the base currency, and net worth (spec 12) uses values.
- **Selling** on `date` for `receivedMinor` (in the pocket's currency): the holding gets `soldDate`; its `paidMinor` returns to the pocket's cash. A profit (received − paid above zero) is saved as an income on that date into the pocket, from `sourceId` (required then: 400 on `sourceId`, "Choose a source."), payee "", note "Sale of {name}". A loss is saved as an expense on that date from the pocket, in the holding's subsection, payee "", note "Sale of {name}". Equal: no transaction. Closed months refuse it like any transaction.
- Field rules: `name` 1 to 60 characters ("Enter a name."); `pocketId` and `subsectionId` the person's ("Choose a pocket." / "Choose a subsection."); `paidMinor` and `receivedMinor` integers from 0 to 10^13 ("Enter an amount, 0 or more."); `worthMinor` the same; `worthCurrency` an offered currency ("Choose a currency."); `date` a real date ("Enter a date.").
- Payouts (interest, dividends, a fund's daily income) need nothing new: they are incomes into the pocket from a source the person names, which the pipeline splits like any other.

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. Migration `010_holdings.sql` (`009` is taken by the statement import on another branch): `home_pocket_id` on users, the holdings table.
2. The routes and figures above; pocket values and net worth as said.
3. Tests: the where example; a holding's worth in another currency in the where table, the pocket value and net worth; selling at a profit, at a loss and at cost; isolation between two people; every field rule.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/components/PocketsScreen`, `PocketCard`, `Amount`, `BudgetRow` and `AppShell` again: the where table, a broker's card ("≈ 2,127.05 EUR · paid 2,100.00 USD"), the paid/worth wording and the Investments link in the sidebar are designed there. No new design component.

- **Pockets page:** under the cards, the table titled "Where each subsection's money sits", built as `PocketsScreen` shows: one row per subsection with its section's dot and name, one column per pocket in the table, then "Total in EUR". A cell shows the amount with the code when not the base currency, or "–". On phones the table becomes one line per subsection: its dot, name and total in the base currency, and under it in `ty-cap` its cells joined with " · " ("4,000.00 in Bank of Cyprus · 2,000.00 in Fund"). A pocket card with holdings shows its value, and under it "≈ … EUR · paid …" as `PocketCard` shows.
- **Settings page:** a "Home pocket" select with the hint "Money sits here unless you move it with a transfer."
- **Investments page** at `/investments`, linked in the sidebar after "Pockets" as `AppShell` shows (on phones, from the Pockets page's header button "Investments"). Title "Investments", primary button "Add holding". One card per pocket that has holdings, titled with its emoji and name; in it one row per held holding: its name; its subsection with the dot; "paid 2,100.00 USD"; "worth 2,310.00 USD" and the change as a Pill, positive above paid ("+10.0%"), negative below ("−4.2%"), neutral when equal; "updated 3 Oct" in `ty-cap`; and small quiet "Update value" and "Sell" buttons. Sold holdings are listed under "Sold" with their sale date. No holding: "No holdings yet. Add one to follow what it is worth."
- **Holding dialog** ("Add holding" / "Edit holding"): "Name", "Pocket" (chips), "Subsection", "Paid" (pocket's code), "Worth now" (amount with a "Currency" select, default the pocket's), "Delete" when editing an unsold holding. "Update value" opens it on "Worth now".
- **Sell dialog** ("Sell {name}"): "Date", "Received" (pocket's code), and when received is above paid, "Source" (a select of sources) with the hint "The profit counts as income from this source." When below: the hint "The loss counts as spending in {subsection}." Primary button "Sell".
- **Budget page:** a subsection with held holdings gets the note "paid 1,200.00 · worth 1,260.00" (in the base currency at today's rate).

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Tests for acceptance criteria 2 to 6; screenshots light and dark, desktop and phone, of the Pockets page with the where table and the Investments page.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. The where example shows Car with Bank 4,000.00 and Fund 2,000.00, then after the expense Fund 1,900.00; the total column matches the subsection's available.
3. Adding a holding of paid 2,100.00 USD in a USD broker pocket and updating its worth to 2,310.00 USD shows "+10.0%", the pocket card "≈ … EUR · paid 2,100.00 USD", and net worth rising by the difference.
4. Selling it for 2,400.00 with a source records an income of 300.00 from that source, and it moves under "Sold"; selling another below cost records the loss as an expense in its subsection.
5. The Budget page shows the "paid … · worth …" note on its subsection.
6. Changing the home pocket in Settings moves the untransferred money's column in the where table.
7. The backend tests cover every rule in the contract.
8. The screenshots match `PocketsScreen` and `PocketCard`.
