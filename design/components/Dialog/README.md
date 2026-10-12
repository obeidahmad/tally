# Dialog

A focused task over the page. Provide a title, the form, and one primary action.

- Use it for closing a month, adding a transaction and confirming a delete. It sits on `scrim`, which dims the page behind it.
- Desktop: an opaque `surface` card that fades in over 150ms. No spring.
- Phone: a bottom sheet on `glass-thick` with a grab handle. It follows the finger 1:1 while dragged, can be caught again while it is moving, and on release goes where the flick was heading: down to dismiss, up to stay. This is the only place Tally uses a spring. It leaves by the same path it came in.
- The footer holds Cancel (quiet) and one primary button whose label says what happens.
- A dialog is never taller than the window. Its content scrolls inside it and the footer (`ty-dialog__foot`) stays pinned to its bottom edge, so the primary button is always in view.
- Closing a month lists each section's rest and where it goes. The preferences the person saved fill the fields, and the total must equal the rest before Close is enabled.
