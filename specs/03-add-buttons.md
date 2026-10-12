# Spec 03: Coloured Add income and Add transaction buttons

Follows `specs/02-first-income.md`, which stays the reference for everything not changed here.

## Goal

The user tried spec 02 and said the "Add income" button beside the Income figure "barely is seen as a button, it looks like a description". This spec moves it next to "Add transaction" and gives each of the two a colour of its own:

- "Add income" is green, the colour of money coming in.
- "Add transaction" is orange, the colour of spending. Orange and not red, because the user finds red jarring, like a mistake.

The design system already has the colours and the button classes. This spec puts them in the app.

## Out of scope

- An "Add income" button on the Transactions page. Income is added there through "Add transaction" and the Type chips, as today.
- Renaming "Add transaction".
- Colouring anything else: the Type chips, amounts, rows, the "Add transaction" button inside the Transactions empty card, and every other primary button stay as they are.
- "Close month", which the `MonthHeader` preview shows and the app does not have yet.
- Any change to `server/`.

## Shared contract

No route or data shape changes. What `ui-dev` and `tester` share is the design system, which has already been changed for this spec. Neither of you edits `design/`.

| Token | Light | Dark | Used for |
|---|---|---|---|
| `--income` | `#19a06d` | `#2fb886` | Fill of an income button |
| `--spend` | `#de6e18` | `#e67c26` | Fill of a spend button |
| `--on-money` | `#141a18` | `#141a18` | Text on both fills, in both themes |
| `--action` | `#141a18` | `#eef1ee` | Fill of a primary button (unchanged) |

| Class | Meaning |
|---|---|
| `ty-btn--income` | A button filled with `--income`, text `--on-money` |
| `ty-btn--spend` | A button filled with `--spend`, text `--on-money` |
| `ty-month__add` | Added to the phone's "Add income" button: hidden above 640px, shown full width at 640px and below |

`ty-stat__row` no longer exists in the design CSS.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/README.md` again ("Two buttons carry colour"), and the README and preview of `Button`, `MonthHeader`, `BudgetPhone`, `TransactionsScreen`, `TransactionDialog` and `AppShell` under `design/components/`. They changed for this spec. No motion or gesture is added: the buttons behave like every other button.

### Budget page

- **Desktop title row.** After the month buttons and the spacer come "Add income" (`ty-btn ty-btn--income`) and then "Add transaction" (`ty-btn ty-btn--spend`), which stays rightmost. "Add income" opens the transaction dialog with Income chosen, "Add transaction" with Expense chosen, as before.
- **Income figure.** Remove the "Add income" button beside it. Income becomes a plain figure like Budgeted and Spent so far, with no `ty-stat__row`.
- **Phone.** The top bar's "Add" button becomes `ty-btn--spend` and keeps its `aria-label` "Add transaction". Under the figures, inside the same `header` (`ty-month`) and after `ty-stats`, add a second "Add income" button with the classes `ty-btn ty-btn--income ty-month__add`. The design CSS hides it on desktop and stretches it across the page on phones. Render it together with the figures, so it does not jump when they load.
- At any window width exactly one "Add income" button is visible on the page.

### Transactions page

- "Add transaction" in the desktop title row becomes `ty-btn--spend`, and so does "Add" in the phone top bar.
- The "Add transaction" button inside the empty card stays a plain button.

### Other pages

The phone top bar's "Add" stays `ty-btn--primary` wherever its action is not "Add transaction" (Pockets: "Add pocket").

### Transaction dialog

- When adding, the submit button takes the colour of the chosen type: "Add income" is `ty-btn--income`, "Add expense" is `ty-btn--spend`. It changes with the label when the Type chip changes.
- When editing, "Save" stays `ty-btn--primary`.
- Every other dialog keeps its `ty-btn--primary` submit button.

### Exact wording

Nothing is renamed. For the tester:

| Where | Wording |
|---|---|
| Budget, desktop title row | Buttons "Add income" then "Add transaction" |
| Budget, phone | Top bar button "Add" with `aria-label` "Add transaction". Under the figures a button "Add income". |
| Transactions | "Add transaction" on desktop, "Add" with `aria-label` "Add transaction" on phones. No "Add income". |
| Transaction dialog | Submit button "Add income", "Add expense" or "Save", as in spec 02 |

## Backend

Nothing to do. `backend-dev` is not part of this spec.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Update the existing tests that look for "Add income" beside the Income figure. It is now in the title row on desktop and under the figures on phones.
- Add tests for acceptance criteria 2 to 8. Check a fill by comparing the button's computed `background-color` with the value of its token in the table above, in the light and in the dark colour scheme. Check the text colour the same way.
- Screenshots, each in light and dark: the Budget page on desktop and on a phone, the Transactions page on desktop and on a phone, the transaction dialog on "Add income" and on "Add expense".

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. On the Budget page on desktop, "Add income" sits directly left of "Add transaction" on the same line as the month title, and "Add transaction" is the rightmost button. There is no button beside the Income figure.
3. "Add income" has the `--income` fill and "Add transaction" the `--spend` fill, both with `--on-money` text, in light and in dark.
4. On a phone (390px wide) the top bar's "Add" has the `--spend` fill. One "Add income" button is visible under the figures, as wide as the page content, at least 44px tall, with the `--income` fill. It opens the transaction dialog with Income chosen.
5. At 390px and at 1280px wide, exactly one "Add income" button is visible on the Budget page while no dialog is open.
6. On the Transactions page "Add transaction" (desktop) and "Add" (phone) have the `--spend` fill, and there is no "Add income" button. On the Pockets page "Add pocket" (desktop) and "Add" (phone) still have the `--action` fill.
7. In the transaction dialog the submit button of a new income reads "Add income" with the `--income` fill. Choosing the Expense chip changes it to "Add expense" with the `--spend` fill. When editing a transaction it reads "Save" with the `--action` fill.
8. From the keyboard on the desktop Budget page, Tab reaches "Add income" and then "Add transaction", and each shows the focus ring.
9. `web/src` still has no colour literals, and `ty-stat__row` appears nowhere in `web/src`.
10. The screenshots match `design/components/MonthHeader`, `BudgetPhone`, `TransactionsScreen` and `TransactionDialog`, apart from "Close month", the Open pill and the "Import a statement" button, which the app does not have yet.
