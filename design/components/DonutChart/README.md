# DonutChart

Spending by section as a ring, with its legend. Used on the Reports Spending tab.

- A 220px ring, 28px thick (`ty-donut`): one circle per segment (`ty-donut__seg`) in the section's colour (set `stroke: var(--sec-N)`), separated by 2px gaps through the dash pattern so the card shows between them. The svg is rotated so the first segment starts at the top.
- The centre (`ty-donut__mid`) shows the total at 22px 600 (`ty-donut__total`) with "Total" under it in `ty-cap`.
- The legend (`ty-dlegend`) is a grid of up to three columns (two on phones): a dot, the name, and "{amount} ({pct}%)" under it at 600. Order is the same as the ring's. The legend carries every figure, so the ring is never read by colour alone.
- Hover or focus on a segment (each has `tabindex="0"` and an `aria-label` with name, amount and share) darkens it and shows a `ty-chart-tip`.
- A ninth section folds into Other in `ink-muted`. "Show as table" is as for every chart.
