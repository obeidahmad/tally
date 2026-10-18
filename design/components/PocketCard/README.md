# PocketCard

A pocket: a place where money sits. The Pockets page lists them as rows in one card (`ty-section` holding `ty-prow` rows of 48px). Provide the pocket's name, its emoji, its kind (Bank account, Cash, Fund, Broker), its currency, its balance and where the figure came from.

- The first line is the pocket's emoji (`ty-emoji`), its name and its kind in `ty-cap`. Wherever a pocket's name appears (a row, a chip, a transaction row) its emoji appears with it.
- The balance is right-aligned in the pocket's own currency, with the code after it. When that is not the base currency, the converted value sits under it. A broker or fund also says what was paid, so paid and worth can be compared.
- The second line says whether the balance is synced or entered by hand.
- A row has a second line only when it has a second fact to show; there is no placeholder. The whole row is the tap target and opens the pocket's dialog.
