# MonthHeader

The top of the Budget page. Provide the month, whether it is open or closed, and the four month figures.

- A single 48px row: previous button, the month name in `text-display`, next button and an Open or Closed Pill on the left; "Add income" (`ty-btn--income`) and "Add transaction" (`ty-btn--spend`) on the right, in that order. "Add income" opens the transaction dialog with Income chosen, "Add transaction" with Expense chosen. Income is the app's word: never "money in".
- While a month that has ended is still open, a notice (`ty-inset`) says "September 2026 has ended. Close it to carry what is left into October." Its small button "Close September" opens the dialog that closes it. Months close one at a time, oldest first. On wide screens (1464px and up) the notice moves into the aside, below the month summary.
- A closed month hides Add income and Add transaction and shows the notice "September 2026 is closed." The last closed month adds a small "Reopen" button to it.
- The four figures, in order: Income, Budgeted, Spent, Left over. Under 1464px they are one card of four compact stats (`ty-stats`: `ty-label` over an 18px `ty-stat__num`) above the table. From 1464px up they are the summary card in the aside: a `ty-sumrow` per figure, label left and amount right, then the "left over" sentence in `ty-cap`.
- On phones the top bar replaces the title row and only has room for "Add" (Add transaction). "Add income" then shows as a full-width button under the figures: the same button with `ty-month__add`, which is hidden on desktop.
