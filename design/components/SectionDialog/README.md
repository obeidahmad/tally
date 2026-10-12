# SectionDialog

The dialog for adding or editing a section. Provide the section when editing.

- Fields in order: Name, then Budget (Segmented: "Percentage", "Fixed amount", "Subsections"), then what the chosen one needs.
- "Percentage" shows a "Percentage" field with a % sign after it, and a hint saying what the percentage is taken from: "Of the month's income left after fixed-amount sections." A new section starts on it: a section's budget comes first, its subsections after.
- "Fixed amount" shows "Monthly budget", an amount with the currency code after it.
- "Subsections" is for budgeting from the bottom up. It needs no field and shows one line in its place: "The total of its subsections' budgets."
- The field appears at once when its choice is made, right under the control. Nothing animates.
- The title and the primary button are "Add section", or "Edit section" and "Save". Delete sits apart from Save, as in every dialog.
