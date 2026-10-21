# Spec 06: The pipeline

Follows specs 01 to 05, which stay the reference for everything not changed here.

## Goal

The pipeline is what makes Tally different. In the user's words: "money moves from one section to another, a section takes 2.5% for zakat, then another takes 500 for family, then they get split 50-30-20 ... this is a pipeline and we need to help each user to set his own pipeline the way he wants."

This spec builds its first version, for the month in view:

- Every income belongs to a **source** the person names (Paycheck, Second job).
- A **box** holds one source or several merged together, and an ordered list of **steps**.
- A **step** takes money from what reaches it and sends it to sections: an amount for the month, or percentages shared between one or more sections.
- A **section** holds only the money the pipeline has sent it. Income that no step takes is **left over**.
- A new **Pipeline** page shows all of this as boxes and wires, on desktop.

It replaces the way a section got its budget in specs 04 and 05: the Budget choice in the section dialog goes away.

## Out of scope

- Anything between months: a section's rest rule, the third column for next month, "Last month's leftovers", money arriving from last month, closing a month. `design/components/PipelineNextMonth` shows that picture; it belongs to the next spec.
- What is left of one box flowing into another box.
- A phone layout for the Pipeline page.
- Dragging boxes, steps or wires. The app arranges the picture.
- A budget from the bottom up (a section that totals its subsections), percentage budgets for subsections, and any order among subsections.
- Carrying over the old section budgets. The user has asked for their test data to be deleted, so nothing is converted except what the Backend section says.
- Everything the earlier specs list as out of scope.

## Shared contract

Changes to the contract in specs 01 to 05. Everything else there stands.

### Objects

```ts
type Source = { id: number; name: string; boxId: number };
type Step =
  | { id: number; boxId: number; position: number; kind: 'amount'; sectionId: number; amountMinor: number }
  | { id: number; boxId: number; position: number; kind: 'percent';
      shares: { sectionId: number; basisPoints: number }[] };
type Section = { id: number; name: string; colorSlot: number; position: number; subsections: Subsection[] };
type Transaction = { id: number; date: string; kind: 'expense' | 'income'; amountMinor: number; pocketId: number;
                     subsectionId: number | null; sourceId: number | null; payee: string; note: string; source: 'manual' };
```

- A source belongs to exactly one box. A box is the set of sources that share a `boxId`; it has no name and is not an object of its own in the API. A box always has at least one source.
- `Step.position` counts from 1 inside its box, with no gaps.
- `Section` loses `budgetKind`, `budgetMinor` and `budgetBasisPoints`. `POST` and `PATCH` on sections take `{ name }` again and ignore anything else.
- An income has a `sourceId` and no `subsectionId`. An expense has a `subsectionId` and `sourceId: null`. For an income `payee` is ignored and stored as `""`.
- `Transaction.source` (always `'manual'`) keeps its meaning from spec 01 and is unrelated to `sourceId`.
- Percentages are whole basis points, as in spec 04, and "percent text" is written as spec 04 defines it (`250` is `2.5`).

### How a month's money flows

For each box, in any order:

1. The pool is the sum of the month's income whose source is in the box.
2. The steps run in `position` order on what remains of the pool.
   - An `amount` step takes `amountMinor`, or all that remains if that is less.
   - A `percent` step takes, for each share, what reached the step × `basisPoints` ÷ 10000, rounded down. Every share of one step is worked out from the same figure. Whole-number arithmetic only (`BigInt` for the product).
3. What remains after the last step is the box's left over.

A section's received money is the sum of everything every step sent it. The steps are standing rules: they apply to whichever month is viewed. For any month, income = the sections' received money + the left over.

**Worked example.** October: Paycheck 2,000.00 and Second job 600.00 share a box; Fund payout 12.40 has a box of its own with no steps.

| Step of the first box | Takes | Left after |
|---|---|---|
| 1. 2.5% to Zakat | 65.00 | 2,535.00 |
| 2. 500.00 to Family | 500.00 | 2,035.00 |
| 3. 50% Needs, 30% Wants, 20% Savings | 1,017.50, 610.50, 407.00 | 0.00 |

Received: Zakat 6500, Family 50000, Needs 101750, Wants 61050, Savings 40700. Left over: 1240. With only the 600.00 income in the month, step 1 takes 15.00, step 2 takes 500.00, and step 3 shares the remaining 85.00 (42.50, 25.50, 17.00). With only 300.00, step 1 takes 7.50, step 2 takes the remaining 292.50 and step 3 takes nothing.

### Routes

**Sources**

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/sources` | | 200 `{ "sources": Source[] }` | Oldest first. |
| `POST /api/sources` | `{ name, boxId? }` | 201 `{ source }` | Without `boxId` the source gets a new box of its own. With it, the source joins that box. |
| `PATCH /api/sources/:id` | any of `{ name, boxId }` | 200 `{ source }` | `boxId: null` moves the source into a new box of its own. |
| `DELETE /api/sources/:id` | | 204 | 409 `in_use` if it has transactions. |

When a box loses its last source, by a move or a delete, its steps are deleted with it.

**Steps**

| Route | Body | Success | Notes |
|---|---|---|---|
| `POST /api/boxes/:boxId/steps` | `{ kind: 'amount', sectionId, amountMinor }` or `{ kind: 'percent', shares }`, each with an optional `position` | 201 `{ step }` | Added last, or at `position`, moving the later steps down. |
| `PUT /api/steps/:id` | the same body | 200 `{ step }` | Replaces the whole step. With `position` it also moves it. |
| `DELETE /api/steps/:id` | | 204 | The later steps move up. |

A `boxId` that is not one of the person's boxes answers 404.

**Pipeline**

`GET /api/pipeline?month=YYYY-MM` returns the whole picture for the month:

```json
{
  "month": "2026-10", "currency": "EUR",
  "boxes": [
    { "id": 1, "incomeMinor": 260000, "leftOverMinor": 0,
      "sources": [ { "id": 1, "name": "Paycheck", "incomeMinor": 200000 }, { "id": 2, "name": "Second job", "incomeMinor": 60000 } ],
      "steps": [
        { "id": 1, "position": 1, "kind": "percent", "leftMinor": 253500,
          "shares": [ { "sectionId": 4, "basisPoints": 250, "takenMinor": 6500 } ] },
        { "id": 2, "position": 2, "kind": "amount", "sectionId": 5, "amountMinor": 50000, "takenMinor": 50000, "leftMinor": 203500 }
      ] }
  ],
  "sections": [ { "id": 4, "name": "Zakat", "colorSlot": 4, "receivedMinor": 6500 } ],
  "leftOverMinor": 1240
}
```

Boxes come in the order they were created, sources oldest first inside a box, sections by `position`. Every section is listed, with 0 when it received nothing. The top `leftOverMinor` is the sum of the boxes'.

**Budget**

`GET /api/budget`: a section's `budgetedMinor` is its received money for the month. `restMinor`, `spentMinor` and `availableMinor` keep their rules from spec 04. The section loses `budgetKind`, `budgetMinor` and `budgetBasisPoints`. `totals` gains `leftOverMinor`.

**Sections**

`DELETE /api/sections/:id` answers 409 `in_use` when a step sends money to the section, with the message "This section is used in the pipeline. Remove it from the steps first." The check for transactions comes first and keeps its message.

### Field rules

| Field | Rule | Message on `fields` |
|---|---|---|
| Source `name` | 1 to 60 characters after trimming. | `name`: "Enter a name." |
| Source `name` | No other source of the person has it, ignoring case. | `name`: "You already have a source with this name." |
| `boxId` | One of the person's boxes, or `null` on `PATCH`. | `boxId`: "Choose a box." |
| Step `kind` | `amount` or `percent`. | `kind`: "Choose what the step takes." |
| `amountMinor` | Integer from 1 to 10^13. | `amountMinor`: "Enter an amount above zero." |
| `sectionId` (amount step) | One of the person's sections. | `sectionId`: "Choose a section." |
| `shares` | 1 to 8 entries. | `shares`: "Add at least one section." |
| `shares` | Every `sectionId` is one of the person's sections and appears once. | `shares`: "Choose a different section in every row." |
| `shares` | Every `basisPoints` is an integer from 1 to 10000. | `shares`: "Enter a percentage above 0 and up to 100 in every row." |
| `shares` | The `basisPoints` add up to at most 10000. | `shares`: "The percentages of one step can add up to at most 100." |
| `position` | Integer from 1 to the number of steps the box will have. | `position`: "Choose a position." |
| Income `sourceId` | One of the person's sources. An expense must send `null` or leave it out. | `sourceId`: "Choose a source." |

Each is a `validation` error (400). Another person's sources, boxes, steps and sections answer 404 or fail these rules exactly as if they did not exist.

### Design classes the UI and the tests share

| Class | Meaning |
|---|---|
| `ty-pipe` | The diagram: two columns (`ty-pipe__col`), each a `ty-label` over a `ty-pipe__stack`. |
| `ty-node` | A box: an income box in the first column, a section or "Left over" in the second. |
| `ty-node__head`, `ty-node__src`, `ty-node__head--sum` | A box's head; one row per source of a merged box; its "Together" row. |
| `ty-pipe__step` | One step, selectable as a whole. It wraps one `ty-step` row per share. |
| `ty-step__rule` | The rule of a row: `2.5%` or `500.00`. |
| `ty-pipe__left` | The line after a step: "2,535.00 left". |
| `ty-pipe__wires`, `ty-wire`, `ty-wire--1` to `--8`, `ty-port` | The SVG laid over the diagram, a wire, a wire in a section's colour, the dot at each end. |
| `ty-shares` | The rows of the step dialog. |

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. **Migration.** A fourth migration adds what sources, boxes and steps need and a `source_id` on transactions, and drops the three budget columns from `sections`. Do not edit the first three migrations. A database from before must still open: for each person who has income, create one source named "Income" in a box of its own and give it to their income. Nothing else is converted.
2. **Sources, steps, the pipeline route** as the contract says, each filtered by the signed-in person like everything else.
3. **Transactions.** An income needs a valid `sourceId`; an expense has none. Store `""` as the payee of an income.
4. **Budget and sections** as the contract says. Remove the section budget code from spec 04, including its tests.
5. **Tests**, against the real app with a temporary database: every route and rule above with its field name; the worked example with its two smaller months; merged and separate boxes; a step added at a position, replaced, moved and deleted with the positions staying 1 to n; a box's steps deleted with its last source; the 409 on a section used by a step; isolation between two people for sources, steps and the pipeline; income = received + left over; a database from before the migration.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/README.md` again, and the README and preview of `PipelineScreen` and `StepDialog` (both new), `SectionGroup`, `SectionDialog`, `TransactionDialog`, `MonthHeader`, `AppShell`, `Segmented` and `Chips` under `design/components/`. They changed for this spec. `PipelineNextMonth` is not part of this spec. No motion or gesture is added: nothing on the Pipeline page animates beyond the design CSS.

### Navigation

"Pipeline" is a new page at `/pipeline`, after "Budget" in the sidebar. It takes `?month=` like the Budget page. It is not in the phone tab bar. Opened at 640px wide or below, it shows the top bar with the title "Pipeline" and one card: "The pipeline needs a wider screen for now."

### Pipeline page

Build it as `design/components/PipelineScreen` shows, from `GET /api/pipeline`.

- **Title row:** the heading "Pipeline", the month between "Previous month" and "Next month" buttons (next is disabled on the current month), then "Add section" and the primary button "Add source".
- **Income column:** one `ty-node` per box. A box with one source shows the source's name, a small quiet "Edit" button and its income in the head. A box with several shows one `ty-node__src` row per source (name, "Edit", income) and a "Together" row with the box's income.
- **Steps:** each step is a `ty-pipe__step` holding one `ty-step` row per share: the step's number on its first row, the rule (`2.5%` as percent text with a % sign, or the amount), the section with its dot, and the amount taken. After each step a `ty-pipe__left` line: "2,535.00 left". Selecting a step, by click, Enter or Space, opens "Edit step". Its accessible name says what it does: "Step 3: 50% to Needs, 30% to Wants, 20% to Savings", "Step 2: 500.00 to Family".
- **A box with no steps** shows "No steps yet. All of it is left over." and its "left" line.
- **"Add step"** is the last row of every box.
- **Sections column:** one `ty-node` per section with its dot, name, a small quiet "Edit" button (it opens "Edit section") and its received money. Last comes "Left over" with the plain dot, no Edit, and the total left over. It is always shown.
- **Wires:** one SVG over the diagram, hidden from assistive technology. One wire from the right edge of each `ty-step` row to the left edge of its section's head, with the class for the section's colour slot (slot 0 has no colour class), and one plain wire from a box's last `ty-pipe__left` line to "Left over" when that box has something left. Measure the positions from the rendered rows and draw them again when the layout or the data changes. A wire is a cubic curve whose two control points sit level with its ends, halfway across the gap, with a 4px `ty-port` circle at each end. Every wire carries the class `ty-wire`; a coloured one carries `ty-wire--N` as well, and its two circles `ty-port--N`.
- **Width:** the design CSS narrows the two columns in a smaller window and sizes the wire layer to the diagram. Do not give the SVG a width of its own. From 1024px wide the page does not scroll sideways.
- **With no source yet:** in place of the diagram, one card: "No income sources yet. A source is where money comes from, such as a paycheck." and the button "Add source".
- Loading and failure states as on every page.

### Source dialog

Titles "Add source" and "Edit source". Fields: "Name", then "Box" (a select). "Box" offers "A box of its own" first, then one choice per box that holds other sources, reading "With {names}": the names of that box's other sources joined with "and" ("With Paycheck and Second job"). A new source starts on "A box of its own". An edited one starts on where it is: "A box of its own" when it is alone in its box, otherwise "With {the other sources of its box}".

- When the source is the only one in its box, that box has steps and another choice is picked, show under the select: "Its box will have no source left, so that box's steps will be removed."
- "Delete" removes the source and offers Undo, which adds it again in a box of its own. A source with income shows "This source has transactions. Delete them first." in the dialog.

### Step dialog

Build it as `design/components/StepDialog` shows. Titles "Add step" and "Edit step".

- **"Takes"** is a `Segmented` with "Percentage" and "Amount". A new step starts on "Percentage" with one empty row.
- **Percentage:** rows in `ty-shares` under the column labels "Section" and "Percentage". Each row has a section select named "Section 1", "Section 2" and so on, a percentage input named "Percentage 1" and so on with "%" after it, and, when there is more than one row, a small quiet "Remove" button named "Remove row 1" and so on. "Add another section" adds a row, up to 8. Under the rows the hint: "Each percentage is taken from what reaches this step. Together they can be at most 100%."
- **Amount:** "Section" (a select) and "Amount" with the currency code, and under it the hint "For the whole month, however many payments come in."
- **"Position"** (a select of 1 to the number of steps) shows only when editing a step of a box that has more than one.
- **Checks in the page**, before anything is sent: each percentage with the sentence from spec 04 ("Enter a percentage above 0 and up to 100, with at most two decimals."), the amount with "Enter an amount above zero, with at most two decimals.", a section chosen in every row ("Choose a section in every row.", or "Choose a section." for an amount). Server errors for `shares` show under the rows, for `sectionId` and `amountMinor` under their fields. A control that is wrong carries `ty-input--error` as in every other dialog: the percentage input or the section select that failed its check in the page, or every row's controls for a server error on `shares`.
- **With no section yet**, the dialog shows "Add a section first" and no fields.
- "Delete" removes the step and offers Undo, which puts it back at its position.

### Transaction dialog

Build it as `design/components/TransactionDialog` shows.

- For an income, "Source" replaces "Payee": a `Chips` group with one chip per source and a last chip "+ Add source", which opens a `ty-inset` panel with "Source name". A new income starts on the first source. With no source yet, "+ Add source" is already chosen and its panel open.
- Saving creates the new source first (in a box of its own), then the new pocket if there is one, then the income. If a later request fails, what was created stays chosen and its panel closes, as spec 02 says for pockets. The source's and the pocket's name errors show in their own panels.
- The fields of an income, in order: "Type", "Date", "Amount", "Source", "Pocket", "Note (optional)". An expense is unchanged.

### Other pages

- **Transactions:** an income row shows its source's name where the payee would be.
- **Section dialog:** "Name" only, as `design/components/SectionDialog` shows. The Budget control from specs 04 and 05 is removed.
- **Budget page, section header:** every section shows its Rest pill; the rule line ("Fixed amount", "50% of income after fixed sections") is removed. Budgeted is the section's received money.
- **Budget page, month header:** a fourth figure, "Left over", after "Spent so far". When it is above zero, a line in `ty-cap` under the figures, on desktop only: "{amount} is left over: no step in the pipeline takes it." followed by the link "Open the pipeline".
- **Deleting a section** that a step uses shows the server's sentence in the dialog.

### Exact wording

| Where | Wording |
|---|---|
| Pipeline page | Heading "Pipeline". Column labels "Income" and "Sections". Buttons "Add section", "Add source", "Add step", "Edit". "Together". "{amount} left". "No steps yet. All of it is left over." "Left over". |
| Pipeline, no source | "No income sources yet. A source is where money comes from, such as a paycheck." Button "Add source". |
| Pipeline on a phone | "The pipeline needs a wider screen for now." |
| Source dialog | Titles "Add source", "Edit source". Fields "Name", "Box". Choices "A box of its own", "With {names}". Buttons "Add source" or "Save", "Delete", "Cancel". |
| Step dialog | Titles "Add step", "Edit step". Group "Takes" with "Percentage", "Amount". Column labels "Section", "Percentage". Fields "Section", "Amount", "Position". Buttons "Add another section", "Remove", "Add step" or "Save", "Delete", "Cancel". |
| Transaction dialog | Group "Source", chip "+ Add source", panel field "Source name". |
| Budget page | Figure "Left over". "{amount} is left over: no step in the pipeline takes it." Link "Open the pipeline". |
| Toasts | "Source deleted" and "Step deleted", each with "Undo". "Saved" after a save. |

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Remove or rewrite the tests of the section budget control from specs 04 and 05 (`14-section-budget`, and the Budget parts of `15-segmented`): the control no longer exists. Keep what still holds, such as the Rest pill and the `Segmented` checks on "Type".
- Update the tests that add income: it now needs a source in place of a payee.
- Add tests for acceptance criteria 9 to 22.
- Screenshots, each in light and dark, on desktop: the Pipeline page with the worked example, the Pipeline page with no source, the step dialog on "Percentage" with three rows and on "Amount", the source dialog, the income dialog with the source panel open. Also the Budget page with the worked example on desktop and on a phone.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. A source is created in a box of its own or into an existing box, renamed, moved between boxes and into a box of its own, and deleted, each as the contract says. A second source with the same name in another letter case is refused on `name`.
3. A step is created, replaced, moved and deleted as the contract says, and the positions of a box's steps are always 1 to n.
4. Every rule in the field rules table answers 400 `validation` on the field named.
5. `GET /api/pipeline` gives the figures of the worked example and of its two smaller months, and for each of them income equals received plus left over.
6. A box's steps are deleted when its last source is moved away or deleted. A section used by a step cannot be deleted and answers 409 with the sentence in the contract.
7. An income without a valid `sourceId`, and an expense with one, each answer 400 on `sourceId`. An income's payee comes back as `""`.
8. A second person sees none of the first person's sources, steps or pipeline figures and cannot read, change or delete them. A database from before the migration opens, and its income belongs to a source named "Income".
9. "Pipeline" is in the sidebar after "Budget" and opens the page. It is not in the phone tab bar, and at 390px wide the page shows "The pipeline needs a wider screen for now."
10. On a new account the Pipeline page shows the "No income sources yet" card. "Add source" creates a source and the diagram appears with that source's box and "Left over".
11. Adding an income to that source from the Budget page shows it on the Pipeline page in the box's head and in "Left over", with "No steps yet. All of it is left over."
12. "Add step" with "Percentage" and one row of 2.5% to a section shows the step in the box with its amount and the "left" line, and the section's box shows the money, all without a reload.
13. Building the worked example through the page (a second source added with "With Paycheck", then the three steps) shows every figure of the example: the two source rows and "Together 2,600.00", each step's amounts and "left" lines, each section's received money, and "Left over 12.40".
14. The step dialog refuses a percentage of 0, 101 or 2.555, an empty amount, and a row without a section, each with its sentence, and saves nothing. Percentages adding up to more than 100 show the server's sentence under the rows.
15. "Edit step" opens with the step's values. Changing "Position" moves the step and every figure after it follows. "Delete" removes it and Undo puts it back at the same position.
16. "Edit" on a source renames it. Moving the only source of a box that has steps shows the warning, and after saving that box and its steps are gone. A source with income cannot be deleted and the dialog says why.
17. Each step has one wire per row ending at its section's box, in that section's colour, and a box with money left has a plain wire to "Left over". Each wire starts within 2px of the right edge of its row and ends within 2px of the left edge of its section's head, and still does after the window is resized. At 1024px wide the page does not scroll sideways.
18. From the keyboard: Tab reaches every "Edit" button, every step and every "Add step"; Enter and Space open a step; each shows the focus ring. The wires are not reachable and are hidden from assistive technology.
19. In the income dialog "Source" replaces "Payee". On an account with no source the panel is open, and saving creates the source and the income. With sources present, one chip per source shows and "+ Add source" creates one in place. The Transactions page shows the source's name on the income row.
20. On the Budget page each section's Budgeted is its received money, every section shows a Rest pill, and no rule line shows. The month header shows "Left over", and above zero the line with the link, which opens the Pipeline page.
21. The section dialog has only "Name". "Sum of subsections", "Fixed amount", "Percentage of income" and a "Budget" group appear nowhere in the app.
22. Deleting a section that a step uses shows "This section is used in the pipeline. Remove it from the steps first." in the dialog.
23. `web/src` still has no colour literals.
24. The screenshots match `design/components/PipelineScreen`, `StepDialog`, `TransactionDialog`, `SectionGroup` and `MonthHeader`, apart from "Close month", the Open pill and the notes after a subsection's name, which the app does not have yet.
