# Spec 15: Statement import and rules

Follows specs 01 to 13 and 12, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`, phase 3 and "Later":

- **File import:** a bank statement file (CSV) from any bank, the fallback that keeps working when a live connection does not.
- Imported transactions keep the pocket the statement is for; only their subsection or source, payee and note can be changed. Hand-entered ones stay fully editable.
- **Rules** put transactions in a subsection or source automatically, by payee.

## Out of scope

- Other file formats (OFX, QIF, PDF), and live bank connections (their own specs).
- Splitting one transaction across subsections.
- Matching a statement's transfers to transfers between the person's pockets.

## Shared contract

### Transactions

- `Transaction.source` may be `'import'`. An imported expense may have `subsectionId: null` and an imported income `sourceId: null`: such a transaction **needs sorting**.
- A transaction that needs sorting counts in no subsection, source, budget, pipeline or month figure until it is sorted. Its pocket balance counts it.
- On an imported transaction, `PATCH` may change only `subsectionId` (expense), `sourceId` (income), `payee` and `note`; any other field answers 400 on that field: "An imported transaction keeps this."
- Closing a month that has transactions needing sorting answers 409 `unsorted`: "Sort this month's imported transactions first." The close dialog shows it.
- `GET /api/transactions` takes `unsorted=1` to list only those needing sorting (any month when `month` is left out). `GET /api/budget` gains `unsortedCount` for the month.

### Import

| Route | Body | Success |
|---|---|---|
| `POST /api/imports/preview` | `{ pocketId, text }` | 200 `{ delimiter, headers, rows, guess }` |
| `POST /api/imports` | `{ pocketId, text, mapping }` | 201 `{ added, duplicates, closed, unsorted }` |

- `text` is the file's content, at most 5,000,000 characters: 400 on `text`, "The file is too large." A file the server cannot read as CSV (no header row, or rows of different lengths): 400 on `text`, "This file does not look like a CSV statement."
- The delimiter is `,`, `;` or a tab: whichever splits the header row into the most columns. Quotes follow RFC 4180. `rows` in the preview are the first 5 data rows.
- `mapping`: `{ date: column, dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD.MM.YYYY', amount?: column, debit?: column, credit?: column, payee: column, note?: column, decimal: '.' | ',' }`, columns by index. Either `amount` (signed: below zero is spending) or both `debit` and `credit` (each positive, credit is income). `guess` is the server's best mapping from the header names (date, amount, debit, credit, payee/description/merchant, note/reference) and the first rows, `null` per field it cannot guess.
- A row whose date or amount cannot be read under the mapping stops the whole import: 400 on `mapping`, "Row 12 has a date or amount this mapping cannot read." Nothing is saved.
- Each row becomes an imported transaction in the pocket: spending as an expense, income as an income, zero skipped. Its subsection or source comes from the first matching rule, else it needs sorting.
- **Duplicates:** for each (date, amount, payee) a statement row is skipped as long as the pocket already has as many transactions with that date, amount and payee (whatever their source) as the statement rows with it so far. Counted in `duplicates`.
- Rows in a closed month are skipped and counted in `closed`. `unsorted` counts the added transactions that need sorting.

### Rules

```ts
type Rule = { id: number; match: string; subsectionId: number | null; sourceId: number | null };
```

| Route | Body | Success |
|---|---|---|
| `GET /api/rules` | | 200 `{ rules }` (oldest first) |
| `POST /api/rules` | `{ match, subsectionId }` or `{ match, sourceId }` | 201 `{ rule, sorted }` |
| `DELETE /api/rules/:id` | | 204 |

- A rule matches a transaction whose payee contains `match`, ignoring case. The oldest matching rule wins. A subsection rule applies to expenses, a source rule to incomes.
- Creating a rule also sorts every transaction that needs sorting and matches it, in open months; `sorted` is how many.
- `match` 1 to 60 characters after trimming ("Enter the text to look for."); exactly one of `subsectionId` and `sourceId`, the person's ("Choose a subsection or a source.").
- Deleting a subsection or source used by a rule deletes the rule.

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. Migration `009_import.sql` (spec 11 and 13 use 006 and 007 on the other branch, so currencies is now `008`): imported transactions (`source`, nullable subsection and source for them), the rules table.
2. The CSV reader (no new dependency: a small RFC 4180 parser), the routes and rules above, and the figures leaving out transactions that need sorting.
3. Tests: comma, semicolon and tab files, quoted fields with delimiters and newlines; each date format and both decimal marks; amount and debit/credit; a bad row stopping everything; duplicates against existing transactions and within one file; closed months; rules on import and on creation; the patch limits on imported transactions; closing refused while unsorted; isolation; every field rule.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/components/TransactionsScreen`, `TransactionRow`, `TransactionDialog`, `Dialog` and `Chips` again: the "Import a statement" button and the "From your bank" line are designed there. No new design component.

- **Import dialog** from "Import a statement" on the Transactions page. Title "Import a statement". Step one: "Pocket" (chips) and "File" (a file input, `.csv`), then "Next". Step two: the five preview rows in a table under the file's headers, then selects "Date", "Date format", "Amount" (with a last choice "Separate debit and credit columns", which shows "Debit" and "Credit"), "Payee", "Note (optional)", "Decimal mark" ("." / ","), filled from `guess`. Primary "Import". Then a summary in the dialog: "Added 42 transactions. 3 were already here. 12 need a subsection or source." (each sentence only when its number is above 0, plus "2 were in a closed month."), and "Done".
- **Transactions page:** a filter chip or select choice "Needs sorting" listing them with the count. An imported row's second line reads "From a statement" (in place of "Entered by hand"); a row needing sorting shows the Pill "Needs sorting" (`ty-pill--warning`) where its subsection or source would be.
- **Transaction dialog on an imported transaction:** "Type", "Date", "Amount" and "Pocket" are shown disabled; under them in `ty-cap`: "Imported from a statement: only its subsection or source, payee and note can change." After choosing a subsection or source, a checkbox "Always use this for {payee}" creates a rule on save (toast "Saved. 4 more sorted." when it sorted others).
- **Budget page:** when `unsortedCount` is above 0, a `ty-inset` notice: "12 imported transactions need a subsection or source." with the link "Sort them" to the Transactions page's "Needs sorting".
- **Settings page:** a "Rules" card: one row per rule ("Payee contains 'LIDL' → Food") with a small quiet "Delete", and "Add rule" opening a dialog with "Payee contains", "Put in" (`Segmented`: "Subsection" / "Source") and the matching select.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Tests for acceptance criteria 2 to 7, with fixture CSV files under `e2e/`. Screenshots light and dark, desktop and phone, of the import dialog's mapping step and the Transactions page with rows needing sorting.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Importing a semicolon CSV with `DD.MM.YYYY` dates and a comma decimal mark, guessed correctly, adds its rows with the summary sentences.
3. Importing the same file again adds nothing and says how many were already here.
4. A rule "LIDL → Food" made before importing sorts those rows; one made from the dialog's checkbox sorts the others and the toast says how many.
5. Rows needing sorting show the Pill and the "Needs sorting" filter; the Budget page shows the notice; they count in no budget figure until sorted.
6. An imported transaction's type, date, amount and pocket cannot be changed in the dialog.
7. Closing a month with unsorted imported transactions shows "Sort this month's imported transactions first."
8. The backend tests cover every rule in the contract.
9. The screenshots match `TransactionsScreen` and `TransactionRow`.
