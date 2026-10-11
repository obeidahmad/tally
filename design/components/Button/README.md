# Button

The control for every action. Provide a verb label that says what happens ("Add transaction", "Close month", "Save").

- `ty-btn--primary` (`action` on `on-action`): one per view, for the thing the person most likely came to do.
- Plain `ty-btn`: every other action.
- `ty-btn--quiet`: low-stakes actions inside a row or a dialog footer, such as Cancel.
- `ty-btn--danger`: deleting. Never place it next to Save.
- `ty-btn--icon`: a square button holding one glyph; give it an `aria-label`.

Buttons are 40px tall, 44px on phones.
