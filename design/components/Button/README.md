# Button

The control for every action. Provide a verb label that says what happens ("Add transaction", "Close month", "Save").

- `ty-btn--primary` (`action` on `on-action`): one per view, for the thing the person most likely came to do.
- `ty-btn--income` (`income` fill, `on-money` text): "Add income", and the button that saves a new income.
- `ty-btn--spend` (`spend` fill, `on-money` text): "Add transaction", and the button that saves a new expense. Where a page has it, it takes the place of the primary button.
- These two are the only coloured buttons. Use them for nothing else.
- Plain `ty-btn`: every other action.
- `ty-btn--quiet`: low-stakes actions inside a row or a dialog footer, such as Cancel.
- `ty-btn--danger`: deleting. Never place it next to Save.
- `ty-btn--icon`: a square button holding one glyph; give it an `aria-label`.
- `ty-btn--sm`: a smaller button for an action inside a table or a section header, such as "Edit" or "Add subsection". Combine it with `ty-btn--quiet`.

Buttons are 40px tall, 44px on phones.
