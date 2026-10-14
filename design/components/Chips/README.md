# Chips

One choice from a handful, shown all at once. Provide a group label and the choices.

- Use chips to pick one of the person's own things when there are few and seeing them all helps: the pocket, the income source. For a fixed set of two or three choices use `Segmented`. Use a select when there are many, such as subsections.
- Each chip is a label wrapping a radio input, inside a `ty-fieldset` whose legend is the group label in `ty-label`. The chosen chip fills with `action`.
- A pocket's chip shows its emoji and its name.
- The last pocket chip is "+ Add pocket" (`ty-chip--add`, dashed). Choosing it opens a `ty-inset` panel right under the chips with the new pocket's name, emoji and kind, so a pocket can be created without leaving the dialog.
