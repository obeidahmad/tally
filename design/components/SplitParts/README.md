# SplitParts

The parts of a split transaction, inside the transaction dialog's `ty-fieldset` under the legend "Parts". One amount divided between subsections.

- Each part (`ty-part`) is a subsection select, an amount input (`ty-input--amount`) and a quiet "Remove" button. A split has at least two parts and at most 20; "Remove" is disabled at two.
- The footer (`ty-partfoot`) holds "+ Add part", "Left to split {amount}" and "Remove split". "Left to split" is `ty-cap`; below zero it adds `ty-num--neg`. The parts must add up to the transaction before it can be saved.
- Errors sit under the parts in `ty-error`.
