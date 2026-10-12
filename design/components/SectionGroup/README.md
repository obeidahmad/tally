# SectionGroup

A section with its subsections: the grouped budget table. Provide the section's name, its colour slot, its budget and the rule that sets it, and its rows.

- The header carries the section dot (`sec-1` to `sec-8`, in the order sections were created), the name, the rest so far as a Pill, and the budget rule in words.
- Header totals sit above the same columns as the rows. Budgeted is the section's own budget, Spent the total of its rows, Available the budget minus what was spent.
- The rule reads "Fixed amount" or "50% of income after fixed sections". When each income source has its own rule it names them: "50% of Paycheck, 50% of Leftover".
- Rest is the section's budget minus what its subsections claim. The Pill is neutral ("Rest 75.00"), and `ty-pill--warning` when the subsections claim more than the section has ("Rest −30.00").
- A section whose budget is the sum of its subsections has no rest and no rule: its header shows neither.
- On phones the Budgeted and Spent totals are replaced by one line under the name (`ty-shead__sub`): "990.15 of 1,175.00 spent".
- A tax-style section says "taken first" in its rule.
- A small quiet "Edit" button (`ty-btn--sm`) follows the name and opens the section's dialog.
- The last row of every section is `ty-section__add`, holding a small quiet "Add subsection" button. Selecting a subsection row opens that subsection's dialog.
