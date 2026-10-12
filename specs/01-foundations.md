# Spec 01: Foundations

Phase 1, slice 1 of `ROADMAP.md`.

## Goal

The first usable Tally: a person signs in, creates pockets, sections and subsections with a fixed monthly budget, records transactions by hand, and sees the month's budget with what was spent and what is available. Several people can have accounts on one server and each sees only their own data.

Everything later (income rules, rollover, currencies, investments, bank connections) builds on this, so the two things that must be right are the data isolation between accounts and the handling of money as whole minor units.

## Out of scope

Do not build any of these. They come in later slices.

- Income sources, split rules, tax-style sections, percentage budgets, a section's "received" amount, rest, rollover and caps, closing a month.
- Currencies other than the account's base currency, conversions, transfers between pockets, net worth over time, the "where each subsection's money sits" table.
- Investments, bank or broker connections, statement import, search, automatic rules, reports, sharing a budget.
- Password reset by email, two-factor sign-in, sign-in through other providers, a public sign-up page, deleting or editing other people's accounts.
- A light/dark switch (follow the operating system), reordering sections or subsections, the Investments page.
- The phone sheet's drag gesture and spring. On phones a dialog sits at the bottom edge and fades in over 150ms. This is a deliberate gap against the design rules, to be closed in a later slice.
- Docker, deployment, HTTPS set-up, an animation library, a data-fetching library, a UI kit, Tailwind.

## Stack

- Node 24, TypeScript in strict mode, npm. Two independent packages, each with its own `package.json`, lockfile and `node_modules`. No npm workspaces, so the two workers can install at the same time.
- `server/`: Express 5, `better-sqlite3`, `zod`, `cookie-parser`, `helmet`, `express-rate-limit`. Tests with Vitest and `supertest`.
- `web/`: React, Vite, React Router. Tests with Vitest. Fonts from the `@fontsource/ibm-plex-sans` and `@fontsource-variable/bricolage-grotesque` packages.
- In development the web dev server runs on port 5173 and proxies `/api` to `http://localhost:3000`. In production the server serves the built `web/dist` itself, so Tally is one process on one port.

## Shared contract

Both workers build against this section exactly as written.

### Conventions

- Every route is under `/api` and speaks JSON. Requests that change data (every POST, PATCH and DELETE, including ones with no body such as sign-out) must send `Content-Type: application/json`; the server rejects anything else on those routes with 400. Together with the cookie settings below this is the defence against cross-site requests. CORS stays off.
- **Money** is an integer count of minor units (cents) in a field ending in `Minor`. Never a float, never a string. All amounts in this slice are in the signed-in person's base currency.
- **Dates** are calendar dates, `YYYY-MM-DD`. **Months** are `YYYY-MM`. No times, no time zones.
- **Ids** are integers.
- **Errors** always have this shape, with `fields` present only for validation errors and keyed by request field name:

  ```json
  { "error": { "code": "validation", "message": "Check the highlighted fields.", "fields": { "name": "Enter a name." } } }
  ```

  | Status | `code` | When |
  |---|---|---|
  | 400 | `validation` | A field is missing or wrong, or the body is not JSON. |
  | 401 | `unauthenticated` | No valid session on a protected route. |
  | 401 | `invalid_credentials` | Sign-in with an unknown username or a wrong password. Same message for both. |
  | 403 | `forbidden` | Signed in, but the route is for the owner only. |
  | 404 | `not_found` | The id does not exist or belongs to someone else. |
  | 409 | `conflict` | Set-up was already done, or the username is taken (`fields.username`). |
  | 409 | `in_use` | Deleting something that still has transactions. |
  | 429 | `rate_limited` | Too many sign-in attempts. |

- Every route needs a session except `GET /api/health`, `GET /api/auth/state`, `POST /api/auth/setup` and `POST /api/auth/login`.

### Objects

```ts
type User = { id: number; username: string; displayName: string; isOwner: boolean; baseCurrency: string };
type Pocket = { id: number; name: string; kind: 'bank' | 'cash' | 'fund' | 'broker'; currency: string;
                openingBalanceMinor: number; balanceMinor: number };
type Subsection = { id: number; sectionId: number; name: string; budgetMinor: number; position: number };
type Section = { id: number; name: string; colorSlot: number; position: number; subsections: Subsection[] };
type Transaction = { id: number; date: string; kind: 'expense' | 'income'; amountMinor: number;
                     pocketId: number; subsectionId: number | null; payee: string; note: string; source: 'manual' };
```

- `Pocket.balanceMinor` = opening balance + income into the pocket − expenses out of it.
- `Section.colorSlot` is 1 to 8, or 0. A new section takes the lowest slot from 1 to 8 that none of the person's sections uses; if all eight are taken it gets 0. It never changes afterwards.
- `Transaction.amountMinor` is always positive; `kind` gives the direction. An expense has a `subsectionId`; income has `null`.

### Field rules

| Field | Rule |
|---|---|
| `username` | 3 to 32 characters from `a-z 0-9 _ . -`. Lower-cased before storing and comparing. |
| `displayName` | 1 to 60 characters after trimming. |
| `password`, `newPassword` | 10 to 200 characters. |
| `baseCurrency` | A code from `Intl.supportedValuesOf('currency')`. |
| `name` (pocket, section, subsection) | 1 to 60 characters after trimming. |
| `openingBalanceMinor` | Integer, may be negative, absolute value at most 10^13. |
| `budgetMinor` | Integer from 0 to 10^13. |
| `amountMinor` | Integer from 1 to 10^13. |
| `date` | A real calendar date. |
| `payee` | 1 to 120 characters after trimming. |
| `note` | 0 to 500 characters. Defaults to `""`. |
| `pocketId`, `subsectionId` | Must belong to the signed-in person, else a `validation` error on that field. |

### Routes

**Health and sign-in**

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/health` | | 200 `{ "ok": true }` | |
| `GET /api/auth/state` | | 200 `{ "needsSetup": boolean, "user": User \| null }` | `needsSetup` is true while no account exists. |
| `POST /api/auth/setup` | `{ username, displayName, password, baseCurrency }` | 201 `{ user }`, signed in | Only while no account exists; creates the owner. Afterwards 409 `conflict`. |
| `POST /api/auth/login` | `{ username, password }` | 200 `{ user }`, signed in | 401 `invalid_credentials`. At most 10 failed attempts per 15 minutes per address, then 429. Successful sign-ins do not count. |
| `POST /api/auth/logout` | | 204 | Ends this session. |
| `POST /api/me/password` | `{ currentPassword, newPassword }` | 204 | Wrong current password is a `validation` error on `currentPassword`. Ends the person's other sessions. |

**People (owner only; others get 403)**

| Route | Body | Success |
|---|---|---|
| `GET /api/users` | | 200 `{ "users": User[] }` |
| `POST /api/users` | `{ username, displayName, password, baseCurrency }` | 201 `{ user }` |

**Pockets**

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/pockets` | | 200 `{ "pockets": Pocket[] }` | Oldest first. |
| `POST /api/pockets` | `{ name, kind, openingBalanceMinor }` | 201 `{ pocket }` | The server sets `currency` to the person's base currency. |
| `PATCH /api/pockets/:id` | any of `{ name, kind, openingBalanceMinor }` | 200 `{ pocket }` | |
| `DELETE /api/pockets/:id` | | 204 | 409 `in_use` if it has transactions. |

**Sections and subsections**

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/sections` | | 200 `{ "sections": Section[] }` | By `position`, subsections by `position`. |
| `POST /api/sections` | `{ name }` | 201 `{ section }` | Added last, with no subsections. |
| `PATCH /api/sections/:id` | `{ name }` | 200 `{ section }` | |
| `DELETE /api/sections/:id` | | 204 | Deletes its subsections too. 409 `in_use` if any of them has transactions. |
| `POST /api/sections/:id/subsections` | `{ name, budgetMinor }` | 201 `{ subsection }` | Added last in the section. |
| `PATCH /api/subsections/:id` | any of `{ name, budgetMinor }` | 200 `{ subsection }` | |
| `DELETE /api/subsections/:id` | | 204 | 409 `in_use` if it has transactions. |

**Transactions**

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/transactions?month=YYYY-MM` | | 200 `{ "transactions": Transaction[] }` | `month` is required. Optional `pocketId` and `subsectionId` filters. Newest date first, then highest id first. |
| `POST /api/transactions` | `{ date, kind, amountMinor, pocketId, subsectionId, payee, note? }` | 201 `{ transaction }` | An expense needs a `subsectionId`; income needs `subsectionId: null`, sent explicitly. Otherwise a `validation` error on `subsectionId`. |
| `PATCH /api/transactions/:id` | any of the same fields | 200 `{ transaction }` | The patch is merged over the stored transaction and the result must satisfy the same rules, so changing `kind` to income also sends `subsectionId: null`. |
| `DELETE /api/transactions/:id` | | 204 | |

**Budget**

`GET /api/budget?month=YYYY-MM` returns the month's figures. `spentMinor` is the sum of that month's expenses; `availableMinor` is budget minus spent and may be negative; `incomeMinor` is the sum of that month's income.

```json
{
  "month": "2026-10",
  "currency": "EUR",
  "totals": { "incomeMinor": 200000, "budgetedMinor": 110000, "spentMinor": 99015, "availableMinor": 10985 },
  "sections": [
    { "id": 1, "name": "Needs", "colorSlot": 1, "budgetedMinor": 110000, "spentMinor": 99015, "availableMinor": 10985,
      "subsections": [
        { "id": 3, "name": "Food", "budgetMinor": 30000, "spentMinor": 21240, "availableMinor": 8760 }
      ] }
  ]
}
```

A subsection's budget is one standing amount in this slice: the same figure applies to whichever month is viewed.

### Commands and settings

Each package provides these npm scripts, because the root `package.json` calls them:

| Package | `dev` | `build` | `test` | `start` |
|---|---|---|---|---|
| `server` | Runs on port 3000 and restarts on change. | Type-checks and compiles. | `vitest run` | Runs the compiled server. |
| `web` | Vite on port 5173 with the `/api` proxy. | Type-checks and writes `web/dist`. | `vitest run` | |

Server environment variables: `PORT` (default 3000), `TALLY_DATA_DIR` (default `server/data`; the database is `tally.db` inside it), `TALLY_COOKIE_SECURE` (default `false`; `true` when Tally is reached over HTTPS).

## Backend

Owner: `backend-dev`. Paths: `server/**`, the root `package.json`, the root `README.md`.

1. **Database.** SQLite through `better-sqlite3`, with foreign keys on. Numbered `.sql` migration files applied at start-up and recorded in a table, so later slices add migrations instead of rewriting the schema. Every table except the migration record and `users` carries a `user_id`.
2. **Isolation.** Every query is filtered by the signed-in person's id. Asking for another person's row by id answers 404, exactly as if it did not exist.
3. **Passwords.** `crypto.scrypt` with a random 16-byte salt per person, N = 32768, r = 8, p = 1 (raise `maxmem` to fit), stored with its parameters so they can be raised later, compared with `crypto.timingSafeEqual`. On an unknown username still run one scrypt so the response time does not reveal whether the username exists.
4. **Sessions.** A random 32-byte token in a cookie named `tally_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `TALLY_COOKIE_SECURE` is true, 30 days. Store only the SHA-256 of the token. Reject and delete expired sessions.
5. **Hardening.** `helmet`, the sign-in rate limit, the JSON content-type rule, `zod` validation on every body and query. Tally is usually reached over plain HTTP on a home network, so change two of helmet's defaults: leave the `upgrade-insecure-requests` directive out of the content security policy, and send the `Strict-Transport-Security` header only when `TALLY_COOKIE_SECURE` is true.
6. **Routes** as in the contract.
7. **Serving the app.** If `web/dist` exists, serve it, and answer any other non-`/api` GET with its `index.html` so page reloads work. Express 5 does not accept a bare `*` route: use a final middleware.
8. **Root `package.json`** with scripts only, no dependencies: `setup` (installs both packages), `build` (web, then server), `test` (both), `start`, `dev:server`, `dev:web`.
9. **Root `README.md`**: what Tally is in two sentences, then how to install, run in development, build, start, where the data lives, and the three environment variables.
10. **Tests** against the real app with a temporary database, covering at least acceptance criteria 2 to 10.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/README.md` first. Import `design/tokens.css` and `design/components.css` straight from the `design/` folder (allow it in the Vite config) and do not copy them. Use the classes and markup shown in `design/components/<Name>/preview.html`. Anything the design folder does not cover goes in `web/src/app.css`, with class names starting `app-`, using only the design tokens.

### Pages

| Path | Page |
|---|---|
| `/setup` | First run only. "Create the first account": display name, username, password, base currency (a select of `Intl.supportedValuesOf('currency')`, default EUR). Button "Create account". |
| `/sign-in` | Username, password, button "Sign in". On 401 show "That username and password don't match." under the form. |
| `/budget` | The default page. Month in the query string (`?month=2026-10`), defaulting to the current month. |
| `/transactions` | Month, Subsection and Pocket filters above a day-grouped list. |
| `/pockets` | The total and a card per pocket. |
| `/settings` | Your account, change password, and for the owner the list of people. |

On load call `GET /api/auth/state`: go to `/setup` when `needsSetup`, to `/sign-in` when there is no user. Any 401 from any later call returns the person to `/sign-in`.

### Frame

`AppShell`. Navigation shows only pages that exist: Budget, Transactions, Pockets, Settings. On phones the tab bar shows the same four (label the fourth "Settings", not "More"). The sidebar foot shows "Signed in as {displayName}", "Base currency {code}" and a quiet "Sign out" button; on phones "Sign out" is on the Settings page. The frame fills the height of the window, so the sidebar reaches the bottom on short pages too.

On phones every page starts with the translucent top bar (`ty-topbar`), as `design/components/AppShell/README.md` and the `BudgetPhone` preview show, and the desktop title row is not shown. The bar holds the page title and the page's primary action shortened to "Add", with the full name as its `aria-label`: Budget (previous and next month buttons around the month, "Add" for a transaction), Transactions ("Add"), Pockets ("Add"), Settings (title only). There is no Open pill in this slice.

### Budget page

- `MonthHeader`: the month as the title, previous and next buttons (next is disabled on the current month), and the primary button "Add transaction". No Open pill and no "Close month" button in this slice. Stats in this order: Income, Budgeted, Spent so far.
- One `SectionGroup` per section: the dot in the section's colour (slot 0 uses the plain grey dot), the name, and totals over the Budgeted, Spent and Available columns. No Rest pill and no "received" line in this slice. A small quiet "Edit" button follows the name, and "Add subsection" is the section's last row, as `design/components/SectionGroup` shows.
- One `BudgetRow` per subsection, with the meter and pill states exactly as `design/components/BudgetRow/README.md` and `Pill/README.md` give them: plain amount in the positive pill; "{amount} left" in the warning pill when more than 90% is used and something is left; "−{amount} over" in the negative pill when over; "0.00 left" in the neutral pill when exactly nothing is left. A subsection with a budget of 0 and nothing spent shows the neutral pill and an empty meter.
- Selecting a row opens "Edit subsection" (name, monthly budget, and a Delete button kept apart from Save). "Edit" on a section opens the same for its name.
- "Add section" sits under the last section, as a plain button.
- With no sections: one card with the line "No sections yet. A section is a group such as Needs or Savings." and the button "Add section".

### Transactions page

- Title, primary button "Add transaction", then the three filters.
- `TransactionRow`s grouped under day headings ("11 October"), newest first. The second line reads "Entered by hand", or "Income · entered by hand". An expense shows its subsection with its section's dot, and its amount with a minus sign. Income shows a grey dot with "Income", and its amount with a plus sign in `ty-num--pos`.
- Selecting a row opens the transaction dialog filled in, with a Delete button.
- With none in the month: one card with "No transactions in {month}." and the button "Add transaction".

### Transaction dialog

Fields in this order: Type (two native radio buttons in a fieldset, "Money out" and "Money in", default out), Date (native date input, default today), Amount (`ty-input--amount` with the currency code after it), Payee, Subsection (a select grouped by section with `optgroup`; hidden for money in), Pocket (select), Note (optional). The primary button reads "Add transaction" or "Save".

If there is no pocket yet, the dialog says "Add a pocket first" with a link to the Pockets page instead of the form. The same for money out with no subsection yet, pointing to the Budget page.

### Pockets page

- "Total in pockets" as the label with the sum of all balances in `num-hero`, followed by the currency code. Primary button "Add pocket".
- A `PocketCard` per pocket: name, kind in words (Bank account, Cash, Fund, Broker), the currency pill, the balance, and the line "Entered by hand".
- Selecting a card opens "Edit pocket" (name, kind, opening balance, Delete). On 409 show "This pocket has transactions. Delete them first." in the dialog.
- With none: one card with "No pockets yet. A pocket is where money sits: a bank account, cash, a fund." and the button "Add pocket".

### Settings page

- "Your account": display name, username and base currency, read-only.
- "Change password": current password, new password, button "Change password".
- Owner only, "People": each person's display name and username, with a neutral "Owner" pill on the owner, and "Add a person" (display name, username, temporary password, base currency).

### Rules for every page

- **Dialogs** are the native `<dialog>` element opened with `showModal()`, carrying the `ty-dialog` class, with `::backdrop` in the `scrim` token. Escape closes them and focus returns to what opened them; if that control no longer exists (an empty-state button that disappeared after the save), focus moves to the page's main heading. On phones the dialog sits at the bottom edge at full width.
- **Amounts.** One module formats and parses money, with tests. Format: two decimals, thousands separators, U+2212 for minus (`1,175.00`, `−48.20`). Parse: accept `12`, `12.5`, `12.50` and `1,234.56`; reject anything else, including zero, negatives and more than two decimals, with "Enter an amount above zero, with at most two decimals." under the field. Convert to minor units without floating-point error.
- **Errors.** Show each `fields` message under its field in `ty-error` and mark the input with `ty-input--error`. Show any other error's `message` at the top of the form.
- **After a change** the affected lists and totals refresh without a page reload. Signing out does not trigger a refresh.
- **Undo.** Deleting a transaction, subsection, section or pocket does it at once and shows the design's `Toast` (`ty-toast`) with "Undo" for 6 seconds; Undo creates it again. The same toast, without a button, confirms a save ("Saved") for 3 seconds.
- **Loading** shows "Loading…" in `ty-cap` where the content will be. **Failure** shows one card with "Couldn't load this page. Check that Tally's server is running." and the button "Try again".
- **Nothing is loaded from another host.** Fonts come from the two npm packages.
- **No colour literals** in `web/src`. Every colour is a token.
- Every input has a label, every control works from the keyboard, and the focus ring is the design's.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

Added after the slice was built, when the team gained a tester, so the suite for this slice is written against an app that already exists.

- A third independent package, `e2e/`, with `@playwright/test`. Its `test` script starts the built server on a spare port with a new temporary database and runs the suite. The root `package.json` gets one script, `test:e2e`, that builds the app and then runs it.
- Cover acceptance criteria 12 to 18 and every flow in the UI section: first-run set-up, sign-in and sign-out, each page's empty state, adding, editing and deleting a section, a subsection, a pocket and a transaction, Undo after each delete, the four pill states and a zero budget, figures refreshing without a reload, the Transactions filters, changing a password, the owner adding a person, a second person seeing none of the first person's data, the delete conflicts shown in their dialogs, the failure state with "Try again", keyboard use of rows and dialogs, the phone layout, and dark mode.
- The sign-in rate limit is not tested in the browser.

## Acceptance criteria

1. From a fresh clone, `npm run setup`, `npm run build` and `npm test` at the root all succeed.
2. With an empty data directory, `GET /api/auth/state` says `needsSetup: true`. After set-up it returns the owner, and a second set-up call answers 409.
3. Signing in sets the session cookie and signing out ends it. A wrong password answers 401 `invalid_credentials`. A protected route without a cookie answers 401 `unauthenticated`.
4. The database holds no plain passwords and no plain session tokens. The cookie is `HttpOnly` and `SameSite=Lax`.
5. A test shows that a second person cannot read, change or delete the first person's pocket, section, subsection or transaction (each answers 404), and that no list includes another person's rows.
6. The owner can add a person, anyone else gets 403, and the new person can sign in and change their password.
7. A pocket's balance equals its opening balance plus income minus expenses.
8. The budget figures for a month count only that month's transactions.
9. An expense without a subsection, income with a subsection, and an amount that is zero, negative or not an integer each answer 400 `validation`.
10. Deleting a pocket or a subsection that has transactions answers 409 `in_use`.
11. A changing request without `Content-Type: application/json` answers 400.
12. A first run shows the set-up page, then the app. All four pages are reachable from the sidebar on desktop and from the tab bar at phone width, where each page also shows the top bar with its title and primary action.
13. The Budget page shows Budgeted, Spent and Available for each subsection with the four pill states as specified.
14. Adding, editing or deleting a transaction updates the Budget page and the pocket balance without a reload, and a delete offers Undo.
15. Amount entry accepts and rejects the examples given, and amounts display in the specified format. The money module has tests.
16. `web/src` contains no colour literals and the built app requests nothing from another host.
17. Every page has its loading, empty and failure states.
18. Dialogs close with Escape and return focus, and every control is usable from the keyboard.
