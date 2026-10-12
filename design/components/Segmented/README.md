# Segmented

One choice from a fixed set of two or three, shown as one row. Provide a group label and the choices.

- Use it where the choice changes the form under it: the transaction type, how a section's budget is set. For the person's own things, such as pockets, use `Chips`. Use a select when there are many choices.
- One track as wide as the form and as tall as an input, with the segments sharing its width equally. It never wraps, so each label is one or two words.
- The track is `surface-sunken`. The chosen segment is `surface` outlined in `ink`, with its label in `ink`; the others are `ink-muted`. It is quieter than a filled button, so the dialog's primary button stays the only filled control.
- Each segment is a label wrapping a radio input, inside a `ty-fieldset` whose legend is the group label in `ty-label`. The arrow keys move between segments.
- A segment can be pressed anywhere in the height of the track, so its target is 44px tall on phones although the outlined shape is smaller.
- The chosen segment changes colour over 150ms. Nothing slides.
