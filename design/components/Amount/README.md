# Amount

How money is written. Provide the number, and the currency code when it is not the base currency.

- Two decimals and thousands separators, tabular figures, right-aligned in columns: `1,175.00`.
- No currency symbol. A code follows the number only when the amount is not in the account's base currency: `1,240.00 USD`, with the converted value under it in `ty-cap` (`≈ 1,141.80 EUR`).
- Money out is plain ink with a minus sign. Money in adds a plus sign and `ty-num--pos` (`positive`). Use `ty-num--neg` only for a balance that is below zero.
- A change is a `ty-delta`: "↑ 2,371.40 (24.1%)" in `positive`, `ty-delta--neg` in `negative`, followed by a quiet `span` such as "since September".
- For an investment, show both figures in words: "paid 2,100.00 USD" and "worth 2,310.00 USD".
