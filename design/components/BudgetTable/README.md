# BudgetTable

The Budget page's table: one card holding every section, with a column for every figure. Provide each section (name, colour slot, rows) and, for each row, the figures below.

- **Column header** (`ty-btable__head`): one `surface-sunken` row at the top of the card, in `ty-label`, sticky under the 56px top bar (under the phone top bar on phones). The labels never wrap. Columns: Subsection, Rule, Carried (`title` "From last month"), Moved, Budgeted, Spent, Available.
- **Rule** is `ink-muted`: "44.45%" or "Fixed" for a spending subsection, "Goal 15,000.00 · 42%" for a savings goal. The longer rule ("rolls over up to 100.00", "does not roll over", "fills to 15,000.00") is the cell's `title`.
- **Carried** is the carried amount, negative for a debt, "—" when 0. **Moved** is shown only when the month has a move (add `ty-btable--moved` to the table), "—" when 0.
- **Available** is Budgeted + from last month + moved − spent, as a tinted Pill showing the amount only, with the accessible name and `title` "{amount} left" or "{amount} over": `positive` text on a 12% `positive` tint, warning when more than 90% is used, neutral grey at 0, `negative` on a 12% `negative` tint when over. For a savings goal it is the saved amount.
- **A section row** (`ty-btable__sec`, `surface-sunken`, 600) starts with a disclosure chevron button (`ty-chev`, `aria-expanded`, labelled "Needs subsections") that collapses the section, then the 10px section dot, the name in `text-heading` and two 28px icon buttons (`ty-btn--sm ty-btn--icon`, 44px hit area): a pencil "Edit {section}" and a plus "Add subsection to {section}". Its totals sit in each figure column.
- **Section totals.** In a section row, Budgeted is what the section received this month (not the sum of its rows), Spent is the sum of its subsections' Spent, and Available is the section's own figure from the API. Carried and Moved are sums of the rows. On phones the section row drops its Spent total.
- **A savings goal with a date** has its Rule as "{target} by {Mon YYYY}"; without a date it reads "Goal 15,000.00 · 42%". A goal that is behind its date shows its Budgeted figure in `ty-warn`, with a `title` that says what it needs a month. A reached or passed goal shows a "Reached" or "Date passed" Pill in Available.
- **Emojis.** A subsection that has an emoji shows it (`ty-emoji`, `aria-hidden`) before its name.
- **Rest row**: the last row of each section, "Rest". The Rule column says where the rest goes, the Available column holds the rest as a Pill.
- A row is 40px tall (44px on phones and on coarse pointers). Rows that open a dialog are `role="button"` and darken on hover and press. No meter, no empty line.
- **Narrow tables.** Under 640px wide (a container query) only Subsection, Spent and Available remain: add `ty-x` to every cell that hides, and `ty-m` to the Moved cell.
