# HomeCards

The Home page's cards: a grid (`ty-home`) of `ty-card ty-stack`, one column on phones and two from 900px. Each card has a `text-heading` title and one idea.

- **This month so far:** spent of budgeted in `num-lg` and `ty-cap`, one meter (the budget's, the only meter on the page besides goals), what is left, then "Over budget" with a negative Pill per subsection, and a link to the budget.
- **Net worth:** the figure and a Pill for the change since last month (`ty-inline` keeps them on one line), then the sparkline, then a quiet "Show as table" button that swaps the chart for a `ty-table`.
- **Sparkline:** a 56px `ty-chart-plot` svg with a 2px `ty-chart-line`, no axes, a dot on the last point, and a tooltip (`ty-chart-tip`) for each point on hover, focus or tap. Each point is a focusable `ty-chart-hit` with an accessible name ("October 2026: 12,211.40").
- **Cash flow, Coming up:** `ty-sumrow` lines, label left and amount right. Coming up lists the next 14 days of bills.
- **Recent transactions:** `ty-rows` (`ty-trow` rows, flush with the card's edges, the second line always shown), then a link.
- **Goals:** per goal a `ty-sumrow` with its name and a status Pill (Reached, On track, Behind, Date passed), an ink meter (`ty-meter--goal`) and "x of y".
- **Age of money:** `num-lg` and a caption.
- A figure that needs attention, such as a goal behind its date, takes `ty-warn` (`warning`, 600).
- A `ty-inset` above the grid says when transactions need sorting.
