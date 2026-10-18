# TransactionRow

One transaction in a day-grouped list. Provide the payee, where the record came from, the subsection, the pocket and the amount.

- The second line says the source: "From your bank" or "Entered by hand". A transfer between currencies states both amounts and the rate.
- The subsection shows its section's dot. Income shows a grey dot and the income source.
- A transaction from a bank keeps its pocket; its subsection can be changed. One entered by hand can change both.
- The pocket column shows the pocket's emoji before its name.
- The list is one card (`ty-section`). Date rows (`ty-day`) are 32px, sticky, in `ty-label` ("FRI 16 OCT"). A transaction row is 44px: the payee in 500 weight, the subsection with its dot, the pocket with its emoji, the amount right-aligned.
- A row has a second line only when it has a second fact to show. On phones the subsection and pocket go under the payee in `ty-cap`.
