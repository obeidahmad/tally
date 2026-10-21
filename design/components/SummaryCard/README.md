# SummaryCard

Where the money is, in shares. One card for Assets and one for Debts, each with its total.

- `ty-summary`: the title in `text-title` with the total on the right (`ty-summary__head`), an 8px stacked bar (`ty-stackbar`) whose segments (`ty-seg--1` to `--8`, flex-grow set to the amount) are the groups' shares in their colours, then a legend (`ty-keys`): a dot, the name, the amount right-aligned.
- The bar has `role="img"` and an `aria-label` that says each share ("Investments 60%, Cash 40%"); the legend carries the amounts, so the colours never stand alone.
- Debts is the same card with a negative total in `ty-num--neg`. A card with nothing in it is left out.
