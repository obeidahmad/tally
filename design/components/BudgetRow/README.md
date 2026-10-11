# BudgetRow

One subsection inside a section. Provide its name, its budget, what was spent, and its rollover rule if it has one.

- Columns: Budgeted, Spent, Available. Available is a Pill whose state comes from the numbers.
- The meter under the name shows spent against budget. It turns `warning` above 90% and `negative` when over.
- A note after the name states the rule in words: "rolls over up to 100.00", "60% of what is left".
- A savings goal is the same row with columns This month, Saved, Target. Its meter is ink and shows saved against the cap.
- On phones the Budgeted and Spent columns are replaced by one line under the meter.
