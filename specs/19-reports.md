# Spec 19: Reports

Follows specs 01 to 18, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`: net worth over time across all pockets, and, under "Later", reports and charts: spending by section over time and cash flow.

## Out of scope

- Exporting reports, custom date ranges beyond the choices below, and comparisons between people.
- Forecasts.

## Shared contract

`GET /api/reports?months=12` (`months` 3, 6, 12 or 24; default 12) → 200, for the last `months` months ending with the current one, oldest first:

```json
{ "currency": "EUR",
  "months": ["2025-11", "2025-12"],
  "spending": [ { "month": "2025-11", "bySection": [ { "sectionId": 1, "minor": 104512 } ], "totalMinor": 160000 } ],
  "cashflow": [ { "month": "2025-11", "incomeMinor": 201240, "spendingMinor": 160000 } ],
  "networth": [ { "month": "2025-11", "minor": 1221143 } ] }
```

- **Spending** per section per month: the month's expenses (`baseAmountMinor`, spec 12) of the section's subsections, sorted transactions only (spec 15). Every section is listed in every month, 0 included, by `position`.
- **Cash flow:** income and spending of the month in the base currency; transfers never count.
- **Net worth** at the end of each month (the current one: today): each pocket's balance from its opening balance and its transactions up to that day, plus, for holdings held on that day, their `paidMinor` — except the current month, which uses today's values as `GET /api/networth` does — converted to the base currency at the rate of that day (spec 12). Months with a missing rate leave that pocket out of that month and list the currency in `missingRates` at the top level.
- `months` outside the four choices: 400 on `months`, "Choose 3, 6, 12 or 24 months."

## Backend

Owner: `backend-dev`. Paths: `server/**`. No migration. Tests: each series on a two-person fixture across three months with a USD pocket, a transfer, an unsorted import and a holding; the `months` rule; isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Use `.claude/skills/apple-design` for motion (none beyond a 150ms opacity change on hover) and follow the dataviz method for every chart: one axis, thin marks, 4px rounded ends at the baseline, a 2px surface gap between stacked segments, recessive grid, a legend whenever there are two series or more, a hover or focus tooltip on every mark, values in text tokens never the series colour, and a "Show as table" toggle under each chart that swaps it for a plain table of the same figures. Charts are inline SVG built by hand, no chart library. Colours: section series use `--sec-1` to `--sec-8` by colour slot (slot 0 the neutral ink), income `--positive`, spending `--ink`; dark mode uses the same tokens' dark values.

- **Reports page** at `/reports`, in the sidebar after "Investments". Title "Reports", and a `Segmented` "3 months", "6 months", "12 months", "24 months" (default 12). Three cards, each with its title, the chart, and the toggle:
  1. "Spending by section": one stacked bar per month, one segment per section, the month's total above the bar in `ty-cap`; legend of sections with their dots. Tooltip: the month, then each section's amount, then the total.
  2. "Cash flow": per month two bars side by side, income and spending, and under the chart in `ty-cap` "Over these months: income {sum}, spending {sum}, {saved or overspent} {difference}."
  3. "Net worth": a 2px line through the month-end points with an 8px marker on each and the last value labelled at the end of the line. Tooltip: month and value. A missing rate notes "No exchange rate for USD for some months; those months leave it out."
- On phones the charts take the full width and the bars narrow; the toggle and tooltips work by tap. Phones reach the page from a full-width "Reports" button on the Transactions page, under its header, as the Pockets page does with "Investments".
- The page's title is an `h1` in `text-display` in the same title row as every other page; legend swatches are the design's `ty-dot ty-dot--N`.
- Empty: with no transactions, each card says "Nothing to show yet."

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests: the three charts' figures through their tables on a fixture; the months choice; the tooltip on hover and focus; the empty state. Screenshots light and dark, desktop and phone.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Each chart's table shows exactly the server's figures for the chosen months.
3. Every mark shows its tooltip on hover and on keyboard focus; the legends name every section.
4. Transfers change no spending or cash flow figure, and neither do unsorted imports. (Net worth follows pocket balances, which do count an unsorted import, so net worth moves with it; a transfer within one currency leaves it unchanged.)
5. The backend tests cover every rule in the contract.
