# ReceiptList

A short list of files or dated entries with a quiet remove button, inside a dialog. Used for a transaction's receipts and for a property's past values.

- `ty-files`: one `li` per entry. The first child takes the free width and is cut with an ellipsis; then a `ty-cap` or `ty-num`; then a quiet "Remove" button with an accessible name that says what it removes.
- A receipt is a link, then its size. "Attach receipt" is a `ty-btn` label (`ty-attach`) wrapping a visually hidden file input. Only images and PDFs are accepted; a refused file shows its error in `ty-error` with `role="alert"`.
- A property's value block is a `ty-inset`: "Current value" and the amount on one line (`ty-value`), a row of Value, Date and "Update value" (`ty-valuerow`, a single column on phones), then the past values as `ty-files` (the date, the amount, Remove).
