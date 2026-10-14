# PipelineScreen

The Pipeline page on desktop: how this month's income moves into sections. There is no phone layout yet.

- Two columns that the app arranges itself: boxes of income on the left, sections on the right. Nobody drags anything.
- A box holds one income source or several. With several, its head lists each with its amount over a "Together" total, and the steps act on the money of all of them together. A small quiet "Edit" button follows each source's name.
- The steps run top to bottom. A step is one row that takes an amount, or one or more rows that each take a percentage of what reaches the step. A row shows its rule in `ty-step__rule`, then the section with its dot, then the amount taken. After each step a `ty-pipe__left` line says what is left.
- A whole step (`ty-pipe__step`) is selected to open its dialog, the way a budget row is. "Add step" is the box's last row.
- A box with no steps says "No steps yet. All of it is left over."
- A section's box shows its dot, its name, a small quiet "Edit" button and what it has received this month. "Left over" is the last box in the column: income that no step takes. It has a plain dot and no Edit.
- Wires: one from each row to the section it feeds, in that section's colour (`ty-wire--1` to `ty-wire--8`), and a plain one from a box's last "left" line to "Left over" when something is left. A wire is a curve from the right edge of the row to the left edge of the section's head, with a 4px dot (`ty-port`) at each end. The rows already say in words where the money goes, so the wires are hidden from assistive technology and the picture is never read by colour alone.
- The diagram is at most 900px wide. In a narrower window its two columns narrow and the gap between them closes to 72px, so the page fits without sideways scrolling from 1024px wide. The wire layer (`ty-pipe__wires`) always covers the whole diagram.
- The preview positions its wires for the default text size and the full width. The app measures its rows.
