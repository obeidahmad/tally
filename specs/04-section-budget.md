# Spec 04: A section has its own budget

Follows `specs/01-foundations.md`, `02-first-income.md` and `03-add-buttons.md`, which stay the reference for everything not changed here.

## Goal

The user added a section and found no way to give it a budget: "adding a section does not give me an option to choose the overall budget of that section. nor by using percentage nor by using number, i have to add subsection for budget to get put in the overall budget".

This spec lets a section have its own budget, set in one of three ways:

- **Sum of subsections**: the total of its subsections' budgets. This is how every section works today, and what a new section starts on.
- **Fixed amount**: a number, such as 900.00.
- **Percentage of income**: a share of the month's income, such as 50%.

A section's own budget counts in the month's Budgeted figure as soon as it is saved, with or without subsections. The part of it that no subsection has claimed is the section's rest, shown beside its name.

## Out of scope

- Income sources, a split rule per income source, tax-style sections that are "taken first", and the `AllocationBar`.
- A percentage budget for a subsection ("60% of what is left"). Subsections keep their fixed monthly budget.
- A "Rest so far" figure in the month header, and anything that happens to a rest at month end: rollover, caps, closing a month.
- Stopping subsections from claiming more than their section has. They may; the rest then goes below zero and says so.
- A different budget rule per month. The rule is standing: it applies to whichever month is viewed.
- Reordering sections. They stay in the order they were created.
- Everything the earlier specs list as out of scope.

## Shared contract

Changes to the contract in spec 01. Everything else there stands.

### Section

```ts
type Section = { id: number; name: string; colorSlot: number; position: number;
                 budgetKind: 'subsections' | 'fixed' | 'percent';
                 budgetMinor: number | null;        // the fixed amount; null unless budgetKind is 'fixed'
                 budgetBasisPoints: number | null;  // hundredths of a percent, 5000 = 50%; null unless 'percent'
                 subsections: Subsection[] };
```

A percentage is stored as whole basis points, never a float: 50% is `5000`, 2.5% is `250`, 12.25% is `1225`.

**Percent text.** Wherever a percentage is written for a person (a caption, a field, an error message), it is the basis points divided by 100 with trailing zeros and a trailing point dropped: `5000` is `50`, `250` is `2.5`, `1225` is `12.25`.

### Routes

| Route | Body | Success | Notes |
|---|---|---|---|
| `POST /api/sections` | `{ name, budgetKind?, budgetMinor?, budgetBasisPoints? }` | 201 `{ section }` | `budgetKind` defaults to `'subsections'`. |
| `PATCH /api/sections/:id` | any of the same fields | 200 `{ section }` | The patch is merged over the stored section and the result must satisfy the rules below. |

`GET /api/sections` returns the three new fields on every section.

### Field rules

| Field | Rule | Message on `fields` |
|---|---|---|
| `budgetKind` | One of `subsections`, `fixed`, `percent`. | `budgetKind`: "Choose how the budget is set." |
| `budgetMinor` | When the kind is `fixed`: an integer from 0 to 10^13. | `budgetMinor`: "Enter a budget of zero or more." |
| `budgetBasisPoints` | When the kind is `percent`: an integer from 1 to 10000. | `budgetBasisPoints`: "Enter a percentage above 0 and up to 100." |
| All percentages | The basis points of all the person's `percent` sections, this one included, add up to at most 10000. | `budgetBasisPoints`: "Your sections would take more than 100% of income. Other sections already take {n}%." with {n} as percent text. |

- The server stores `null` in the field that does not belong to the kind, whatever was sent. So changing a fixed section to `{ "budgetKind": "percent", "budgetBasisPoints": 5000 }` is valid although the merged body still carries the old `budgetMinor`.
- Each rule is a `validation` error (400) on the field named. Another person's sections never count.

### Budget

`GET /api/budget?month=YYYY-MM`. Every section gains `budgetKind`, `budgetMinor`, `budgetBasisPoints` and `restMinor`, and `budgetedMinor` changes meaning:

```json
{ "id": 2, "name": "Needs", "colorSlot": 2,
  "budgetKind": "percent", "budgetMinor": null, "budgetBasisPoints": 5000,
  "budgetedMinor": 75000, "restMinor": 45000, "spentMinor": 21240, "availableMinor": 53760,
  "subsections": [ { "id": 3, "name": "Food", "budgetMinor": 30000, "spentMinor": 21240, "availableMinor": 8760 } ] }
```

| Figure | Rule |
|---|---|
| Section `budgetedMinor` | `subsections`: the sum of its subsections' `budgetMinor`, as before. `fixed`: its `budgetMinor`. `percent`: its share of the base, rounded down to the cent. |
| The base | The month's `incomeMinor` minus the `budgetMinor` of all the person's `fixed` sections, and never below 0. Fixed amounts are taken first; percentages apply to the income that remains. |
| A share | base × `budgetBasisPoints` ÷ 10000, rounded down. Whole-number arithmetic only: the product can pass 2^53, so use `BigInt` for it. |
| Section `restMinor` | `budgetedMinor` minus the sum of its subsections' `budgetMinor`. It may be negative. It is always 0 for `subsections`. |
| Section `spentMinor` | Unchanged: the sum of its subsections' spending. |
| Section `availableMinor` | `budgetedMinor` minus `spentMinor`. |
| `totals.budgetedMinor` | The sum of the sections' `budgetedMinor`. `totals.availableMinor` is that minus `totals.spentMinor`. |

A subsection's figures do not change.

**Worked example.** October has one income of 2,400.00.

| Section | Kind | Subsections | `budgetedMinor` | `restMinor` |
|---|---|---|---|---|
| Home | fixed 900.00 | Rent 800.00, Internet 130.00 | 90000 | −3000 |
| Needs | percent 50% | Food 300.00 | 75000 (half of 1,500.00) | 45000 |
| Zakat | percent 2.5% | none | 3750 | 3750 |
| Fun | subsections | Eating out 150.00 | 15000 | 0 |

`totals.budgetedMinor` is 183750. In a month with no income, Needs and Zakat have a budget of 0 and Home still has 90000. With one income of 1,000.01 and a single section at 33.33%, that section's budget is 33330.

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. **Migration.** A third migration adds the three columns to `sections`. Every section that exists gets the kind `subsections` and no budget of its own, so its figures do not change. Do not edit the first two migrations: the user has a database made from them.
2. **Sections.** `POST` and `PATCH` validate and store the budget fields as the contract says, including the rule that all percentages together stay at or under 100%.
3. **Budget.** Compute the figures as the contract says.
4. **Tests**, against the real app with a temporary database: the default kind; each kind stored and returned; the field that does not belong stored as `null`; every validation rule with its field name; the 100% rule on `POST` and on `PATCH`, where the section being changed does not count against itself; the worked example and the two notes under it; a second person's fixed and percentage sections change nothing in the first person's budget and do not count toward their 100%; a database with sections from before the migration.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/README.md` again, and the README and preview of `SectionDialog` (new), `SectionGroup`, `Chips`, `Field` and `Pill` under `design/components/`. They changed for this spec. No motion or gesture is added: the field under the chips appears at once when its chip is chosen, like the new-pocket panel in the transaction dialog.

### Section dialog

Build it as `design/components/SectionDialog` shows.

- **Fields in order:** "Name", then a `Chips` group with the legend "Budget" and the chips "Sum of subsections", "Fixed amount" and "Percentage of income", then the one field the chosen chip needs.
- **Sum of subsections** shows no field. A new section opens on it.
- **Fixed amount** shows "Monthly budget": an amount field with the currency code after it, like the subsection dialog's. Zero is allowed. Anything that is not an amount of zero or more with at most two decimals shows "Enter an amount of zero or more, with at most two decimals." under the field.
- **Percentage of income** shows "Percentage": the same kind of input with "%" after it in place of the currency code, and the hint "Of the month's income left after fixed-amount sections." under it, tied to the input with `aria-describedby`. It accepts `50`, `2.5` and `12.25`. Zero, a negative, anything above 100, more than two decimals or anything else shows "Enter a percentage above 0 and up to 100, with at most two decimals." under the field in place of the hint. Turn the text into basis points without floating-point arithmetic: a percentage with two decimals times 100 is the same whole number the amount parser already produces.
- **Editing** opens on the section's own kind with its value filled in: an amount as `900.00`, a percentage as percent text (`50`, `2.5`).
- **Saving** sends `name`, `budgetKind`, `budgetMinor` and `budgetBasisPoints`, with `null` in the ones the kind does not use.
- **Server errors** show under their field: `budgetMinor` under "Monthly budget", `budgetBasisPoints` under "Percentage", `budgetKind` under the chips.
- **Undo** after deleting a section puts it back with its budget and its subsections.

### Section header on the Budget page

Build it as `design/components/SectionGroup` shows.

- **Totals.** Budgeted, Spent and Available show the section's `budgetedMinor`, `spentMinor` and `availableMinor` from the server.
- **Rest.** A `fixed` or `percent` section shows a pill after "Edit": `ty-pill` reading "Rest 75.00", or `ty-pill ty-pill--warning` reading "Rest −30.00" when `restMinor` is below zero. The amount is formatted like every other amount, so the minus is U+2212.
- **Rule.** After the pill, in `ty-cap`: "Fixed amount", or "50% of income after fixed sections" with the percentage as percent text.
- **Sum of subsections.** A `subsections` section shows no pill and no rule, as today.
- **Phones.** Every section's header ends with a line in `ty-cap ty-shead__sub`: "990.15 of 1,175.00 spent" (spent, then budgeted). The design CSS shows it only on phones, where the Budgeted and Spent totals are hidden.

The month header does not change: its Budgeted figure is `totals.budgetedMinor`, which now includes the sections' own budgets.

### Exact wording

| Where | Wording |
|---|---|
| Section dialog | Titles "Add section" and "Edit section". Field "Name". Chip group "Budget" with "Sum of subsections", "Fixed amount", "Percentage of income". Fields "Monthly budget" and "Percentage". Buttons "Add section" or "Save", "Delete", "Cancel". |
| Percentage hint | "Of the month's income left after fixed-amount sections." |
| Percentage error | "Enter a percentage above 0 and up to 100, with at most two decimals." |
| Monthly budget error | "Enter an amount of zero or more, with at most two decimals." |
| Section header | "Rest {amount}". "Fixed amount". "{percent}% of income after fixed sections". On phones "{spent} of {budgeted} spent". |

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Update the existing tests that this changes: a section header on a phone has one more line, and the section dialog has the Budget chips.
- Add tests for acceptance criteria 8 to 17.
- Screenshots, each in light and dark: the Budget page on desktop and on a phone with the four sections of the worked example, and the section dialog on "Fixed amount" and on "Percentage of income".

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. A database with sections from before this change opens with each of them on `subsections`, and `GET /api/budget` gives the same figures for them as before.
3. `POST /api/sections` with only a name gives `budgetKind: "subsections"` and `null` in both budget fields. A fixed and a percentage section are stored and returned as sent. `PATCH` changes the kind and the value, and the field that does not belong to the kind comes back `null`.
4. An unknown `budgetKind`, a `fixed` section with a missing, negative or fractional `budgetMinor`, and a `percent` section with `budgetBasisPoints` missing, 0, 10001 or 2.5 each answer 400 `validation` on that field.
5. A percentage that would take all the person's percentage sections past 100% answers 400 `validation` on `budgetBasisPoints` with the message in the contract. Changing a section's own percentage does not count it twice. Another person's sections do not count.
6. `GET /api/budget` gives the figures of the worked example, a budget of 0 for a percentage section in a month with no income, and 33330 for 33.33% of 1,000.01.
7. The share is computed with whole numbers only.
8. "Add section" opens a dialog with "Name" and the "Budget" chips, "Sum of subsections" chosen and no other field. Choosing "Fixed amount" shows "Monthly budget"; choosing "Percentage of income" shows "Percentage" with its hint.
9. Adding a section with a fixed amount of 900.00 and no subsections shows it with Budgeted 900.00, Available 900.00, "Rest 900.00" and "Fixed amount", and the month's Budgeted figure rises by 900.00 without a reload.
10. With an income of 2,400.00 and the fixed section of 900.00, a section at 50% shows Budgeted 750.00 and "50% of income after fixed sections". Adding an income of 100.00 changes it to 800.00 without a reload.
11. When a fixed section's subsections claim 30.00 more than it has, its pill reads "Rest −30.00" and is the warning pill. A "Sum of subsections" section shows no Rest pill and no rule.
12. "Edit" on a section opens the dialog on its kind with its value filled in (`900.00`, `2.5`). Changing it to "Sum of subsections" and saving removes the pill and the rule.
13. In the "Percentage" field, `0`, `101`, `2.555` and `abc` each show the percentage error under the field and nothing is saved. A percentage that takes the sections past 100% shows the server's message under the field.
14. Deleting a section with a budget and choosing Undo brings it back with the same budget, rule and subsections.
15. On a phone (390px wide) each section header shows "{spent} of {budgeted} spent" under its name. The section dialog's chips are at least 44px tall and its primary button is in view without scrolling.
16. From the keyboard, the Budget chips are one radio group moved through with the arrow keys, Tab goes from them to the field they show, and each shows the focus ring.
17. `web/src` still has no colour literals.
18. The screenshots match `design/components/SectionGroup` and `SectionDialog`, apart from the notes after a subsection's name ("rolls over up to 100.00"), which the app does not have yet.
