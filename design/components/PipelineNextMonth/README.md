# PipelineNextMonth

The Pipeline page once months close: a rest rule on every section, a third column for next month, and last month's money arriving. There is no phone layout.

- Three columns that the app arranges itself: income sources, sections, next month. Nobody drags a box.
- An income source is a box with its steps in order, top to bottom. A step takes a percentage of what reaches it or an amount for the month, and sends it to a section. Several rows under one number are a split of the same money. After each step the box says what is left.
- Several sources can feed one box. Its head lists them, each with its amount, over a "Together" total. The steps act on the money of all of them together, so an amount such as 500.00 is taken once. A source feeds exactly one box.
- Money no step takes goes to "Left over".
- A section's box shows what it received, and its rest rule: where the unspent money goes when the month closes. A rest rule is shares, never an amount: all of it, or a split such as 60% and 40%. Selecting a section's Rest rows, by click, Enter or Space, opens RestDialog. "Left over" always goes all to next month's income, so its row cannot be selected.
- A wire is drawn in the colour of the section it feeds. A dotted wire is money moving between months. The row a wire starts from already says where it goes in words, so the picture is never read by colour alone.
- Money from last month arrives as its own income source, "Last month's leftovers", which has steps like any other. Alone in its box, its head stacks the name over "From September" (`ty-node__title`), so its Edit button and amount always fit and a name too long is cut with an ellipsis. Merged into another box, its row shows the name only. Money can also arrive straight into a section as extra, shown in the income column as "Rest of Savings".
- With the third column the diagram is `ty-pipe ty-pipe--next`: from 796px to 996px wide. It sits in `ty-pipe-frame`, which scrolls sideways on its own when the window is too narrow for it, so the page itself never does.
- On a closed month the page shows the figures as they were when it closed, with a Closed Pill after the month, and nothing on it can be selected or added.
