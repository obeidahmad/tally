# PocketGroups

The Pockets page's top: net worth with its Assets and Debts, then a card per group of pockets.

- Net worth is the one `num-hero`. When it says something the figure does not (several currencies, a missing exchange rate), a `ty-cap` line under it spells it out; it is left out when it would only repeat the figure.
- Assets and Debts sit under it as two figures (`ty-nw`): a `ty-label` over a `ty-num`. Debts are `ty-num--neg`.
- Each group (Assets, Debts) is one card (`ty-section`). Its header is a `ty-day` row: the group name in `ty-label`, then its total in the base currency. Under it, one `ty-prow` per pocket: see PocketCard.
- A debt's balance is negative and `ty-num--neg`.
