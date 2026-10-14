# StepDialog

The dialog for adding or editing a step of a box. Provide the sections to choose from, and the step when editing.

- "Takes" is a Segmented with "Percentage" and "Amount".
- "Percentage" shows one row per section in `ty-shares`: the section (a select), its percentage with a % sign, and a small quiet "Remove" button when there is more than one row. Each row is a destination: a section this step sends money to. Several destinations share the same money.
- "+ Add destination" adds a row, up to 8. It is a small outlined button, never a quiet one: it is the only way to send one step to several sections, so it has to read as a button. It does not create a section; "Add section" on the page does that.
- Under the button: "Each destination takes its percentage from what reaches this step. Together they can be at most 100%."
- "Amount" shows "Section" and "Amount" with the currency code, and the hint "For the whole month, however many payments come in."
- When editing a step of a box with several steps, "Position" (a select) moves it among them.
- The title and the primary button are "Add step", or "Edit step" and "Save". Delete sits apart from Save, as in every dialog.
