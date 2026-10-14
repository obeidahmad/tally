# Spec 18: Recurring bills and subscriptions

Follows specs 01 to 17, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`, "Later", taken from Rocket Money: detect subscriptions and recurring bills from the transactions, show what they cost a month, and what is due next.

## Out of scope

- Cancelling subscriptions, reminders outside the app, and bills entered by hand before they happen.
- Recurring income.

## Shared contract

### Detection

- Expenses are grouped by payee key: the payee in lower case with digits and punctuation removed and spaces collapsed ("NETFLIX.COM 4471" and "Netflix.com" share "netflixcom"). Expenses with an empty key are left out.
- A group is recurring when, among its expenses of the last 800 days (sorted by date, at most one per day), there are at least 3 (at least 2 when the gaps are yearly), every gap between consecutive ones falls in one band — weekly (6 to 8 days), monthly (25 to 35) or yearly (355 to 375) — and every amount (`baseAmountMinor`) is within 15% of their median.
- For each: `cadence`, `amountMinor` (the median), `lastDate`, `nextDate` (last + the median gap), `count`, `subsectionId` (of the latest), `payee` (the latest's payee as written), and `monthlyMinor` (weekly × 52 ÷ 12, monthly as is, yearly ÷ 12, rounded to the cent).

### Routes

| Route | Success |
|---|---|
| `GET /api/recurring` | 200 `{ items: [...], dismissed: [...], monthlyMinor }`: items by `nextDate`; `monthlyMinor` the sum over items. |
| `POST /api/recurring/:key/dismiss` | 204: the person says it is not recurring; it moves to `dismissed`. |
| `DELETE /api/recurring/:key/dismiss` | 204: back to items. |

`:key` is the payee key; one that is not a current or dismissed group answers 404.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Migration `013_recurring.sql` (dismissed keys per person; 012 is kept for Trading212 on the main line). Tests: each cadence; a gap outside the bands, an amount outside 15% and only two payments each not detected; payee keys; next date and monthly figure; dismiss and restore; isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. No new design component: rows like `TransactionRow`, `Pill`, `Amount`.

- **Recurring page** at `/recurring`, in the sidebar after "Transactions" (and in the phone tab bar's "More" if there is one, otherwise from a link on the Transactions page header, "Recurring"). Title "Recurring", and under it "About {monthlyMinor} a month in {count} recurring payments." 
- "Due in the next 7 days" (only when any): rows with the payee, the subsection with its dot, the amount, and "due Thursday 16 Oct".
- "All": one row per item: the payee in bold, under it "{Monthly|Weekly|Yearly} · last paid 3 Oct · next 3 Nov", the subsection, the amount, and a small quiet "Not recurring".
- "Not recurring" items listed collapsed at the end under "Hidden ({n})" with "Show again".
- Every item hidden: the headline with 0.00 and "Nothing is recurring right now.", then "Hidden ({n})".
- No item at all: "Nothing recurring yet. Tally finds a payment once it has been paid three times on a regular schedule."

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests: a monthly payee found from three expenses with its figures; a weekly and a yearly one; "Not recurring" and "Show again"; the empty state. Screenshots light and dark, desktop and phone.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Three monthly Netflix expenses of 12.99 show as "Monthly", next date one median gap after the last, and the monthly total.
3. Weekly and yearly payments count in the monthly total as the contract says.
4. "Not recurring" hides an item and takes it out of the total; "Show again" brings it back.
5. The backend tests cover every rule in the contract.
