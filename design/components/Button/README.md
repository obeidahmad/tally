# Button

The control for every action. Provide a verb label that says what happens ("Add transaction", "Close month", "Save").

- Plain `ty-btn` is an outline button: `surface` fill, 1px `line-strong` border, 6px radius, 32px tall, label at 500. Every action is one, including "Add income".
- `ty-btn--primary` (`primary` fill, white text at 600): at most one per view, for the thing the person most likely came to do ("Add transaction", "Add pocket"). A page has no other filled button.
- `ty-btn--quiet`: low-stakes actions inside a row or a dialog footer, such as Cancel.
- `ty-btn--danger`: deleting. Never place it next to Save.
- `ty-btn--icon`: a square button holding one glyph or an 18px `ty-icon`; give it an `aria-label`.
- `ty-btn--sm`: 28px, for an action inside a table or a section header, such as "Edit" or "Add subsection". Combine it with `ty-btn--quiet`.

Buttons are 32px tall in the top bar and the filter row, 36px inside a dialog (`ty-dialog` sets it) and 44px on phones and coarse pointers. No button is pill-shaped.
