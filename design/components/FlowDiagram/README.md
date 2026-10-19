# FlowDiagram

The Reports Cash flow card: a Sankey of where a month's money went. Hand-built svg, tokens only. Titled "Where {Month}'s money went".

- **Size.** The full card width (the svg scales); height = max(480px, 34px × the number of nodes in the busiest column). Draw the viewBox at that height and let the width scale.
- **Columns.** Sources ("From last month" included) → one "Income" node holding the total → sections and "Left over" → subsections and "Kept".
- **Nodes** (`ty-snode`): solid 10px-wide bars, as tall as their value at one scale for the whole diagram, with an 8px gap. Sources are `ty-snode--src` (teal), Income `ty-snode--income` (`positive`), sections and their subsections `ty-snode--1` to `--8` (the section's colour), "Left over" and "Kept" `ty-snode--rest` (neutral grey).
- **Bands** (`ty-band`): each a filled path with a linear gradient from the source node's colour to the target's (`stop-color` set to the node's colour variable), no stroke, at 30% opacity; hover or focus raises it to 50% and shows a tooltip "{from} → {to}: {amount}". Each band is focusable (`ty-chart-hit`) with that text as its accessible name.
- **Labels** are two lines: the name (13px 500 `ink-muted`, `ty-slabel__name`, emoji first) and "{amount} ({pct}%)" (14px 600 `ink`, `ty-slabel__amt`), where pct is a share of total income. The first two columns put them just right of the node bar, over the band. The other columns put them just left of the bar, right-aligned (`ty-slabel--end`).
- A node shorter than 30px has its label in a `ty-slabel--hover` group, shown on hover or focus of its `ty-sgroup` (focusable, with the full label as its accessible name). Every figure is in the "Show as table" toggle.
- **Phones.** The svg keeps a 720px minimum width and scrolls sideways inside `ty-flowbox`, never the page.
