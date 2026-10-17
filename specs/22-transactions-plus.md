# Spec 22: Transactions like Monarch and YNAB

Follows specs 01 to 21, which stay the reference for everything not changed here. Migration `015_transactions_plus.sql`.

## Goal

From the user: Tally offers the good features of Monarch, YNAB and Rocket Money around its pipeline. For transactions, that means:
- search and filters;
- split transactions;
- tags;
- editing many transactions at once;
- receipts attached to a transaction.

## Out of scope

Scheduled future transactions, merchant logos, flags or colours on transactions, OCR of receipts, and editing a transfer's split.

## Shared contract

### Search and filters

`GET /api/transactions` accepts these, combined with AND, alongside what it accepts today:

| Parameter | Matches |
|---|---|
| `q` | Payee or note containing the text, ignoring case |
| `subsectionId` | Repeatable; a split matches when any part is in it |
| `pocketId` | Repeatable |
| `kind` | `expense`, `income` or `transfer` |
| `from`, `to` | Dates, both inclusive |
| `tag` | A tag name |
| `unsorted=1` | Needs sorting |

Bad values answer 400 on the field. Paging and order stay as today.

### Splits

- An expense or income can be split into 2 to 20 parts. Each part has a `subsectionId` of the person and an `amountMinor` above 0.
- The parts add up exactly to the amount. Otherwise 400 on `splits`: "The parts add up to {sum}; the transaction is {amount}."
- A transfer cannot be split: 400 on `splits`, "A transfer cannot be split."
- **Storage:** `transaction_splits (id, transaction_id, subsection_id, amount_minor, base_amount_minor)`. The transaction's `subsection_id` is then null. Each part's `base_amount_minor` is proportional, using the largest remainder, so the parts add up to the transaction's base amount.
- **API:**
  - The transaction carries `splits: [{ subsectionId, amountMinor }] | null`.
  - `POST` and `PATCH` accept `splits` (or `null` to unsplit; that needs a `subsectionId` again).
  - An amount change on a split transaction needs new `splits` that fit.
- **Every figure counts each part in its own subsection:** budget spent, available, reports, the rest, where money sits, and recurring detection, which still groups by payee.
- Splitting or unsplitting is refused in a closed month, like any money change.

### Tags

- **Storage:** `tags (id, user_id, name)`, unique per person ignoring case, and `transaction_tags`.
- A transaction carries `tags: string[]` (sorted). `POST`/`PATCH` accept `tags`: at most 10, each 1 to 30 characters after trimming ("A tag is 1 to 30 characters."). A tag is created on first use, and an existing tag is matched ignoring case.
- `GET /api/tags` → `{ tags: [{ id, name, count }] }`. `DELETE /api/tags/:id` → 204, removing it from every transaction.
- Tags can change in a closed month, since they move no money.

### Editing many at once

`POST /api/transactions/bulk` `{ ids, action, subsectionId?, tag? }`:
- **Actions:** `action` is `subsection`, `addTag`, `removeTag` or `delete`.
- **All or nothing:** the whole request is applied, or nothing is.
- **Refused** with 400, naming the first offending transaction in the message:
  - a closed month (for `subsection` or `delete`);
  - a transfer (for `subsection`);
  - a split transaction (for `subsection`);
  - an id not the person's;
  - more than 500 ids.
- 200 → `{ count }`.

### Receipts

- `POST /api/transactions/:id/attachments`:
  - **Body:** the raw file, with `Content-Type` one of `image/jpeg`, `image/png`, `image/webp` or `application/pdf`, and the file name in the `X-Filename` header (URI-encoded). Use `express.raw` with a 10 MB limit; add no dependency.
  - **Limits:** at most 5 per transaction.
  - **Errors:**
    - 413 "A receipt can be at most 10 MB.";
    - 415 "Attach a JPEG, PNG, WebP or PDF.";
    - 409 "A transaction can have at most 5 receipts."
  - **Check the bytes:** check the file's magic bytes against its type, not only the header.
  - **Storage:** `<data dir>/attachments/<random 32 hex>` (never the user's name or file name in the path), with a row in `attachments (id, user_id, transaction_id, name, type, size, created_at)`.
  - **Answer:** 201 `{ attachment }`.
- **Reading:** a transaction carries `attachments: [{ id, name, type, size }]`. `GET /api/attachments/:id` streams it to its owner (or a person sharing that budget, spec 20) with its type, `Content-Disposition: inline; filename*=…` and `X-Content-Type-Options: nosniff`. Anyone else gets 404.
- **Deleting:** `DELETE /api/attachments/:id` → 204. Deleting a transaction deletes its files.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- each filter and their combination;
- splits: the sum rule, transfers refused, figures per part in budget, reports, rest and where money sits, base amounts adding up, unsplit, closed month;
- tags: limits, matching ignoring case, delete;
- bulk: each action, all or nothing, each refusal;
- receipts: types, magic bytes, size, count, streaming headers, access by owner, sharer and stranger, deletion with the transaction;
- isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. Built on spec 21's look and components; no new design component unless named.

- **Transactions page, filter row** (one row above the list, wrapping on phones):
  - a search field "Search payee or note";
  - "Subsection", "Pocket" and "Type" selects;
  - "From" and "To" dates;
  - a "Tag" select;
  - a "Needs sorting" `Chips` toggle;
  - "Clear filters" when any filter is set.

  Filters live in the URL query, so a reload keeps them. With no match: "No transactions match these filters."
- **Selecting many:** a checkbox at the start of each row and a "Select all shown" checkbox in the header. When any is selected, a bar replaces the filter row: "{n} selected", "Change subsection", "Add tag", "Remove tag", "Delete" and "Cancel". Each action opens a small `Dialog`, and "Delete" asks "Delete {n} transactions?". Errors show in the dialog. On a phone, a long press on a row starts selecting.
- **Transaction dialog:**
  - **Split:** a "Split" quiet button under Subsection turns it into part rows (subsection, amount, remove), with "+ Add part" and "Left to split {x}" in `ty-cap` (negative in `negative`). Saving needs it to be 0. "Remove split" goes back to one subsection.
  - **Tags:** a "Tags" field with chips. Typing suggests existing tags; Enter or comma adds one.
  - **Receipts:** a "Receipts" list of files (name, size, open in a new tab, remove) with "Attach receipt" (a file input accepting the four types).
- **Rows:**
  - A split shows "Split · {n} subsections" in place of the subsection.
  - Tags show as small `Pill`s after the payee on desktop. On phones they go in the second line.
  - A receipt shows a paperclip icon with the label "Has receipt".

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests:
- search and each filter, surviving a reload;
- a split of 3 parts and its effect on the Budget page;
- adding and filtering by a tag;
- bulk change of subsection and bulk delete;
- attaching a PNG and opening it;
- the refusal of a wrong file type.

Screenshots light and dark, desktop and phone, of the filter row, the selection bar, and a split in the dialog.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. Every figure in Tally counts a split's parts in their subsections.
3. Bulk actions apply to all or none.
4. Receipts are checked by content, limited in size and count, and only reachable by the people who can see the budget.
5. The backend tests cover every rule in the contract.
