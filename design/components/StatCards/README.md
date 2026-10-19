# StatCards

A row of two to four equal white cards, each one headline figure. Used at the top of Budget (Income, Budgeted, Spent, Left over) and of the Reports Cash flow tab (Total income, Total spending, Net, Savings rate).

- `ty-statcards` holds the cards; each `ty-statcard` is a `surface` card with the figure centred (`ty-statcard__num`, 24px/30px, 600, tabular) and its name under it in `ty-label`.
- The figure is `positive` (`ty-statcard__num--pos`) for income, `negative` (`--neg`) for expenses, and `ink` for everything else. The label says what it is, so colour never stands alone.
- Equal columns on desktop; two per row on phones. A figure with no value shows "—".
