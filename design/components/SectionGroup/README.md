# SectionGroup

A section with its subsections: the grouped budget table. Provide the section's name, its colour slot, what it received this month, and its rows.

- The header carries the section dot (`sec-1` to `sec-8`, in the order sections were created), the name and the rest so far as a Pill.
- Header totals sit above the same columns as the rows. Budgeted is what the pipeline has sent the section this month, Spent the total of its rows, Available the difference.
- Rest is that money minus what the subsections claim. The Pill is neutral ("Rest 75.00"), and `ty-pill--warning` when the subsections claim more than the section has ("Rest −30.00"). Every section shows it.
- On phones the Budgeted and Spent totals are replaced by one line under the name (`ty-shead__sub`): "990.15 of 1,175.00 spent".
- A small quiet "Edit" button (`ty-btn--sm`) follows the name and opens the section's dialog.
- The last row of every section is `ty-section__add`, holding a small quiet "Add subsection" button. Selecting a subsection row opens that subsection's dialog.
