# TransfersToMake

What to do with the money: the transfers between pockets that put each pocket at what it should hold. Provide the moves from the plan.

- A `ty-card ty-stack` titled "Transfers to make", then a `ty-moves` list. Each `ty-move` row: the From pocket's emoji and name, a muted arrow (with "to" for screen readers, `ty-sr`), the To pocket's emoji and name, the amount in the From pocket's currency (`ty-num`, its code in `ty-cur` when not the base currency), and a small "Done" button whose accessible name says the whole move.
- "Done" opens the transaction dialog on Transfer with From, To and the amount filled in, dated today; saving it makes the move disappear.
- When the pockets cannot cover the plan, a `ty-warn` line under the list: "Your pockets hold 120.00 less than your budget plans."
- With nothing to move and nothing short, the card is not shown at all.
- It goes above the HomeCards grid on Home (full width), and at the top of the Budget page's aside when the current month is shown.
