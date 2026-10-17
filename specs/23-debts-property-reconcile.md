# Spec 23: Debts, property and reconciling

Follows specs 01 to 22, which stay the reference for everything not changed here. Migration `016_debts_property.sql`.

## Goal

From the user: Tally offers what Monarch and YNAB offer. Monarch's accounts page groups everything you own and owe, including credit cards, loans, a home or a car, and nets them into one figure. YNAB reconciles a pocket against the bank's balance.

## Out of scope

- Loan amortisation and interest planning.
- Automatic property prices.
- Credit card payment budgeting (YNAB's payment category): paying a card is a transfer, as today.
- Credit scores.

## Shared contract

### Pocket kinds

- `pockets.kind` gains `credit` (credit card), `loan` and `property`. Rebuild the table in the migration to widen the `CHECK`, keeping every row and every foreign key.
- `GET /api/pockets` gives each pocket a `group`: `cash` (bank, cash), `investments` (fund, broker), `property`, or `debts` (credit, loan).
- **Credit and loan pockets** hold what is owed as a negative balance. The person enters the opening balance as a positive amount "Owed now" and it is stored negative. Spending from a credit card is an ordinary expense. Paying it is an ordinary transfer from another pocket, as today, and moving money into a debt pocket brings its balance towards 0.
- **Property pockets:**
  - **No transactions:** a property pocket holds a value, not transactions. A transaction or transfer touching one answers 400 on `pocketId` (or `toPocketId`): "A property pocket holds a value, not transactions."
  - **Values:** `POST /api/pockets/:id/values` `{ valueMinor ≥ 0, date }` → 201. These are stored in `pocket_values (id, pocket_id, value_minor, date)`, one per date (a second one on the same date replaces it). `GET /api/pockets/:id/values` lists them newest first, and `DELETE /api/pocket-values/:id` → 204.
  - **Its balance** on a day is its latest value on or before that day, or 0. Creating a property pocket takes `valueMinor` (its first value, dated today) in place of an opening balance.
- **Net worth** (`GET /api/networth`, spec 12, and the reports' net worth, spec 19) sums every pocket with debts negative and property at its value on each day. It adds `assetsMinor` (every positive pocket value) and `debtsMinor` (the sum of the negative ones, as a positive figure), both in the base currency.

### Reconciling

- `POST /api/pockets/:id/reconcile` `{ balanceMinor, date }` (date not in the future, not in a closed month) → 200 `{ adjustment: transaction | null, reconciledAt }`.
  - **It differs:** if Tally's balance for the pocket at the end of `date` differs from `balanceMinor`, an income or expense of the difference is added on `date`. Its payee is "Balance adjustment", its subsection is null and its `source` is `'adjustment'`.
  - **It counts in pocket balances and net worth only**, like an unsorted import (spec 15). It is never budget income, spending, cash flow or a recurring payment, and it never asks to be sorted.
- `pockets.reconciled_at` and `reconciled_balance_minor` are stored and returned.
- Refused for:
  - property: 400, "A property pocket has no balance to reconcile.";
  - a pocket with a synced balance (spec 16 or 17): 400, "This pocket's balance comes from its connection."
- An adjustment can be deleted like any transaction, which undoes it. It cannot be given a subsection.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- the migration keeping every pocket and reference;
- groups;
- an opening balance owed stored negative;
- a credit card expense and payment;
- property values, the balance on a day, and the transaction refusal;
- net worth with assets and debts, and over time with property values;
- reconcile: up, down, equal, refusals, and the adjustment counted in balances but not in budget, reports, recurring or sorting;
- isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. Built on spec 21's look.

- **Pockets page, laid out like Monarch's accounts page:**
  - **The top card:** "Net worth" in `num-hero`, then "Assets {x}" and "Debts {y}" side by side.
  - **The groups:** one card per group that has pockets, in this order: "Cash", "Investments", "Property", "Debts". Each card has its title, its total right-aligned, and the existing 48px rows. A debt shows its balance as the amount owed in `negative`.
- **Pocket dialog:**
  - the kinds "Credit card", "Loan" and "Property" join the list;
  - for a debt, the opening field reads "Owed now";
  - for property, "Value" in place of the opening balance and currency of the home pocket by default.
- **Property row's detail:** the current value, "Update value" (an amount and a date) and a list of past values with remove.
- **Reconcile:**
  - **Where:** a "Reconcile" action in a bank, cash, credit or loan pocket's detail opens a `Dialog`: "What does {pocket} show today?", an amount, a date (today by default) and "Reconcile".
  - **Results:**
    - "Matches. Reconciled today." when nothing changes;
    - otherwise "Added an adjustment of {±x}." with "Undo" in a toast.
  - **On the row:** "Reconciled 16 Oct" in `ty-cap`.
- **Adjustments in Transactions:** they show with a `Pill` "Adjustment" in place of a subsection, and they are left out of the subsection picker flow.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests:
- adding a credit card owed 500.00, spending on it and paying it from a bank, then checking balances and net worth;
- a property pocket with two values;
- the groups and the assets and debts figures;
- reconciling up, equal, and undo.

Screenshots light and dark, desktop and phone, of the Pockets page with all four groups and the reconcile dialog.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Net worth equals assets minus debts, with property at its latest value.
3. A reconcile adjustment changes balances and net worth and nothing else.
4. The backend tests cover every rule in the contract.
