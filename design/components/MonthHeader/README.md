# MonthHeader

The top of the Budget page. Provide the month, whether it is open or closed, and the four month figures.

- The month name is the page title in `text-display`, between previous and next buttons.
- An Open or Closed Pill follows the title. A closed month hides Add income and Add transaction and shows "Reopen" in place of "Close month".
- Stats in order: Income, Budgeted, Spent so far, Rest so far. Budgeted is the total of the sections' budgets. Rest so far is the part of it no subsection has claimed.
- "Add income" (`ty-btn--income`) and "Add transaction" (`ty-btn--spend`) end the title row, in that order. "Add income" opens the transaction dialog with Income chosen, "Add transaction" with Expense chosen. Income is the app's word: never "money in".
- On phones the top bar replaces the title row and only has room for "Add" (Add transaction). "Add income" then shows as a full-width button under the figures: the same button with `ty-month__add`, which is hidden on desktop.
