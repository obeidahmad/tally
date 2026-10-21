# AreaChart

Net worth over time: a line with a soft fill. Hand-built svg, tokens only. Used on Pockets and on the Reports Net worth tab.

- **Header**: the figure at hero size (`num-hero`), then "↑ {change} ({pct}) since {month}" as a `ty-delta` (`ty-delta--neg` for a loss), and the range control (Segmented: 3M, 6M, 12M, 24M) at the right.
- **Plot**: a 2px line in teal (`ty-area-line`, `sec-7`), and under it a path filled with a vertical gradient from 25% to 0% of the same teal (`ty-area-stop`). The grid (`ty-chart-grid`) is a 1px `line`, recessive; axis labels (`ty-chart-axis`) are 11px `ink-muted`, tabular, with "9K" style ticks.
- **Hover**: a dashed crosshair (`ty-area-cross`), a dot on the line (`ty-area-dot`) and a tooltip (`ty-chart-tip`) with the date and the figure. Every point is a focusable, transparent hit target (`ty-chart-hit`) with an accessible name ("Sunday, 18 October: 11,150.00"); focus shows the same tooltip.
- A quiet "Show as table" button swaps the chart for a `ty-table`.
- The preview shows the tooltip at rest; the app shows it on hover or focus only.
