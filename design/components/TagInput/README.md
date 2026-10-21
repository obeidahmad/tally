# TagInput

Tags on a transaction: free words, a few per transaction.

- The tags already on it show first as pills (`ty-pill ty-tagpill` in `ty-taglist`), each with a "×" button named "Remove tag {name}".
- Under them a `ty-input`. Enter adds what is typed. Suggestions from tags already used show under the input as `ty-chip`s in `ty-chips`; choosing one adds it.
- An error replaces the hint, in `ty-error`.
- On a transaction row, tags are plain `ty-pill`s in `ty-tags`.
