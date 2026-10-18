# Spec 25: Bills calendar, paid or due, and price rises

Follows specs 01 to 24, which stay the reference for everything not changed here. No migration.

## Goal

From the user: Tally offers what Rocket Money and Monarch offer for recurring bills:
- a calendar of the month's bills;
- whether each one is paid, due or missed;
- an alert when a subscription's price goes up.

## Out of scope

Cancelling subscriptions, negotiating bills, reminders outside the app, and recurring income.

## Shared contract

### Detection change (spec 18)

The 15% band now applies to every payment but the latest, compared with the median of the others. The latest may be up to 50% above that median, or up to 15% below it. So a price rise does not hide a subscription. `amountMinor` becomes the latest payment's amount, and the monthly figure follows it.

### Next dates (replaces spec 18's "last + the median gap")

Weekly items step by 7 days, monthly items by one calendar month on the same day of the month as `lastDate` (clamped to the last day of a shorter month), and yearly items by one calendar year (29 Feb becomes 28 Feb). This gives `nextDate` and the calendar's expected dates. A Netflix bill last paid on 13 Oct is next due on 13 Nov.

### On each item of `GET /api/recurring`

- **`status`:**

  | Status | When |
  |---|---|
  | `paid` | A payment in the group falls in the current cycle: the last 7 days for weekly, the current calendar month for monthly, the last 30 days for yearly. |
  | `missed` | Not `paid`, and `nextDate` is more than 3 days before today. |
  | `due` | `nextDate` is within the next 7 days. |
  | `upcoming` | Anything else. |

- **`priceChange`:** `{ fromMinor, toMinor, date }` when the latest payment is more than 2% above the median of the earlier ones (`date` is the latest payment's date), otherwise null.

### Calendar

`GET /api/recurring/calendar?month=YYYY-MM` → 200 `{ month, days: [{ date, items: [{ key, payee, amountMinor, subsectionId, paid }] }] }`.
- **Paid:** the month's actual payments of non-dismissed recurring groups, with `paid: true`.
- **Expected:** for dates from today on, the occurrences expected by stepping from `lastDate` by the median gap, with `paid: false`.
- **Overlap:** an expected occurrence within 3 days of an actual payment in the same group is left out.
- **Bad month:** 400 on `month`.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- the new detection band, with a 20% rise still detected and a 60% rise not;
- each status at its edges;
- the price change at 2%;
- the calendar's actual and expected items, the overlap rule, and a past month showing only actual ones;
- dismissed groups left out;
- isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. Built on spec 21's look.

- **Recurring page:** under the headline, a "Bills calendar" card.
  - **Header:** the month title with ‹ ›.
  - **Grid:** a 7-column grid, Monday first, with day numbers in `ty-cap`. Each day lists its items as compact chips with the payee and the amount. A paid item is muted with a check and the label "Paid". Today has a ring.
  - **Phones:** the grid becomes a list of days that have items.
- **Price rise banner:** above "All", when any item has a `priceChange`, a `ty-inset` per item: "{payee} went up from {from} to {to} on {date}."
- **Rows in "All" and "Due in the next 7 days":** a `Pill` for the status: "Paid" (positive), "Due {weekday}" (warning), "Missed" (negative) or none for upcoming.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests:
- the calendar showing a paid bill this month and an expected one next month;
- the statuses;
- a price rise banner.

Screenshots light and dark, desktop and phone, of the Recurring page with the calendar.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. A Netflix subscription going from 12.99 to 15.99 stays detected, shows the banner, and counts 15.99 a month.
3. The calendar shows paid and expected bills without double counting.
4. The backend tests cover every rule in the contract.
