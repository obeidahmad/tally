# FilterBar

The Transactions page's filter row, its selection bar and its selectable rows.

- **Filter row** (`ty-filters`): one compact row of 36px controls with no visible labels. Each is a bare `ty-input` with an accessible name (`aria-label`): Month, Search, Subsection, Pocket, Type, Tag. The search field (`ty-filters__search`) takes the free width. On phones search takes a whole line and the rest share two to a line.
- **Chips** (`ty-filters__chip`): "Needs sorting (3)" is a `ty-chip` with a checkbox; its count is in the label and is left out at 0. Chosen, it shows only imported transactions without a subsection or source. "Dates" is a second chip; when on, From and To (`ty-filters__dates`, date inputs) appear in the same row. It is on by itself when either date is set.
- **"Clear filters"**: a quiet button at the end of the row, shown when any filter is set.
- **Selection bar** (`ty-selbar`, `role="toolbar"`): a card that replaces the filter row while rows are selected. "{n} selected" on the left, then the actions: Change subsection, Add tag, Remove tag, Delete (`ty-btn--danger`), Cancel (quiet). They are disabled when nothing is selected.
- **Selectable row** (`ty-sel`): a checkbox (`ty-sel__box`) before a `ty-trow`. The header row (`ty-sel--head`, on `surface-sunken`) selects every shown row. On phones the checkboxes and the header appear only once a long press has started selecting (add `ty-sel--on` to the list's card). The row cancels the touch menu so the long press selects.
- A row shows a paperclip (`ty-clip`, with an accessible name) after the payee when it has a receipt, and its tags as `ty-pill`s in `ty-tags` (on phones, after the pocket in the second line).
