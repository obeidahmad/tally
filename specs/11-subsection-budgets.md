# Spec 11: Subsection budgets, rollover and savings goals

Follows specs 01 to 10, which stay the reference for everything not changed here.

## Goal

The rules in `ROADMAP.md` ("Sections and subsections", "Rollover"):

- A subsection's budget is a fixed amount or a percentage. Fixed amounts are taken first, and percentages apply to what remains of the section's money. Each percentage share is rounded down to the cent; the cents left join the section's rest.
- Subsections have an order the person sets.
- A subsection keeps its unspent money into next month up to a cap the person sets (or all of it, or nothing). What is above the cap joins the section's rest when the month closes.
- A savings goal is a subsection whose cap is its target: it fills month by month, and paying for the thing is an expense that brings it back down.

## Out of scope

- Moving money between subsections or sections (next spec).
- Any change to the pipeline, sources or steps.
- Phone-specific dialogs beyond what the existing dialogs already do.

## Shared contract

### Subsection

```ts
type Subsection = {
  id: number; sectionId: number; name: string; position: number;
  kind: 'spending' | 'goal';
  budgetKind: 'amount' | 'percent';
  budgetMinor: number | null;        // set when budgetKind is 'amount'
  budgetBasisPoints: number | null;  // set when budgetKind is 'percent'
  keep: 'all' | 'cap' | 'none';      // a goal is always 'cap'
  capMinor: number | null;           // set when keep is 'cap'; a goal's target
};
```

Existing subsections become `kind: 'spending'`, `budgetKind: 'amount'` with their `budgetMinor`, `keep: 'all'`.

### A month's budget for subsections

For one section in one month, with M its money (`receivedMinor`, spec 09):

1. Every `amount` subsection's budget is its `budgetMinor`.
2. What remains = M − the sum of those. Every `percent` subsection's budget is what remains × `budgetBasisPoints` ÷ 10000, rounded down to the cent, or 0 when what remains is zero or below.
3. Claimed = the sum of all the subsections' budgets. The rest, overspending, available and carries keep their rules from spec 09 with these budgets.

Example: M = 1,000.01; A fixed 60.00, B 60%, C 40%. Remains 940.01; B 564.00, C 376.00; rest 0.01.

### Closing (changes spec 09, step 1)

A subsection's unspent money U = budget + carried − spent, when above zero.

- `keep: 'all'`: it keeps U.
- `keep: 'cap'`: it keeps the smaller of U and `capMinor`. The rest of U is added to the section's rest before the rest rule splits it.
- `keep: 'none'`: it keeps nothing; all of U is added to the section's rest.

`CloseSummary.keptMinor` is the sum of what subsections keep. The rest rows use the section's rest including what was added.

Example (spec 09's worked example, with Food set to `keep: 'cap'`, `capMinor` 3000): Food keeps 30.00 and adds 19.99 to Needs' rest, which becomes 70.00: 42.00 to Savings and 28.00 to October's income. `keptMinor` 3000, `incomeMinor` −5960. The total carried is still 41240.

### Routes

- `POST /api/sections/:id/subsections` takes `{ name, kind, budgetKind, budgetMinor?, budgetBasisPoints?, keep, capMinor?, position? }`. Missing `kind`, `budgetKind` and `keep` default to `spending`, `amount` and `all`, so the old body `{ name, budgetMinor }` still works. Added last, or at `position`.
- `PATCH /api/subsections/:id` takes any of those fields; the result must satisfy the rules. `position` moves it among its section's subsections, which stay numbered 1 to n.
- `GET /api/budget`: each subsection gains `kind`, `budgetKind`, `budgetBasisPoints`, `keep`, `capMinor`; its `budgetMinor` is the month's budget worked out as above.

### Field rules

| Field | Rule | Message |
|---|---|---|
| `kind` | `spending` or `goal`. | "Choose a kind." |
| `budgetKind` | `amount` or `percent`. | "Choose how the budget is set." |
| `budgetMinor` | With `amount`: an integer from 0 to 10^13. | "Enter an amount, 0 or more." |
| `budgetBasisPoints` | With `percent`: an integer from 1 to 10000. | "Enter a percentage above 0 and up to 100." |
| `budgetBasisPoints` | The `percent` subsections of one section add up to at most 10000. | "The percentages in one section can add up to at most 100." |
| `keep` | `all`, `cap` or `none`; `cap` for a goal. | "Choose what it keeps." |
| `capMinor` | With `cap` on spending: an integer from 0 to 10^13. | "Enter an amount, 0 or more." |
| `capMinor` | On a goal: an integer from 1 to 10^13. | "Enter a target above zero." |
| `position` | An integer from 1 to the number of subsections the section will have. | "Choose a position." |

Each is a 400 `validation` error on that field.

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. Migration `006`: the new subsection columns, filled for existing rows as the contract says.
2. The month's figures and the close as the contract says, in the one place spec 09 put them.
3. Tests: the percentage example; percentages taking 0 when fixed amounts claim everything; the three `keep` rules at closing, including the spec 09 variant above; a goal filling over two closed months and being capped at its target; reordering keeping positions 1 to n; every field rule; the old body still working; a database from before the migration.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/components/BudgetRow`, `SectionGroup`, `Segmented` and `Dialog` again: the goal row, the notes after a name and the goal section header are already designed there.

### Subsection dialog

Titles "Add subsection" and "Edit subsection" as now. Fields in order:

1. "Name".
2. "Kind": a `Segmented` with "Spending" and "Savings goal".
3. "Budget": a `Segmented` with "Amount" and "Percentage", then the amount field "Monthly budget" with the currency code, or the percentage field "Percentage" with "%" after it and the hint "Of what is left in the section after the fixed amounts."
4. For spending, "At month end, keep": a `Segmented` with "Everything", "Up to" and "Nothing". "Up to" shows the amount field "Keep up to". Hint under the group: "What is not kept joins the section's rest."
   For a goal, the amount field "Target" with the hint "It keeps its money until it reaches the target."
5. "Position" (a select of 1 to n), only when editing in a section with more than one subsection.

The page checks amounts and percentages with the sentences from spec 04 before sending; server errors show under their fields.

### Budget page

- **Notes after a subsection's name,** joined with " · ": "60% of what is left" for a percentage; "rolls over up to 100.00" for `cap`; "does not roll over" for `none`; "fills to 15,000.00" for a goal; and spec 09's "+49.99 from September", except on a goal, whose carried money is already its Saved.
- **A goal row** is built as `BudgetRow` shows it: columns This month (its budget), Saved (its `availableMinor`), and the Pill "42% of 15,000" (saved ÷ target, rounded down to a whole percent; the target without ".00"). Its meter is `ty-meter--goal`, saved against target, at most full. On phones the line under the meter reads "6,300.00 of 15,000.00 saved".
- **In a section that mixes goals and spending,** a goal row uses the section's Budgeted, Spent and Available columns like any row, with its "fills to …" note; the goal layout is only for a section of goals.
- **A section whose subsections are all goals** shows the header labels "This month", "Saved" and "Target", with the totals of the first two and nothing under "Target", as `SectionGroup` shows.
- Rows show in `position` order.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Tests for acceptance criteria 2 to 6.
- Screenshots, light and dark, desktop and phone: the Budget page with a percentage subsection, a capped one and a goal section; the subsection dialog on "Savings goal" and on "Spending" with "Up to".

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. A section receiving 1,000.01 with A fixed 60.00, B 60% and C 40% shows B 564.00, C 376.00 and "Rest 0.01". B's note reads "60% of what is left".
3. The subsection dialog creates and edits each kind and keep rule as the contract says, refuses percentages adding up to more than 100 in one section with the server's sentence under "Percentage", and moves a subsection with "Position".
4. A goal row shows This month, Saved, the "N% of T" pill, the goal meter and "fills to T"; a section of goals shows the goal header.
5. Closing spec 09's example with Food at "Up to 30.00" shows Food's note "rolls over up to 30.00", then the close dialog's rows "Rest of Needs, 60% to Savings 42.00" and "Rest of Needs, 40% to October's income 28.00", the total −59.60, and "Subsections keep what they did not spend: 30.00."
6. Existing subsections keep working: their budgets, notes and the spec 09 tests are unchanged.
7. The backend tests cover every rule in the contract.
8. The screenshots match `BudgetRow` and `SectionGroup`.
