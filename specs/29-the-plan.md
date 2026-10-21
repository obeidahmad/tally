# Spec 29: The plan — which pocket each subsection's money belongs in

Follows specs 01 to 28, which stay the reference for everything not changed here. Migration `018_kept_in.sql`.

## Goal

From the user: Tally is not only about saying what happened to the money. It also tells the person what to do with it.
- **The plan:** each subsection's money belongs in a pocket. Savings belongs in the EUR savings account; Rent share and Phone stay in BOC; Groceries goes to Revolut.
- **What to do:** when the salary lands in BOC, Tally works out the transfers that put every pocket at what it should hold, and lists them. For example: "2,063.75 from BOC to Revolut", "50.00 from BOC to EUR savings".
- **Done:** the person makes them at the bank and presses Done, which records the transfer.

This replaces spec 14's "where each subsection's money sits" and the home pocket.
- There is no Main pocket. "Main" is only a name a person may give a pocket.
- A transfer no longer names a subsection.

## Out of scope

- Bank connections matching the two sides of a transfer (later, after this works).
- Routing transfers through one pocket. Transfers go directly from the pocket with money to spare to the pocket that is short.
- Credit card payments in the plan.
- A "Kept in" column on the Budget page.
- Several pockets for one subsection.
- Plans for past months.

## Shared contract

### Kept in

- `subsections.pocket_id INTEGER NULL REFERENCES pockets(id) ON DELETE SET NULL`. Null means "Any pocket": Tally does not plan where that money goes.
- Every subsection response carries `pocketId: number | null`. `POST` and `PATCH` of a subsection accept `pocketId` (null clears it). It must be one of the person's **plan pockets**, otherwise 400 on `pocketId`, "Choose a pocket.".
- **Plan pockets** are those of kind `bank`, `cash`, `fund` or `broker`. Credit, loan and property pockets are left out of the plan.
- When a pocket's kind changes to one outside the plan, its subsections go back to Any pocket.

### The plan

`GET /api/plan` → 200:

```json
{ "currency": "EUR",
  "pockets": [ { "id": 1, "shouldMinor": 10000, "holdsMinor": 221375,
                 "subsections": [ { "id": 7, "availableMinor": 6000 }, { "id": 9, "availableMinor": 4000 } ] } ],
  "transfers": [ { "fromPocketId": 1, "toPocketId": 2, "amountMinor": 206375, "toAmountMinor": 206375, "baseAmountMinor": 206375 } ],
  "shortMinor": 0 }
```

Rules:

1. **Today's figures.**
   - It uses the current calendar month.
   - A subsection's amount is its `availableMinor` in that month (spec 13, carry included), counted as 0 when below 0.
   - Rates are today's (spec 12).
   - Base-currency figures are in the person's base currency.
2. **What a pocket should hold.** For each plan pocket P: the sum of the amounts of the subsections kept in P, in base. `shouldMinor` is that converted to P's currency.
3. **What it holds.** P's cash `balanceMinor` (spec 14) plus what its held holdings cost (`paidMinor`). `holdsMinor` is in P's currency.
   - Buying a holding therefore changes nothing.
   - Price changes are left out.
4. **Spare and short.** In base, P's difference is holds − should. Above 0, P has money to spare; below 0, P is short. Money in a pocket that no subsection is kept in, and money of Any-pocket subsections, is spare like any other.
5. **Transfers, direct.** Take the pocket with the most to spare and the pocket that is shortest (ties: the older pocket first). Transfer the smaller of the two amounts between them, then repeat until no pocket is short or nothing is left to spare.
   - `baseAmountMinor` is in base. `amountMinor` is in the From pocket's currency and `toAmountMinor` in the To pocket's, at today's rates.
   - Leave out a transfer under 1.00 in base (100 minor).
6. **Short.** `shortMinor` is what stays short after the transfers, in base, or 0 when under 1.00.
7. **The lists.**
   - `pockets` lists every plan pocket, oldest first, each with its subsections in section and subsection order.
   - `transfers` are in the order they were made.
8. **Access.** The same as transactions: the owner, and a person the budget is shared with (spec 20).

Worked example (all EUR):
- **Pockets:** BOC holds 2,213.75, Revolut 0 and EUR savings 0.
- **Kept in:** Rent share 60 and Phone 40 are kept in BOC, Groceries 400 and Car 1,663.75 in Revolut, and Savings 50 in EUR savings.
- **Result:** BOC should hold 100 and has 2,113.75 to spare. Revolut is short 2,063.75 and EUR savings is short 50.
- **Transfers:** first 2,063.75 from BOC to Revolut, then 50.00 from BOC to EUR savings. `shortMinor` is 0.

### Removed

- **`GET /api/where`** and its table.
- **The transfer's subsection.**
  - A transfer with a `subsectionId` that is not null answers 400 on `subsectionId`: "A transfer has no subsection."
  - The migration sets `subsection_id` to null on every transfer.
- **The home pocket.**
  - `homePocketId` leaves `User` and `PATCH /api/me`. A `homePocketId` sent there is ignored, like any unknown field today.
  - The column stays, unused.
  - The property pocket's default currency (spec 23) becomes the base currency.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- the worked example;
- a pocket in another currency (should, holds, the transfer's three amounts);
- an overspent subsection counting as 0;
- a holding that changes nothing;
- unplanned money used to cover a short pocket;
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
  - The options are "Any pocket", then each plan pocket as its emoji and name.
  - Hint: "Tally lists the transfers that keep this money here."
- **"Transfers to make" card** (`TransfersToMake`):
  - **Where:** on Home above the cards grid, full width; and at the top of the Budget page's aside when the current month is shown.
  - **Each row:** "{from emoji} {from} → {to emoji} {to}", then the amount in the From pocket's currency (its code when not the base currency), then a small "Done" button. The button's accessible name is "Done: move {amount} from {from} to {to}".
  - **Short:** when `shortMinor` > 0, under the rows: "Your pockets hold {short} less than your budget plans."
  - **Hidden** when there are no transfers and nothing is short.
- **Done** opens the transaction dialog as "Add transfer", with From, To and Amount filled in, and "Amount received" with `toAmountMinor` when the currencies differ, dated today. The person can change anything before saving. After saving, the card reloads.
- **Pockets page:** the table "Where each subsection's money sits" is replaced by "Where your money should be", as `PocketsScreen` shows.
  - **Columns:** "Pocket", "Should hold", "Holds", "Difference".
  - **Pocket rows:** one per plan pocket, with its emoji and name.
  - **Difference:** holds − should, with a "+" when above 0, in `ty-num--neg` when below, and a muted "–" when 0.
  - **Subsection rows:** under each pocket, its subsections with their section dot, name and amount under "Should hold".
  - **Codes:** amounts show their code when not in the base currency.
  - **Phones:** the subsection rows are hidden.
  - **No plan pockets:** the table is hidden.
- **Transfer dialog:** "Subsection (optional)" goes. The transfer rows on Transactions no longer show a subsection.
- **Settings:** the "Home pocket" select goes.

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
- **Kept in:** the select lists only plan pockets.
- **Removed:**
  - the transfer dialog has no Subsection;
  - Settings has no Home pocket.

Screenshots light and dark, desktop and phone, of Home with the card and the Pockets table.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. The worked example gives exactly the two transfers, 2,063.75 from BOC to Revolut, then 50.00 from BOC to EUR savings.
3. After recording them with Done, nothing is left to transfer.
4. Spending from the pocket a subsection is kept in creates no transfer. Spending from another pocket creates a transfer that covers it.
5. The backend tests cover every rule in the contract.
