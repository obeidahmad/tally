# Spec 26: Home page, where the money went, and age of money

Follows specs 01 to 25, which stay the reference for everything not changed here. No migration.

## Goal

From the user: Tally offers what Monarch, YNAB and Rocket Money offer, while the pipeline stays its main distinction.
- Monarch opens on a dashboard of the month at a glance, and shows a cash flow diagram of where income went.
- YNAB shows the "age of money".
- Monarch lists spending by merchant.

The flow diagram follows Tally's own pipeline, so the distinction shows.

## Out of scope

- Arranging or hiding the Home cards.
- An AI assistant.
- Emailed recaps.
- Forecasts.

## Shared contract

### Home

`GET /api/home` → 200, all in the base currency:

```json
{ "month": "2026-10",
  "budget": { "budgetedMinor": 0, "spentMinor": 0, "leftMinor": 0, "overspent": [ { "subsectionId": 1, "overMinor": 0 } ] },
  "networth": { "minor": 0, "changeMinor": 0, "series": [ { "month": "2026-05", "minor": 0 } ] },
  "cashflow": { "incomeMinor": 0, "spendingMinor": 0 },
  "upcoming": [ { "key": "netflix", "payee": "Netflix", "amountMinor": 0, "date": "2026-10-21" } ],
  "recent": [ "…the latest 5 transactions, as GET /api/transactions returns them" ],
  "goals": [ { "subsectionId": 1, "savedMinor": 0, "targetMinor": 0, "goalStatus": "on_track" } ],
  "needsSorting": 0,
  "ageOfMoneyDays": 42 }
```

- **`budget`:** the current month's figures as the Budget page computes them. `overspent` lists at most 3 subsections, the largest first.
- **`networth`:** today's net worth. `changeMinor` is the change since the end of last month, and `series` holds the last 6 month-ends plus today (spec 19's rules).
- **`cashflow`:** spec 19's rules for this month.
- **`upcoming`:** the non-dismissed recurring items (spec 25) expected in the next 14 days, by date.
- **`goals`:** every savings goal with a target (spec 24).
- **`needsSorting`:** the count of transactions that need sorting.

### Age of money (YNAB)

- **The queue:** every income (sorted, base currency, transfers and adjustments never) joins a queue in date order. Each pocket's opening balance counts as income dated the day before the person's first transaction.
- **Spending:** every expense, in date order, takes from the oldest money first.
- **The figure:** age of money is the amount-weighted average, in whole days rounded down, of (expense date − income date) over the money spent by the last 10 expenses.
- **Not enough history:** null when there are fewer than 10 expenses, or when the queue runs dry for any of them.
- **Splits:** a split expense counts once at its full amount.

### Where the money went

`GET /api/reports/flow?month=YYYY-MM` → 200 `{ nodes: [{ id, label, kind }], links: [{ from, to, minor }] }` for one month (default the current one; a bad value answers 400 on `month`):
- **Source → section** (or → "Left over"): what the pipeline sent from each source's box to each section that month. A box of several sources is shown as one node named like the box on the Pipeline page.
- **Section → subsection:** what the subsection spent, with split parts counted.
- **Section → "Kept":** what the section received but did not spend, when above 0.
- Every link is above 0. `kind` is `source`, `section`, `subsection` or `other`.

### Top payees

`GET /api/reports` (spec 19) adds `payees`: the top 10 payees by spending over the chosen months, as `[{ payee, minor, count }]`. Payees are grouped by spec 18's payee key, with the latest spelling shown, and only sorted expenses count.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- each Home field on a fixture;
- age of money: the FIFO across pockets, opening balances, too little history, transfers and adjustments ignored;
- the flow links adding up (a section's outgoing equals what it received, a source's equals its income), for one source and for a merged box;
- top payees;
- isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. Built on spec 21's look. Use the dataviz method and spec 19's chart rules: hand-built SVG, tooltips on hover and focus, and a "Show as table" toggle.

- **Home page:** at `/home`, first in the sidebar and in the phone tab bar, and where sign-in lands. Title "Home". A responsive grid of cards: two columns from 900px, one below. In this order:
  1. **"{Month} so far":** spent of budgeted, with a meter, and "{left} left". When `overspent` has items, "Over budget" and each subsection with its emoji and the amount over. Links to the Budget page.
  2. **"Net worth":** `num-lg`, the change as a positive or negative `Pill` "since {last month}", and a sparkline of `series` (a 2px line, no axes, with a tooltip per point).
  3. **"Cash flow this month":** income, spending, and "Saved {x}" or "Overspent {x}".
  4. **"Coming up":** the upcoming bills, or "No bills in the next 14 days."
  5. **"Recent transactions":** 5 rows as on the Transactions page, and "All transactions".
  6. **"Goals":** each goal with its emoji, a meter of saved against target, and its status `Pill`. Hidden when there are no goals.
  7. **"Age of money":** "{n} days" in `num-lg` and `ty-cap` "How long your money waits between arriving and being spent." When null, "Not enough history yet."
- **Needs sorting:** when `needsSorting` > 0, an `ty-inset` above the grid: "{n} transactions need sorting." with a link to the filtered Transactions page (spec 22's `unsorted=1`).
- **Reports page:** two more cards.
  - **"Where {month}'s money went"**, first on the page, with its own month ‹ ›: a Sankey diagram in three columns (sources, sections, subsections and "Kept"). Nodes are rectangles with their labels and amounts. Links are 40% opacity bands in the section's colour slot, or the neutral ink for sources and "Left over". The tooltip shows "{from} → {to}: {amount}". On phones it scrolls sideways inside its card. The table lists every link.
  - **"Top payees":** a table of payee, count and amount for the chosen months.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests:
- landing on Home after sign-in, with each card's figures on a fixture;
- the needs-sorting link;
- age of money shown and "Not enough history yet";
- the flow table's links for a month;
- top payees.

Screenshots light and dark, desktop and phone, of Home and of the flow diagram.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Home's figures equal the Budget, Reports, Recurring and Pockets pages' figures for the same day.
3. In the flow, each section's outgoing links add up to what it received.
4. The backend tests cover every rule in the contract.
