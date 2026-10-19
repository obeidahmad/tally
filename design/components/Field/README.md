# Field

A labelled input. Provide the label, the control, and a hint or an error.

- The label sits above the input in `ty-label`.
- Inputs and selects are 32px tall (36px in a dialog, 44px on phones), 6px radius, a 1px `line-strong` border on `surface`.
- Amount inputs add `ty-input--amount`: right-aligned, tabular figures, with the pocket's currency code after the input.
- A percentage is the same input with a % sign after it in place of the currency code.
- An error replaces the hint, sits under the field in `negative`, and says what to do ("The cap must be at least the monthly budget"). Add `ty-input--error` to the input.
- Use a native `select` with the same `ty-input` class for a pocket or a subsection.
