# FlowDiagram

The Reports and Home flow card: a Sankey of where a month's money went, hand-built svg, tokens only.

- A card with a title (`text-heading ty-flowtitle`, a full line on phones) and the month's controls. The svg sits in `ty-flowbox`, which scrolls sideways when the card is narrower than the drawing, so the page never does.
- Columns of nodes from income sources to sections to subsections. Each node is a plain rect: income `ink-muted`, a section in its `sec-1` to `sec-8` colour.
- A flow (`ty-flow`) is filled with the colour of the section it feeds at 40% opacity, 60% on hover or focus. Each flow is a focusable `ty-chart-hit` with an accessible name ("Income to Needs 975.00"), so the picture is never read by colour alone.
- A label sits beside its node: the name in `ty-nodelabel`, then the amount in `ty-nodeamt` (`ink-muted`, tabular). A label over a flow gets a chip behind it (`ty-labelbg`, `surface` at 92%) so it stays readable. The text also has a `surface` halo.
- The Reports charts use the same family of classes (`ty-chart-plot`, `-axis`, `-grid`, `-seg`, `-col`, `-legend`, `-tip` and the rest).
