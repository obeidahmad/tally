# Pill

A short state label, fully round. Provide the text and one state.

- `ty-pill--positive`: money still available. `positive` text on a 12% `positive` tint. Shows the plain amount.
- `ty-pill--warning`: less than 10% left. The text ends in "left". Also a section's rest below zero: "Rest −30.00".
- `ty-pill--negative`: overspent. `negative` text on a 12% `negative` tint. The amount carries a minus sign and the word "over".
- No modifier: neutral grey (`surface-sunken`) for zero and for facts such as a currency code, "Rest 75.00" or a goal's progress.

The colour never stands alone: the sign or the word says the same thing. Tag pills (`ty-pill` in `ty-tags`) are the same shape in neutral grey.
