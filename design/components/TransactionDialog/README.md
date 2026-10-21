# TransactionDialog

The dialog for adding or editing a transaction. Provide the type, the pockets and subsections to choose from, and the transaction when editing.

- The title and the primary button say what is being added: "Add expense" or "Add income". When editing, the title is "Edit expense" or "Edit income" and the button is "Save".
- The primary button (`ty-btn--primary`) is labelled "Add expense" or "Add income" as the Type changes, and "Save" when editing.
- Fields in order: Type (Segmented: Expense, Income), Date, Amount, then Payee and Subsection (a select) for an expense or Source (Chips) for income, then Pocket (Chips) and Note.
- An income names its source in place of a payee. The last source chip is "+ Add source"; choosing it shows a "Source name" field directly under the chips.
- The last pocket chip is "+ Add pocket"; choosing it shows "Pocket name" and "Kind" directly under the chips. There is no nested panel and no emoji grid: the new pocket gets its kind's default emoji, which the Pockets page can change. Saving creates the pocket first, then the transaction.
- **First run.** With no source yet, Source is a single text field ("Source", placeholder "e.g. Salary") with no chips. With no pocket yet, Pocket is a text field ("Pocket", placeholder "e.g. Current account") followed by Kind, with no chips. A lone "+ Add" chip is never shown.
- A transfer with fewer than two pockets shows "A transfer needs two pockets" with a link "Go to Pockets", in place of its fields.
- "Add income" on the Budget page opens this dialog with Income chosen.
