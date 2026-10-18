# FilterBar

The Transactions page's filter row, its selection bar and its selectable rows.

- **Filter row** (`ty-filters`): fields in a wrapping row, each a `ty-field` that grows from 9rem to 14rem. The search field grows more. On phones the fields share two to a line and search takes a whole line.
- **"Needs sorting" chip** (`ty-filters__chip`): a `ty-chip` with a checkbox, always last before "Clear filters". Its count is in the label ("Needs sorting (3)"). Chosen, it shows only imported transactions without a subsection or source.
- **Selection bar** (`ty-selbar`, `role="toolbar"`): a card that replaces the filter row while rows are selected. "{n} selected" on the left, then the actions: Change subsection, Add tag, Remove tag, Delete (`ty-btn--danger`), Cancel (quiet). They are disabled when nothing is selected.
- **Selectable row** (`ty-sel`): a checkbox (`ty-sel__box`) before a `ty-trow`. The header row (`ty-sel--head`, on `surface-sunken`) selects every shown row. On phones the checkboxes and the header appear only once a long press has started selecting (add `ty-sel--on` to the list's card). The row cancels the touch menu so the long press selects.
- A row shows a paperclip (`ty-clip`, with an accessible name) after the payee when it has a receipt, and its tags as `ty-pill`s in `ty-tags` (on phones, after the pocket in the second line).
