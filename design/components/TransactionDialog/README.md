# TransactionDialog

The dialog for adding or editing a transaction. Provide the type, the pockets and subsections to choose from, and the transaction when editing.

- The title and the primary button say what is being added: "Add expense" or "Add income". When editing, the title is "Edit expense" or "Edit income" and the button is "Save".
- The primary button (`ty-btn--primary`) is labelled "Add expense" or "Add income" as the Type changes, and "Save" when editing.
- Fields in order: Type (Segmented: Expense, Income, Transfer), Date, Amount, then Payee, Subsection (a select) and "Paid from" (the pocket, Chips) for an expense, or "Received from" (the source, Chips) and "Paid into" (the pocket, Chips) for income, then Note and Tags.
- An income is two separate facts: the source it came from (the budget side, which feeds the Pipeline) and the pocket it landed in (the balance side). The labels say so; a source has no pocket of its own.
- An income names its source in place of a payee. The last "Received from" chip is "+ Add source"; choosing it shows a "Source name" field directly under the chips.
- The last pocket chip is "+ Add pocket"; choosing it shows "Pocket name" and "Kind" on one row (`ty-pair`: the name takes the free width, Kind 11rem; stacked under 30rem) directly under the chips. There is no nested panel and no emoji grid: the new pocket gets its kind's default emoji, which the Pockets page can change. Saving creates the pocket first, then the transaction.
- **First run.** With no source yet, "Received from" is a single text field (placeholder "e.g. Salary") with no chips. With no pocket yet, "Paid into" (or "Paid from" for an expense) is a text field (placeholder "e.g. Current account") with Kind beside it in a `ty-pair` row, with no chips. A lone "+ Add" chip is never shown.
- A transfer with fewer than two pockets shows "A transfer needs two pockets" with a link "Go to Pockets", in place of its fields.
- "Add income" on the Budget page opens this dialog with Income chosen.
