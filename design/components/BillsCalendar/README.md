# BillsCalendar

The Recurring page's month calendar of bills.

- A card (`ty-card ty-stack`) with the title "Bills calendar" and previous and next month buttons on one line. Under it, `ty-cal`: seven equal columns Monday to Sunday, a `ty-label` head (`ty-cal__head`) for each, empty cells to start the month on its weekday, then a `ty-cal__day` per day.
- A day is a `surface-sunken` cell with its number in `ty-cap` and a list (`ty-cal__items`) of chips. Today has a 2px `ink` ring (`ty-cal__day--today`) and `aria-current="date"`.
- A chip (`ty-cal__chip`) is a white cell with the payee (cut with an ellipsis, the subsection's emoji before it) over the amount. A bill that is already paid (`ty-cal__chip--paid`) is muted with an outline, a "✓" before the payee and "Paid" after the amount: never colour alone.
- **Phones:** no grid. Only the days that have bills are listed, each a `ty-cal__day` with its date in `ty-label` ("FRI 16 OCT") over its chips, which get larger text and a 44px-ish touch size.
- **Price-rise banner:** when a bill's price went up, a `ty-inset` with `role="status"` under the lists says "{payee} went up from {x} to {y} on {date}."
