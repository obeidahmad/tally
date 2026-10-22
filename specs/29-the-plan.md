# Spec 29: The plan — which pocket each subsection's money belongs in

Follows specs 01 to 28, which stay the reference for everything not changed here. Migration `018_kept_in.sql`.

## Goal

From the user: Tally is not only about saying what happened to the money. It also tells the person what to do with it.
- **The plan:** each subsection's money belongs in a pocket. Savings belongs in the EUR savings account; Rent share and Phone stay in BOC; Groceries goes to Revolut.
- **What to do:** when the salary lands in BOC, Tally works out the transfers that put every pocket at what it should hold, and lists them. For example: "2,063.75 from BOC to Revolut", "50.00 from BOC to EUR savings".
- **Done:** the person makes them at the bank and presses Done, which records the transfer.

Tally thinks about money in a zero-based, envelope way, and the envelopes are the pockets.
- **Every dollar has a job and a place.** Nothing just sits around.
  - Money in a subsection belongs in that subsection's pocket.
  - Money that belongs nowhere yet is next month's money: the left over and the sections' rests. Its job is to be kept for next month, so it has a pocket too.
- **Overspending is real money that left the subsection's pocket.** The person can carry the negative into next month, or take it from the rest when the month closes (spec 09). Either way the plan follows the budget.
- **"Should hold" comes only from the budget.** The person compares it with the bank. If the bank shows less than Tally says, a transaction or a transfer is missing.

This replaces spec 14's "where each subsection's money sits".
- The home pocket becomes the pocket for next month's money.
- There is no Main pocket. "Main" is only a name a person may give a pocket.
- A transfer no longer names a subsection.

## Out of scope

- Bank connections matching the two sides of a transfer (later, after this works).
- Routing transfers through one pocket. Transfers go directly from the pocket with money to spare to the pocket that is short.
- Credit card payments in the plan. Spending on a card shows as money to spare in the subsection's pocket until the card is paid.
- Pocket opening balances entering the budget. For now the plan counts them as next month's money.
- A "Kept in" column on the Budget page.
- Several pockets for one subsection.
- Plans for past months.

## Shared contract

### Kept in

- `subsections.pocket_id INTEGER NULL REFERENCES pockets(id) ON DELETE SET NULL`. Null means "no pocket yet": a new person's subsections exist before their pockets. There is no "Any pocket"; the plan lists the subsections that still need one.
- Every subsection response carries `pocketId: number | null`. `POST` and `PATCH` of a subsection accept `pocketId` (null clears it). It must be one of the person's **plan pockets**, otherwise 400 on `pocketId`, "Choose a pocket.".
- **Plan pockets** are those of kind `bank`, `cash`, `fund` or `broker`. Credit, loan and property pockets are left out of the plan.
- When a pocket's kind changes to one outside the plan, its subsections go back to no pocket. If it was the next-month pocket, that goes back to its default.

### Next month's money

- The person's `home_pocket_id` column is reused as the pocket that keeps next month's money. `User` carries `nextMonthPocketId: number | null`, and `PATCH /api/me` accepts `{ nextMonthPocketId }`.
- It must be one of the person's plan pockets, otherwise 400 on `nextMonthPocketId`, "Choose a pocket.".
- **Null means the default:** the person's oldest plan pocket.
- **Migration:** it clears an existing `home_pocket_id` that points at a pocket outside the plan.

### The plan

`GET /api/plan` → 200:

```json
{ "currency": "EUR",
  "pockets": [ { "id": 1, "shouldMinor": 10000, "holdsMinor": 221375,
                 "subsections": [ { "id": 7, "availableMinor": 6000 }, { "id": 9, "availableMinor": 4000 } ] } ],
  "transfers": [ { "fromPocketId": 1, "toPocketId": 2, "amountMinor": 206375, "toAmountMinor": 206375, "baseAmountMinor": 206375 } ],
  "nextMonth": { "pocketId": 1, "amountMinor": 0 },
  "unplacedSubsectionIds": [],
  "shortMinor": 0 }
```

Rules:

1. **Which months.** Every month that is not closed, from the oldest one through the current calendar month.
   - A closed month has already carried everything into the month after it, so each amount counts once.
   - With nothing closed, it starts at the person's first month.
   - Rates are today's (spec 12). Base-currency figures are in the person's base currency.
2. **A subsection's amount** is the sum of its `availableMinor` (spec 09: budget + carried − spent) over those months, **with its sign**. An overspent subsection lowers what its pocket should hold, because that money really left the pocket.
3. **Next month's money** is everything else in those months: for each month, its income (including the carry into its income) + the carry into its sections and subsections − its spending − the sum of its subsections' `availableMinor`. That is the left over and the sections' rests, overspending included.
   - Add the opening balances of the plan pockets in base. They are money with no job yet (see Out of scope).
4. **What a pocket should hold.** For each plan pocket P: the amounts of the subsections kept in P, plus next month's money when P is the next-month pocket, in base. `shouldMinor` is that converted to P's currency. It can be below 0.
5. **What it holds.** P's cash `balanceMinor` (spec 14) plus what its held holdings cost (`paidMinor`). `holdsMinor` is in P's currency.
   - Buying a holding therefore changes nothing.
   - Price changes are left out.
6. **Spare and short.** In base, P's difference is holds − should. Above 0, P has money to spare; below 0, P is short.
7. **Transfers, direct.** Take the pocket with the most to spare and the pocket that is shortest (ties: the older pocket first). Transfer the smaller of the two amounts between them, then repeat until no pocket is short or nothing is left to spare.
   - `baseAmountMinor` is in base. `amountMinor` is in the From pocket's currency and `toAmountMinor` in the To pocket's, at today's rates.
   - Leave out a transfer under 1.00 in base (100 minor).
8. **Short.** `shortMinor` is what stays short after the transfers, in base, or 0 when under 1.00.
9. **The lists.**
   - `pockets` lists every plan pocket, oldest first, each with its subsections in section and subsection order. Each subsection carries its signed amount.
   - `nextMonth` is `{ pocketId, amountMinor }`, with the amount in base and `pocketId` null when there is no plan pocket.
   - `unplacedSubsectionIds` lists the subsections with no pocket, in section and subsection order. Their money is in no pocket's "should".
   - `transfers` are in the order they were made.
10. **Access.** The same as transactions: the owner, and a person the budget is shared with (spec 20).

Worked example (all EUR):
- **Pockets:** BOC holds 2,213.75, Revolut 0 and EUR savings 0.
- **Kept in:** Rent share 60 and Phone 40 are kept in BOC, Groceries 400 and Car 1,663.75 in Revolut, and Savings 50 in EUR savings.
- **Next month's money:** 0, since the pipeline sent the whole salary to sections and their subsections claim all of it. The next-month pocket is BOC.
- **Result:** BOC should hold 100 and has 2,113.75 to spare. Revolut is short 2,063.75 and EUR savings is short 50.
- **Transfers:** first 2,063.75 from BOC to Revolut, then 50.00 from BOC to EUR savings. `shortMinor` is 0.

### Removed

- **`GET /api/where`** and its table.
- **The transfer's subsection.**
  - A transfer with a `subsectionId` that is not null answers 400 on `subsectionId`: "A transfer has no subsection."
  - The migration sets `subsection_id` to null on every transfer.
- **The home pocket.** `homePocketId` leaves `User` and `PATCH /api/me`; its column becomes the next-month pocket (above). The property pocket's default currency (spec 23) becomes the base currency.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- the worked example;
- a pocket in another currency (should, holds, the transfer's three amounts);
- an overspent subsection lowering its pocket's "should";
- next month's money (left over, a section's rest, an opening balance) in the next-month pocket, the default and a chosen one;
- two open months counted once each, and a closed month counted through its carry only;
- unplaced subsections;
- the `nextMonthPocketId` rules;
- a holding that changes nothing;
- `shortMinor` when there is not enough money;
- transfers under 1.00 left out;
- the tie rule;
- the `pocketId` rules, including a debt pocket refused and a kind change resetting it;
- a transfer's subsection refused;
- the old where route gone;
- isolation, and access by a sharer.

## UI

Owner: `ui-dev`. Paths: `web/**`. Built on spec 27's look. The design system has the new pieces: `TransfersToMake` (new), `PocketsScreen` (its new table), `HomeScreen`, and the classes `ty-moves`, `ty-move`, `ty-plan__pocket`, `ty-plan__sub` and `ty-sr` in `design/components.css`.

- **Subsection dialog:** a "Kept in" select as its last field.
  - The options are a disabled "Choose a pocket" placeholder, shown only while none is chosen, then each plan pocket as its emoji and name.
  - It is required when the person has a plan pocket ("Choose a pocket."). With none it stays empty.
  - Hint: "Tally lists the transfers that keep this money here."
- **"Transfers to make" card** (`TransfersToMake`):
  - **Where:** on Home above the cards grid, full width; and at the top of the Budget page's aside when the current month is shown.
  - **Each row:** "{from emoji} {from} → {to emoji} {to}", then the amount in the From pocket's currency (its code when not the base currency), then a small "Done" button. The button's accessible name is "Done: move {amount} from {from} to {to}".
  - **Short:** when `shortMinor` > 0, under the rows: "Your pockets hold {short} less than your budget plans."
  - **No pocket yet:** when `unplacedSubsectionIds` is not empty, a line "{n} subsections have no pocket yet." ("1 subsection has no pocket yet.") with a quiet link "Choose" to the Budget page.
  - **Hidden** when there are no transfers, nothing is short and every subsection has a pocket.
- **Done** opens the transaction dialog as "Add transfer", with From, To and Amount filled in, and "Amount received" with `toAmountMinor` when the currencies differ, dated today. The person can change anything before saving. After saving, the card reloads.
- **Pockets page:** the table "Where each subsection's money sits" is replaced by "Where your money should be", as `PocketsScreen` shows.
  - **Columns:** "Pocket", "Should hold", "Holds", "Difference".
  - **Pocket rows:** one per plan pocket, with its emoji and name.
  - **Difference:** holds − should, with a "+" when above 0, in `ty-num--neg` when below, and a muted "–" when 0.
  - **Subsection rows:** under each pocket, its subsections with their section dot, name and signed amount under "Should hold" (negative in `ty-num--neg`). Under the next-month pocket, one more row "Next month's money" with its amount.
  - **Codes:** amounts show their code when not in the base currency.
  - **Phones:** the subsection rows are hidden.
  - **No plan pockets:** the table is hidden.
- **Transfer dialog:** "Subsection (optional)" goes. The transfer rows on Transactions no longer show a subsection.
- **Settings:** the "Home pocket" select becomes "Next month's money", listing the plan pockets, with the hint "Left over and sections' rests are kept here until next month." It shows the default pocket when none is chosen.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Remove or rewrite the tests of the where table, the home pocket and a transfer's subsection. Tests:
- **The worked example**, built through the UI:
  - The subsections' "Kept in" is set.
  - The salary is an income into BOC.
  - Home and Budget list the two transfers in that order.
  - The Pockets table shows the figures.
- **Done** on each transfer, saving the filled-in dialog. The card disappears and the Pockets table shows every Difference as "–".
- **A short plan** shows the short line.
- **A transfer between two currencies:** Done fills in Amount received.
- **Kept in:** the select lists only plan pockets, has no "Any pocket", and is required once a plan pocket exists.
- **No pocket yet:** subsections made before any pocket show the "no pocket yet" line.
- **Overspending:** an expense beyond a subsection's available lowers its pocket's Should hold, and the row shows the negative.
- **Next month's money:** income that no step takes shows as "Next month's money" under the next-month pocket. Choosing another pocket in Settings moves it, and a transfer is listed.
- **Removed:**
  - the transfer dialog has no Subsection;
  - Settings has "Next month's money" in place of Home pocket.

Screenshots light and dark, desktop and phone, of Home with the card and the Pockets table.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. The worked example gives exactly the two transfers, 2,063.75 from BOC to Revolut, then 50.00 from BOC to EUR savings.
3. After recording them with Done, nothing is left to transfer.
4. Spending from the pocket a subsection is kept in creates no transfer. Spending from another pocket creates a transfer that covers it.
5. Every dollar has a place: with every transaction recorded, every subsection given a pocket and no opening balances, what the plan pockets should hold adds up to what they hold.
6. The backend tests cover every rule in the contract.

## Decisions after review

- **Position.** "Kept in" sits after the money fields and before "Position" in the subsection dialog. That is accepted as built.
- **Failed plan.** A plan that fails to load (409 `no_rate`) never breaks a page. Pockets shows the server's message in place of the table; Home and Budget leave the card out.
- **Done button size.** "Done" keeps the design system's touch height on phones (44px) and its small height on desktop (28px). It never stretches with the row.
- **Phones.** The plan table fits a 390px screen with no clipped cells.
