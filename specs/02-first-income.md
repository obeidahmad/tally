# Spec 02: First income without leaving the page

Follows `specs/01-foundations.md`, which stays the reference for everything not changed here.

## Goal

The user opened the first slice and could not find how to add income, and then found that a pocket had to be created on another page first. This spec fixes both, and adds an emoji to each pocket:

- "Add income" sits beside the Income figure on the Budget page.
- A pocket can be created inside the transaction dialog, so a new person records their first income without leaving the page.
- Every pocket has an emoji that shows wherever its name does.
- The app says "Expense" and "Income", never "Money out" and "Money in".

It also closes what the first browser test run left open.

## Out of scope

- Typing or pasting an emoji that is not in the list. Emoji for sections or subsections.
- An opening balance when a pocket is created inside the transaction dialog. It starts at 0 and can be changed on the Pockets page.
- Creating a subsection inside the transaction dialog.
- Income sources and split rules.
- Everything spec 01 lists as out of scope.

## Shared contract

Changes to the contract in spec 01. Everything else there stands.

### Pocket emoji

```ts
type Pocket = { id: number; name: string; kind: 'bank' | 'cash' | 'fund' | 'broker'; emoji: string; currency: string;
                openingBalanceMinor: number; balanceMinor: number };
```

- `emoji` is exactly one of the 32 characters below. Each is a single code point with no variation selector after it. Build them from the code points (`String.fromCodePoint(0x1F3E6)`) instead of pasting characters, so no invisible selector slips in.
- `POST /api/pockets` takes an optional `emoji`. When it is left out the server uses the default for the kind: bank `1F3E6`, cash `1F4B5`, fund `1F331`, broker `1F4C8`.
- `PATCH /api/pockets/:id` takes `emoji` like any other field.
- An `emoji` that is not in the list is a `validation` error on `emoji`.
- Every pocket that exists before this change gets the default for its kind.

| Code point | Name | Code point | Name | Code point | Name | Code point | Name |
|---|---|---|---|---|---|---|---|
| `1F3E6` | Bank | `1F437` | Piggy bank | `1F381` | Gift | `1F4F1` | Phone |
| `1F4B3` | Card | `1F4C8` | Chart | `1F393` | Graduation cap | `1F30D` | Globe |
| `1F4B5` | Banknote | `1F331` | Seedling | `1F476` | Baby | `1F3D6` | Beach |
| `1F4B6` | Euro note | `1F48E` | Gem | `2764` | Heart | `1F6E0` | Tools |
| `1F4B7` | Pound note | `1F512` | Lock | `2B50` | Star | `1F3AF` | Target |
| `1F4B0` | Money bag | `1F3E0` | House | `2602` | Umbrella | `1F9FE` | Receipt |
| `1FA99` | Coin | `1F697` | Car | `1F6D2` | Shopping cart | `1F932` | Open hands |
| `1F45B` | Purse | `2708` | Plane | `1F4BC` | Briefcase | `1F54C` | Mosque |

The picker shows them in reading order down each column pair: Bank, Card, Banknote, Euro note, Pound note, Money bag, Coin, Purse, Piggy bank, Chart, Seedling, Gem, Lock, House, Car, Plane, Gift, Graduation cap, Baby, Heart, Star, Umbrella, Shopping cart, Briefcase, Phone, Globe, Beach, Tools, Target, Receipt, Open hands, Mosque.

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. A second migration adds `emoji` to pockets and sets every existing pocket to the default for its kind. Do not edit the first migration: the user already has a database made from it.
2. `POST` and `PATCH` on pockets validate `emoji` against the list and apply the default on `POST`.
3. The server's validation messages reach the screen, so they use the same words: "Choose expense or income." for a wrong `kind`, and "Income has no subsection." for income sent with a subsection. No message says "money in" or "money out".
4. Tests: the default for each kind; a listed emoji is kept; an unlisted emoji, an empty string, and a listed emoji followed by U+FE0F are each refused with a `validation` error on `emoji`; `PATCH` changes it; a database that has pockets from before the migration ends up with each kind's default.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/README.md` again, and the README and preview of `TransactionDialog`, `Chips`, `EmojiPicker`, `MonthHeader`, `PocketCard` and `TransactionRow` under `design/components/`. They changed for this spec.

### Words

"Expense" and "Income" everywhere. "Money out" and "Money in" appear nowhere.

### Add income

On the Budget page a small quiet "Add income" button sits beside the Income figure, as the `MonthHeader` preview shows, on desktop and on phones. It opens the transaction dialog with Income chosen. "Add transaction" (and "Add" in the phone top bar) opens it with Expense chosen, as before.

### Transaction dialog

Build it as `design/components/TransactionDialog` shows.

- **Title and primary button** follow the type: "Add expense" or "Add income". When editing, the title is "Edit expense" or "Edit income" and the button is "Save".
- **Type** is a `Chips` group with the legend "Type" and the chips "Expense" and "Income".
- **Pocket** is a `Chips` group with the legend "Pocket": one chip per pocket showing its emoji and name, then a last chip "+ Add pocket".
- When pockets exist, a new transaction opens with the first pocket's chip chosen, and an edited one with its own pocket's chip.
- **"+ Add pocket"** opens a `ty-inset` panel under the chips with "Pocket name" (text), "Emoji" (the `EmojiPicker`) and "Kind" (a select: Bank account, Cash, Fund, Broker, starting on Bank account).
  - When the person has no pocket yet, "+ Add pocket" is already chosen and the panel is open. This replaces the old "Add a pocket first" message.
  - The emoji starts on the default for the kind and follows the kind when it changes, until the person picks one themselves.
  - Saving creates the pocket first, with an opening balance of 0, then the transaction in it. If creating the pocket fails, show its errors in the panel (`name` under "Pocket name"). If the pocket is created and the transaction then fails, keep the new pocket as the chosen chip, close the panel, and show the transaction's errors as usual.
- **The other fields** are unchanged: Date, Amount, Payee, Subsection (a select grouped by section, for an expense only), Note (optional). For an expense when no subsection exists yet, the fields under Type are replaced by "Add a subsection first" with a link to the Budget page, as before.

### Pockets

- The "Add pocket" and "Edit pocket" dialogs have these fields in order: "Name", "Emoji" (the `EmojiPicker`), "Kind", "Opening balance". When adding a pocket, the emoji follows the kind in the same way as in the transaction dialog. When editing one, its own emoji counts as picked, so changing the kind leaves it alone.
- A pocket's emoji comes before its name wherever the name shows: its card, its chip, and its transaction rows (the pocket column, and the second line on phones). Draw it with the design's `ty-emoji` class.
- In the Pocket filter on the Transactions page, which is a native select, put the emoji before the name as plain text. A select draws it in the device's own emoji style, and that is accepted.

### Fonts

Add `@fontsource-variable/noto-emoji`. The design tokens now name the variable fonts' own family names for both the display and the emoji face, so remove the `--font-display` override from `app.css`.

### Carried over from the first browser test run

- **Focus ring on rows.** The design CSS now draws it for budget rows, transaction rows and pocket cards (inside the edge for rows). Remove the app's own rule for them so the design's applies.
- **Focus after the opener disappears.** On the Pockets page, after adding the first pocket from the empty card, focus sometimes lands on the "Add pocket" button in the title row. It must land on the page heading every time. The rule for every page: when adding the first item, deleting the last one, or an Undo changes a page between its empty state and its list, focus moves to the page heading, unless a dialog is open. Changing a filter or the month never moves focus, even when the result is empty.
- **Dialog buttons stay in view.** The design CSS now keeps a dialog no taller than the window, scrolls its content, and pins `ty-dialog__foot` to its bottom edge. Remove the app's own height and scrolling rules for dialogs so the design's apply. With the new-pocket panel open, "Add income" must be visible without scrolling, on desktop and on phones.
- **An income row on a phone** shows only the pocket (emoji and name) on its third line, since its second line already says "Income".
- **Delete conflicts** show these exact sentences in the dialog: "This subsection has transactions. Delete them first." and "This section has transactions. Delete them first.", like the pocket's.
- **Amount fields** that open with a value (editing) show it with two decimals and no thousands separators, such as `1000.00`.

### Exact wording

The tester writes tests from these words, so use them as written.

| Where | Wording |
|---|---|
| Month buttons | `aria-label` "Previous month" and "Next month" |
| Section dialog | Titles "Add section" and "Edit section". Field "Name". Buttons "Add section" or "Save", "Delete", "Cancel". |
| Subsection dialog | Titles "Add subsection" and "Edit subsection". Fields "Name" and "Monthly budget". Buttons "Add subsection" or "Save", "Delete", "Cancel". |
| Pocket dialog | Titles "Add pocket" and "Edit pocket". Fields "Name", "Emoji", "Kind", "Opening balance". Buttons "Add pocket" or "Save", "Delete", "Cancel". |
| Transaction dialog | Titles and buttons as above. Fields "Type", "Date", "Amount", "Payee", "Subsection", "Pocket", "Note (optional)". Panel fields "Pocket name", "Emoji", "Kind". Buttons "Delete", "Cancel". |
| Emoji choices | Each is a radio input whose accessible name is its name from the contract table ("Bank", "Piggy bank"). |
| Toasts | "Transaction deleted", "Subsection deleted", "Section deleted" and "Pocket deleted", each with "Undo". "Saved" after a save. |
| Phone top bar | The "Add" button's `aria-label` is "Add transaction" on Budget and Transactions and "Add pocket" on Pockets. |
| Signed in | Opening `/setup` or `/sign-in` while signed in goes to `/budget`. |
| Rows and cards | Open with Enter and with Space. |

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Update the existing tests to the new words and the new dialog (chips in place of the radio buttons and the Pocket select).
- Add tests for acceptance criteria 4 to 9.
- The two tests that failed in the first run (the row focus ring and the focus after the Pockets empty card) now state what this spec says. Run the Pockets one enough times to show it no longer fails now and then.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. A pocket created without an emoji gets the default for its kind. One created with a listed emoji keeps it. An unlisted emoji answers 400 `validation` on `emoji`. `PATCH` changes it.
3. Pockets that existed before the update have the default for their kind.
4. On a new account with no pocket, "Add income" on the Budget page ends with a saved income and a new pocket without leaving the page. The Income figure shows the amount, and the Pockets page shows the pocket with that balance and its emoji.
5. With pockets present, the transaction dialog shows one chip per pocket with its emoji, and "+ Add pocket" creates one in place and uses it.
6. The title and primary button of the transaction dialog follow the type as specified, and "Money in" and "Money out" appear nowhere.
7. A pocket's emoji shows before its name on its card, on its chip and in its transaction rows, on desktop and on phones, drawn in the Noto Emoji font.
8. The emoji picker offers exactly the 32 listed emoji with their names as accessible labels, works from the keyboard, and follows the kind until the person picks one.
9. The carried-over items hold: the focus ring on a row is inside its edge, focus lands on the heading after the Pockets empty card every time, and the three delete conflicts show their exact sentences.
10. The built app still requests nothing from another host, and `web/src` still has no colour literals. A unit test in `web/` fails if one is added.
11. In the transaction dialog the primary button is in view without scrolling, with the new-pocket panel open, at desktop and phone width.
12. On the Transactions page, changing a filter or the month to a result with no rows leaves focus on the control that was changed.
