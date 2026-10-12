# EmojiPicker

Picks the emoji that marks a pocket. Provide the chosen emoji.

- A grid of 32 emoji, each a radio input with its name as the accessible label ("Bank", "Piggy bank").
- Emoji are drawn in Noto Emoji at weight 700 through `ty-emoji`, so they are single-colour line drawings in `ink`, not the device's colour emoji. Store the plain character with no variation selector.
- A new pocket starts with the emoji for its kind: Bank for a bank account, Banknote for cash, Seedling for a fund, Chart for a broker.
