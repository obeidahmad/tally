# MonthHeader

The top of the Budget page. Provide the month, whether it is open or closed, and the four month figures.

- The month name is the page title in `text-display`, between previous and next buttons.
- An Open or Closed Pill follows the title.
- While a month that has ended is still open, every month shows a notice (`ty-inset`) under the title row, on desktop and on phones: "September 2026 has ended. Close it to carry what is left into October." Its small button "Close September" opens the dialog that closes it. Months close one at a time, oldest first.
- A closed month hides Add income and Add transaction and shows the notice "September 2026 is closed." The last closed month adds a small "Reopen" button to it.
- Stats in order: Income, Budgeted, Spent so far, Left over. Budgeted is what the pipeline has sent to sections. Left over is income that no step has taken.
- "Add income" (`ty-btn--income`) and "Add transaction" (`ty-btn--spend`) end the title row, in that order. "Add income" opens the transaction dialog with Income chosen, "Add transaction" with Expense chosen. Income is the app's word: never "money in".
- On phones the top bar replaces the title row and only has room for "Add" (Add transaction). "Add income" then shows as a full-width button under the figures: the same button with `ty-month__add`, which is hidden on desktop.
