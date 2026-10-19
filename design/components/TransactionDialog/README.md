# TransactionDialog

The dialog for adding or editing a transaction. Provide the type, the pockets and subsections to choose from, and the transaction when editing.

- The title and the primary button say what is being added: "Add expense" or "Add income". When editing, the title is "Edit expense" or "Edit income" and the button is "Save".
- The primary button (`ty-btn--primary`) is labelled "Add expense" or "Add income" as the Type changes, and "Save" when editing.
- Fields in order: Type (Segmented: Expense, Income), Date, Amount, then Payee and Subsection (a select) for an expense or Source (Chips) for income, then Pocket (Chips) and Note.
- An income names its source in place of a payee. The last source chip is "+ Add source", which opens a panel for the new source's name, the way "+ Add pocket" does.
- "+ Add pocket" opens the new-pocket panel inside the dialog: Pocket name, Emoji, Kind. With no pockets yet the panel is already open. Saving creates the pocket first, then the transaction.
- "Add income" on the Budget page opens this dialog with Income chosen.
