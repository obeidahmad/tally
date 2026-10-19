# TransactionList

Transactions grouped by day, in one card. It replaces TransactionRow. Provide the days, newest first, each with its rows.

- **Date header** (`ty-day`, `surface-sunken`, 36px, sticky under the top bar): the date on the left ("Sunday, 18 October") and the day's total on the right, with a plus sign when the day is net income.
- **Row** (`ty-trow`, 44px, `role="button"`, the whole row opens the transaction): the payee at 500 (`ty-trow__who`), the subsection (an emoji and its name), the pocket (an emoji and its name), the amount right-aligned (`ty-num`, income `ty-num--pos` with a "+"), then a chevron the row draws itself. Long names are cut with an ellipsis.
- The subsection and the pocket cells are `ty-tag ty-wide`. They take emoji in `ty-emoji`; a row without one shows only its name.
- A paperclip (`ty-clip`) after the payee marks a receipt, and tags show as `ty-pill`s in `ty-tags`; both are in FilterBar.
- **Phones.** The subsection and pocket move under the payee into `ty-trow__meta` in `ty-cap`, and the row keeps the amount and the chevron.
- A row has a second line only on phones, and only because the two cells moved there.
