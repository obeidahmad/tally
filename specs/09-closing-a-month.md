# Spec 09: Closing a month

Follows specs 01 to 08, which stay the reference for everything not changed here.

## Goal

A month's money does not vanish when the month ends. Closing a month carries what is left into the next one. The rules, as the user set them:

- **A subsection keeps what it did not spend.** It arrives in the same subsection next month. (Caps on this come later.)
- **A section's rest** is "everything received but did not distribute as budget, or got spent by a subsection as extra": what the section received, less what its subsections claim as budget, less what they overspent.
- **A rest rule** says where a section's rest goes: shares of it, to next month's income or straight into a section next month, the same one included. A new section sends all of it to next month's income.
- **Overspending is a negative rest.** In the user's words, "the user can choose to keep it in the same section for next month (so the money that the section receives would be used to balance it out), or it's delegated to next month income, and it gets merged with other incomes to balance out".
- **Left over** always goes to next month's income.
- **Next month's income** arrives as its own source, "Last month's leftovers", which has a box and steps like any source and can be merged with other sources.
- **Closing** is a button on the Budget page, the first page. From the first day of the next month a notice reminds the person to close the month that ended. The dialog shows where each amount will go and asks for confirmation. A closed month cannot be edited. It can be reopened while the month after it is still open.

## Out of scope

- Rollover caps, savings goals, and moving money between subsections or sections. A subsection keeps everything it did not spend.
- Changing any amount while closing. The dialog only confirms; the rest rules decide.
- Closing the current month early, closing several months at once, and reopening any month but the last closed one.
- Showing the "When overspent" choice on the Pipeline diagram. It is in the rest dialog only.
- The left-over line under the month figures when the left over is below zero. The figure itself shows it.
- Reminders outside the app (email, push).
- Percentages and an order for subsections, what is left of one box flowing into another, and a phone layout for the Pipeline page.

## Shared contract

### Words

- "Month M" is the month being closed, "M+1" the month after it.
- A month written in full is "September 2026"; its name alone is "September". The apostrophe in "Last month's leftovers" and "October's income" is U+0027.
- "Percent text" is written as spec 04 defines it: `6000` is `60`, `250` is `2.5`.

### Which months are closed

- `lastClosed` is the latest month the person has closed, or `null`. Every month up to and including it is closed, including months before the first one ever closed.
- `toClose` is the month after `lastClosed`, or, when nothing is closed, the month of the person's earliest transaction (income or expense). It is `null` when there is no transaction, or when that month has not ended yet by the server's local date (it is the current month).
- Only `toClose` can be closed, and only `lastClosed` can be reopened.
- No transaction dated in a closed month can be created, changed or deleted, and no transaction can be moved into one.

### Money in a month

This replaces "How a month's money flows" in spec 06 and the section figures of spec 04 where they differ.

**Carries** are what closing the month before put into this month. Each goes into a subsection (never below zero), into a section (may be below zero), or into this month's income (may be below zero).

1. A box's pool is the month's income from its sources, plus, for the box that holds "Last month's leftovers", the carry into this month's income.
2. The steps run as in spec 06, except that when what reaches a step is zero or below, the step takes nothing. A box's left over may be below zero.
3. A section's `receivedMinor` is what its steps sent it plus the carry into it.
4. A subsection has its `budgetMinor` plus its `carriedMinor`, the carry into it. Its `availableMinor` is budget + carried − spent.
5. A subsection's overspending is spent − (budget + carried) when that is above zero, otherwise 0.
6. A section's `restMinor` is received − the sum of its subsections' `budgetMinor` − the sum of their overspending. It may be below zero.
7. A section's `availableMinor` is received + the sum of its subsections' `carriedMinor` − its spending.

The month's income plus last month's leftovers plus the carries into sections equals the sections' received money plus the left over.

### Closing month M

All of this happens in one database transaction, so a failure leaves nothing half closed.

1. **Subsections.** Each subsection's budget + carried − spent, when above zero, goes into the same subsection in M+1.
2. **A rest above zero** is split by the section's rest rule. Each share is rest × `basisPoints` ÷ 10000, rounded down to the cent, and the cents left go to the rule's first share. A share goes into its section in M+1, or into M+1's income when its `sectionId` is `null`.
3. **A rest below zero** goes all into the same section in M+1 when the rule's `overspent` is `section`, or all into M+1's income when it is `income`.
4. **The left over** of the month, whatever its sign, goes into M+1's income.
5. **Stored:** the carries into M+1, summed per subsection, per section and for the income; and what `GET /api/budget` and `GET /api/pipeline` answer for M at that moment, with `closed: true`. From then on those two routes answer exactly that for M, whatever changes later.
6. The first close creates the source "Last month's leftovers" in a box of its own, with `isLeftovers: true`. There is never more than one per person.

What M carries into M+1 adds up to M's income, plus last month's leftovers, plus what was carried into M's sections and subsections, minus M's spending.

**Reopening M** deletes M's stored carries and figures. M is worked out live again, and M+1 no longer receives anything from it.

### Worked example

The tests use the month before the current one as September 2026 and the current month as October 2026.

**Set up:** sections Needs, Wants and Savings, created in that order. Subsections: Rent (800.00) and Food (149.99) in Needs, Eating out (550.00) in Wants, none in Savings. Sources Paycheck and Fund payout, each in a box of its own. Paycheck's box has one step: 50% Needs, 30% Wants, 20% Savings. Fund payout has no steps. Rest rules: Needs 60% to Savings and 40% to next month's income; Wants keeps the default; Savings all to Savings.

**September:** income Paycheck 2,000.00 and Fund payout 12.40; expenses Rent 800.00, Food 100.00, Eating out 700.00.

| Section | Received | Claimed | Overspent | Rest |
|---|---|---|---|---|
| Needs | 1,000.00 | 949.99 | 0.00 | 50.01 |
| Wants | 600.00 | 550.00 | 150.00 | −100.00 |
| Savings | 400.00 | 0.00 | 0.00 | 400.00 |

Left over: 12.40. What closing September shows, in this order:

| Row | `fromSectionId` | `basisPoints` | `toSectionId` | `amountMinor` |
|---|---|---|---|---|
| Rest of Needs, 60% to Savings | Needs | 6000 | Savings | 3001 |
| Rest of Needs, 40% to October's income | Needs | 4000 | `null` | 2000 |
| Overspent in Wants, taken from October's income | Wants | 10000 | `null` | −10000 |
| Rest of Savings to Savings | Savings | 10000 | Savings | 40000 |
| Left over to October's income | `null` | 10000 | `null` | 1240 |

`keptMinor` 4999 (Food keeps 49.99; Rent and Eating out keep nothing). `incomeMinor` −6760. Carried in total: 4999 + 3001 + 40000 − 6760 = 41240, which is 201240 income − 160000 spent.

**October after closing, before any October transaction:** Food has `carriedMinor` 4999 and `availableMinor` 19998. Savings has `receivedMinor` 43001 and `carriedMinor` 43001. "Last month's leftovers" is in a box of its own with `incomeMinor` −6760, and that box's left over is −6760, as is the month's. The month header's Income is −67.60.

**Then October income Paycheck 2,000.00, and "Last month's leftovers" moved into Paycheck's box:** the pool is 1,932.40. Needs receives 966.20, Wants 579.72, Savings 386.48 + 430.01 = 816.49. Left over 0.00.

**Variant:** with Wants' `overspent` set to `section` before closing, October's Wants has `carriedMinor` −10000 and the close's `incomeMinor` is 3240.

**Reopening September** takes all of October's carries away: Food carries 0, Savings receives 0, "Last month's leftovers" brings 0.00.

### Objects

```ts
type RestRule = {
  shares: { sectionId: number | null; basisPoints: number }[];   // null: next month's income
  overspent: 'income' | 'section';
};
type Section = { id: number; name: string; colorSlot: number; position: number; subsections: Subsection[]; rest: RestRule };
type Source = { id: number; name: string; boxId: number; isLeftovers: boolean };
type CloseSummary = {
  month: string; nextMonth: string;
  rows: { fromSectionId: number | null; basisPoints: number; toSectionId: number | null; amountMinor: number }[];
  keptMinor: number; incomeMinor: number;
};
```

- A section with no stored rule has `{ shares: [{ sectionId: null, basisPoints: 10000 }], overspent: 'income' }`.
- `CloseSummary.rows`: sections by `position`, each rule's shares in order, then the left over (`fromSectionId: null`). A row below zero is an overspent rest, with `basisPoints` 10000 and `toSectionId` either the same section or `null`. Rows of 0 are left out. `keptMinor` is what subsections keep, `incomeMinor` the sum of every row that goes to income.

### Routes

| Route | Body | Success | Errors |
|---|---|---|---|
| `GET /api/months` | | 200 `{ lastClosed, toClose }`, each `"YYYY-MM"` or `null` | |
| `GET /api/months/:month/close` | | 200 `CloseSummary` | 409 `not_closable` "This month cannot be closed now." when `:month` is not `toClose`. |
| `POST /api/months/:month/close` | | 200 `{ lastClosed, toClose }` | The same 409. |
| `POST /api/months/:month/reopen` | | 200 `{ lastClosed, toClose }` | 409 `not_reopenable` "Only the last closed month can be reopened." |
| `PUT /api/sections/:id/rest` | `RestRule` | 200 `{ section }` | 400 per the field rules. |

A `:month` that is not `YYYY-MM` answers 400 `validation` on `month`: "Choose a month."

**Budget.** `GET /api/budget` gains `closed: boolean`. Every subsection gains `carriedMinor`. A section's `budgetedMinor` is its `receivedMinor`. `restMinor` and `availableMinor` follow the rules above. `totals.incomeMinor` adds the carry into the month's income. `totals.availableMinor` is the sum of the sections' `availableMinor`. `totals.leftOverMinor` may be below zero.

**Pipeline.** `GET /api/pipeline` gains `closed: boolean`. Every source gains `isLeftovers`. The leftovers source's `incomeMinor` is the carry into the month's income. Every section gains `carriedMinor` and `rest`, and its `receivedMinor` includes `carriedMinor`.

**Transactions.** Creating or changing a transaction with a `date` in a closed month answers 400 `validation` on `date`: "This date is in a closed month." Changing or deleting a transaction whose date is in a closed month answers 409 `closed`: "This transaction is in a closed month. Reopen the month to change it."

**Sources.**

- A `name` equal to "Last month's leftovers", ignoring case, on `POST` or `PATCH` of any other source: 400 on `name`, "This name is kept for money carried from last month."
- `PATCH` with a `name` on the leftovers source: 400 on `name`, "This source keeps its name." It moves between boxes like any source.
- `DELETE` of the leftovers source: 409 `in_use`, "This source carries money between months."
- An income whose `sourceId` is the leftovers source: 400 on `sourceId`, "Choose a source."

**Deleting sections and subsections.** For a section, the transactions check comes first and keeps its message. Then a section that a step or another section's rest rule sends money to answers 409 `in_use` with the new sentence "This section is used in the pipeline. Remove it from the steps and rest rules first." Then a section with a carry into it or into one of its subsections answers 409 `in_use`, "This section has money carried between months." A subsection with a carry into it answers 409 `in_use`, "This subsection has money carried between months." Deleting a section removes its own rest rule.

### Field rules of `PUT /api/sections/:id/rest`

| Field | Rule | Message on `fields` |
|---|---|---|
| `shares` | 1 to 8 entries. | `shares`: "Add at least one destination." |
| `shares` | Every `sectionId` is `null` or one of the person's sections, and each appears once. | `shares`: "Choose a different destination in every row." |
| `shares` | Every `basisPoints` is an integer from 1 to 10000. | `shares`: "Enter a percentage above 0 and up to 100 in every row." |
| `shares` | The `basisPoints` add up to exactly 10000. | `shares`: "The percentages must add up to 100." |
| `overspent` | `income` or `section`. | `overspent`: "Choose where an overspent rest goes." |

Each is a `validation` error (400). Another person's sections answer 404 or fail these rules as if they did not exist.

### Design classes the UI and the tests share

The design system has already been changed for this spec. Neither of you edits `design/`.

| Class | Meaning |
|---|---|
| `ty-inset` | A notice on the Budget page under the title row. |
| `ty-pill--positive` "Open", `ty-pill` "Closed" | The month's state, after the month on the Budget and Pipeline pages. |
| `ty-restrow`, `ty-sum` | A row of the close dialog, and its total. |
| `ty-pipe--next`, `ty-pipe-frame` | The three-column diagram, and the frame round it that scrolls sideways on its own. |
| `ty-step--rest` | A rest row in a section's box. |
| `ty-node--next` | A box of the third column, or money that arrived straight into a section. |
| `ty-node--old` | The box of "Last month's leftovers" when it is alone in its box. |
| `ty-wire--next` | A dotted wire: money moving between months. |

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. **Migration.** A fifth migration adds what rest rules, `overspent`, `isLeftovers`, closed months with their stored figures, and carries need. Do not edit the earlier migrations. A database from before must still open, and every section in it then has the default rule.
2. **The money of a month** as the contract says, worked out once and used by the budget, the pipeline and the close.
3. **Routes and rules** as the contract says, each filtered by the signed-in person like everything else.
4. **Tests**, against the real app with a temporary database: the worked example with its variant, every figure listed; the total carried equals income plus carries in minus spending; the cent from rounding going to the first share; `toClose` with no transaction, with the earliest transaction in the current month, in an earlier month, and after a close; closing and reopening the wrong month; transactions locked in a closed month, including moving one into it; the stored figures unchanged after a step, a rest rule and a subsection budget change; reopening and closing again giving the same carries; every source rule above; every field rule with its field; the three delete answers; isolation between two people for months, rest rules and carries; a database from before the migration.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read the README and preview of `MonthHeader`, `Dialog`, `RestDialog` (new), `PipelineNextMonth`, `BudgetRow` and `StepDialog` under `design/components/`. They changed for this spec. No motion or gesture is added beyond what the design CSS and the existing dialogs already do.

### Budget page

- **Title row:** after the month, the Pill "Open" (`ty-pill--positive`) or "Closed" (`ty-pill`). There is no "Close month" button in the title row.
- **Notices,** each a `ty-inset` under the title row, on desktop and on phones, from `GET /api/months`:
  - When the month in view is closed: "September 2026 is closed." When it is `lastClosed`, a small button "Reopen" (`ty-btn ty-btn--sm`) follows. Reopening happens at once, with the toast "September 2026 reopened".
  - When `toClose` is set, on every month: "September 2026 has ended. Close it to carry what is left into October." and a small button "Close September" (`ty-btn ty-btn--sm`), which opens the close dialog.
  - When both show, the closed notice comes first.
- **A closed month** hides "Add income" and "Add transaction", the phone's "Add" and full-width "Add income", every section's "Edit" and "Add subsection". Its subsection rows cannot be selected.
- **Subsection rows:** when `carriedMinor` is not 0, the note after the name reads "+49.99 from September" (the month before the one in view). The meter shows spent against budget + carried, turns `warning` above 90% of it and `negative` when `availableMinor` is below zero. The Available pill shows `availableMinor`.
- Section and month figures come from the server as before. "Left over" may now be below zero, written with the minus sign like every amount.

### Close dialog

Built as `design/components/Dialog` shows, from `GET /api/months/:month/close`.

- **Title** "Close September 2026", and under it in `ty-cap`: "This carries what is left into October. You can reopen September while October is still open."
- **One `ty-restrow` per row:** its words as a plain sentence, then its amount (`ty-num`). Only a section destination is a `ty-tag` with its dot, inside the sentence, so the sentence wraps like text.

| Row | Words |
|---|---|
| Rest, share below 100% | "Rest of Needs, 60% to Savings" or "Rest of Needs, 40% to October's income" |
| Rest, all of it | "Rest of Savings to Savings" or "Rest of Wants to October's income" |
| Overspent | "Overspent in Wants, kept in Wants" or "Overspent in Wants, taken from October's income" |
| Left over | "Left over to October's income" |

- **Then `ty-sum`:** "Last month's leftovers in October" with `incomeMinor`. Then, when `keptMinor` is above zero, in `ty-cap`: "Subsections keep what they did not spend: 49.99."
- **Footer:** "Cancel" (quiet) and the primary "Close September". On success the dialog closes, the toast says "September 2026 closed" and the page and its notices update. A 409 shows the server's sentence in the dialog.

### Pipeline page

Build it as `design/components/PipelineNextMonth` shows. Everything from spec 06 stays.

- **Closed month:** the Pill "Closed" after the month (and "Open" otherwise). "Add section", "Add income source", "Add step" and every "Edit" are hidden, and steps and rest rows cannot be selected or focused.
- **Layout:** the diagram becomes `ty-pipe ty-pipe--next` with a third column, inside a `ty-pipe-frame`. The third column's label is the next month's name, "November" when October is in view.
- **Rest rows:** under each section's head, one `ty-step--rest` row per share of its rule. The first row's label is "Rest", the rule is "All" for 10000 or the percent text with "%", and the tag is the section with its dot and ", November", or "Income, November". The rows of one section are one selectable group (`ty-pipe__step`), opened by click, Enter or Space, whose accessible name reads "Rest of Needs: 60% to Savings, 40% to next month's income" or "Rest of Zakat: all to Zakat". It opens the rest dialog.
- **"Left over"** has one row, "Rest", "All", "Income, November". It cannot be selected.
- **Third column:** one `ty-node--next` per section that some rule sends money to, in section order, with its dot, its name and "Arrives as extra"; then always "Last month's leftovers" with "Arrives as income". Each is named "Savings, November", "Last month's leftovers, November".
- **"Last month's leftovers" in the income column** shows like any source. Alone in its box, the box carries `ty-node--old` and its head stacks the name over `ty-cap` "From September" (the month before the one in view) in `ty-node__title`, then "Edit" and the amount, which always end inside the box. Merged into another box, its row shows the name only. Its "Edit" opens the source dialog with "Name" disabled and no "Delete".
- **Money that arrived straight into a section:** after the boxes in the income column, one `ty-node--next` per section whose `carriedMinor` is not 0: the dot, "Rest of Savings", the amount, and "From September". It is named "Rest of Savings from September".
- **Dotted wires** (`ty-wire ty-wire--next`, and `ty-wire--N` with `ty-port--N` for a section's colour slot): from each rest row's right edge to the left edge of its box in the third column, and from each "Rest of Savings" box's right edge to the left edge of that section's head. They are measured and redrawn like spec 06's wires.
- **Width:** the page itself never scrolls sideways from 1024px wide. When the window is too narrow for the diagram, `ty-pipe-frame` scrolls.

### Rest dialog

Build it as `design/components/RestDialog` shows. Title "Rest of Needs", and under it in `ty-cap`: "Where the rest of Needs goes when a month closes: what no subsection claimed, less what subsections overspent."

- **Rows** in `ty-shares` under the column labels "Goes to" and "Percentage": a select named "Goes to 1" and so on, offering "Next month's income" first and then every section by position, this one included; a percentage input named "Percentage 1" and so on with "%" after it; and, with more than one row, a small quiet "Remove" named "Remove destination 1" and so on. "+ Add destination" (`ty-btn ty-btn--sm`) adds an empty row, up to 8; its select starts on a disabled "Choose where it goes", as the step dialog's empty row does. Under it: "Together the percentages make 100%."
- **"When overspent, take it from"** is a `Segmented` with "Next month's income" and "Needs next month".
- **Footer:** "Cancel" and the primary "Save". No "Delete". Saving shows the toast "Saved" and the diagram follows without a reload.
- **Checks in the page,** before anything is sent: each percentage with the sentence from spec 04, and "Choose where every row goes." when a row has no destination. Server errors on `shares` show under the rows, on `overspent` under the Segmented. A wrong control carries `ty-input--error` as in the step dialog.

### Other places

- **Income dialog:** the leftovers source is not offered as a chip.
- **Transaction dialog:** the server's sentences about closed months show as its other errors do: on `date` under "Date", a 409 in the dialog. A transaction that fails to delete stays in the list.

### Exact wording

| Where | Wording |
|---|---|
| Budget page | Pills "Open", "Closed". "September 2026 is closed." "Reopen". "September 2026 has ended. Close it to carry what is left into October." "Close September". "+49.99 from September". |
| Close dialog | Title "Close September 2026". "This carries what is left into October. You can reopen September while October is still open." Rows as in the table. "Last month's leftovers in October". "Subsections keep what they did not spend: 49.99." Buttons "Cancel", "Close September". |
| Pipeline page | Third column label "November". "Rest", "All", "Income, November", "Arrives as extra", "Arrives as income", "From September", "Rest of Savings". |
| Rest dialog | Title "Rest of Needs". "Where the rest of Needs goes when a month closes: what no subsection claimed, less what subsections overspent." Column labels "Goes to", "Percentage". "Next month's income". "+ Add destination", "Remove". "Together the percentages make 100%." "When overspent, take it from", "Next month's income", "Needs next month". "Choose where every row goes." Buttons "Cancel", "Save". |
| Toasts | "September 2026 closed", "September 2026 reopened", "Saved". |

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Use the month before the current one as "September" and the current month as "October" in every test, so the tests pass in any month.
- Update the tests that expect the old sentence for deleting a section used in the pipeline, and any that break because a backdated transaction now shows the reminder notice.
- Add tests for acceptance criteria 2 to 15.
- Screenshots, each in light and dark, on desktop: the Budget page of October with the reminder; the close dialog of the worked example; the Budget page of September once closed; the Pipeline page of October after the close; the rest dialog of Needs. On a phone: the Budget page of October with the reminder.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. With a transaction in September, every month's Budget page shows "September 2026 has ended. Close it to carry what is left into October." and "Close September". With only October transactions, or none, no such notice shows.
3. On the worked example, "Close September" opens a dialog showing exactly the five rows of the example with their amounts, "Last month's leftovers in October −67.60" and "Subsections keep what they did not spend: 49.99." "Cancel" closes nothing.
4. Closing shows the toast, the reminder disappears, September shows "Closed" and "September 2026 is closed." with "Reopen", and October shows "Open".
5. September, once closed, has no "Add income", "Add transaction", "Edit" or "Add subsection" on desktop or on a phone, and its rows open nothing. Adding a September transaction from October, or moving one into September, shows "This date is in a closed month." under "Date".
6. October's Budget page shows Food with "+49.99 from September" and 199.98 available, Savings with 430.01 budgeted, and Income −67.60.
7. October's Pipeline page shows the rest rows of every section as the rules say, "Left over"'s row, the "November" column with Savings and "Last month's leftovers", the leftovers box with `ty-node--old`, "From September" and −67.60, and "Rest of Savings" with 430.01. Each dotted wire starts within 2px of its row's or box's right edge and ends within 2px of its target's left edge, and still does after a resize.
8. Moving "Last month's leftovers" into Paycheck's box with its "Edit" (whose "Name" is disabled and which has no "Delete"), then adding 2,000.00 of October Paycheck income, shows the figures of the example: Needs 966.20, Wants 579.72, Savings 816.49, "Left over" 0.00.
9. Selecting Needs' rest rows, by click, Enter or Space, opens "Rest of Needs" with its rule. Saving a new rule updates the rows and the third column without a reload. A row without a destination and a percentage of 0 are refused in the page with their sentences; percentages adding up to 90 show "The percentages must add up to 100." under the rows.
10. With Wants set to "Wants next month" before closing, the close dialog's Wants row reads "Overspent in Wants, kept in Wants" with −100.00, and the total reads 32.40.
11. "Reopen" on September brings back "Open", its buttons and the reminder; October loses the "+49.99 from September" note and the "Rest of Savings" box, and "Last month's leftovers" brings 0.00.
12. A closed September's Pipeline page shows "Closed", no "Add section", "Add income source", "Add step" or "Edit", and no step or rest row can be focused. Changing a step in October does not change September's figures.
13. The leftovers source is not offered in the income dialog.
14. At 1024px wide neither page scrolls sideways; the Pipeline page's frame may. From the keyboard, Tab reaches every rest group and every notice button, each with the focus ring.
15. Deleting a section that only a rest rule uses shows "This section is used in the pipeline. Remove it from the steps and rest rules first." in the dialog.
16. Every route and rule in the contract behaves as written, as the backend tests show, including the worked example's figures, the variant, isolation between two people, and a database from before the migration.
17. `web/src` still has no colour literals.
18. The screenshots match `design/components/MonthHeader`, `Dialog`, `RestDialog`, `PipelineNextMonth` and `BudgetRow`.
