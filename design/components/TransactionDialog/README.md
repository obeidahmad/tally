# TransactionDialog

The dialog for adding or editing a transaction. Provide the type, the pockets and subsections to choose from, and the transaction when editing.

- The title and the primary button say what is being added: "Add expense" or "Add income". When editing, the title is "Edit expense" or "Edit income" and the button is "Save".
- The button that adds takes the colour of its type: `ty-btn--income` for "Add income", `ty-btn--spend` for "Add expense", changing as the Type changes. "Save" stays `ty-btn--primary`.
- Fields in order: Type (Segmented: Expense, Income), Date, Amount, Payee, Subsection (a select, for an expense only), Pocket (Chips), Note.
- "+ Add pocket" opens the new-pocket panel inside the dialog: Pocket name, Emoji, Kind. With no pockets yet the panel is already open. Saving creates the pocket first, then the transaction.
- "Add income" on the Budget page opens this dialog with Income chosen.
