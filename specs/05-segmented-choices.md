# Spec 05: Segmented choices

Follows `specs/04-section-budget.md` and the specs before it, which stay the reference for everything not changed here.

## Goal

The user looked at the section dialog from spec 04 and said of its three Budget chips: "i hate how big the options are. it's really not elegant in its current state". They also questioned "Sum of subsections" as the choice a new section starts on ("a user would think section first then subsection"), and agreed to keep it as a choice for people who budget from the bottom up.

This spec:

- Replaces the chips with the design system's new `Segmented` control wherever the choice is a fixed set: the section dialog's Budget and the transaction dialog's Type. It is one row, as tall as an input, and never wraps.
- Renames the Budget choices to fit one row and puts the section-first ones first: "Percentage", "Fixed amount", "Subsections".
- Starts a new section on "Percentage".

## Out of scope

- Any change to `server/`. The three budget kinds and every route stay as spec 04 left them.
- Removing the bottom-up choice.
- The pocket chips, "+ Add pocket" and the emoji picker. They stay as they are.
- A sliding or animated selection. The chosen segment changes colour, as the design CSS does it.
- The wording on the Budget page ("Fixed amount", "50% of income after fixed sections").

## Shared contract

No route or data shape changes. What `ui-dev` and `tester` share is the design system, which has already been changed for this spec. Neither of you edits `design/`.

### Markup

```html
<fieldset class="ty-fieldset">
  <legend class="ty-label">Budget</legend>
  <div class="ty-segmented">
    <label><input type="radio" name="budget" checked>Percentage</label>
    <label><input type="radio" name="budget">Fixed amount</label>
    <label><input type="radio" name="budget">Subsections</label>
  </div>
</fieldset>
```

### What the design CSS gives it

| Part | Value |
|---|---|
| Track (`ty-segmented`) | Background `--surface-sunken`. 2.5rem (40px) tall, 2.75rem (44px) at 640px wide and below. As wide as its form. |
| Segments | Equal widths on one line. Each segment's radio input covers the full height of the track, so the press target is as tall as the track although the outlined shape is smaller. |
| Chosen segment | Background `--surface`, border `--ink`, text `--ink`. |
| Other segments | No background, text `--ink-muted`. |
| Legend | Starts at the same left edge as every other field label. This now holds for the Pocket and Emoji groups too. |

| Token | Light | Dark |
|---|---|---|
| `--surface` | `#ffffff` | `#1a1e1c` |
| `--surface-sunken` | `#eceee9` | `#0c0e0d` |
| `--ink` | `#141a18` | `#eef1ee` |
| `--ink-muted` | `#56615d` | `#a7b0ac` |

### Budget choices

| Choice, in this order | `budgetKind` | What shows under the control |
|---|---|---|
| "Percentage" | `percent` | The "Percentage" field with its hint, as in spec 04. |
| "Fixed amount" | `fixed` | The "Monthly budget" field, as in spec 04. |
| "Subsections" | `subsections` | No field. One line in `ty-cap`: "The total of its subsections' budgets." |

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read `design/README.md` again, and the README and preview of `Segmented` (new), `SectionDialog`, `TransactionDialog` and `Chips` under `design/components/`. They changed for this spec. Build both groups with the markup above and the design's classes only: no app CSS for this control. No motion or gesture is added.

### Section dialog

- "Budget" is a `Segmented` with the three choices in the table above, in that order.
- A new section opens on "Percentage" with the "Percentage" field empty. Saving it empty shows the percentage error from spec 04 under the field and saves nothing.
- Editing opens on the section's own choice with its value filled in, as before. A section from before spec 04 opens on "Subsections".
- Everything else in spec 04's dialog stands: the two fields, their errors, what is sent, the server errors, Undo.

### Transaction dialog

- "Type" is a `Segmented` with "Expense" and "Income".
- Nothing else changes: the title, the submit button's label and colour, and the fields still follow the chosen type, and "Add income" on the Budget page still opens it on Income.
- "Pocket" stays a `Chips` group.

### Exact wording

| Where | Wording |
|---|---|
| Section dialog | Group "Budget" with "Percentage", "Fixed amount", "Subsections". Line under "Subsections": "The total of its subsections' budgets." |
| Transaction dialog | Group "Type" with "Expense", "Income". |

"Sum of subsections" and "Percentage of income" appear nowhere any more.

## Backend

Nothing to do. `backend-dev` is not part of this spec.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Update the existing tests this changes: the Budget choices' names, order and starting choice; any test that adds a section through the dialog with only a name; and anything that looks for `ty-chip` in the Type or Budget group.
- Add tests for acceptance criteria 2 to 11.
- Screenshots, each in light and dark, on desktop and on a phone: the section dialog on each of the three choices, and the transaction dialog on Expense and on Income.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. In the section dialog "Budget" is one radio group with exactly "Percentage", "Fixed amount" and "Subsections", in that order, inside a `ty-segmented`. The dialog contains no `ty-chip`.
3. "Add section" opens on "Percentage" with an empty "Percentage" field and its hint. Saving without a percentage shows "Enter a percentage above 0 and up to 100, with at most two decimals." and adds no section.
4. "Fixed amount" shows "Monthly budget". "Subsections" shows no field and the line "The total of its subsections' budgets."
5. A section saved on each choice shows on the Budget page as spec 04 says: "50% of income after fixed sections", "Fixed amount", or no pill and no rule.
6. "Edit" opens on the section's own choice with its value filled in.
7. In the transaction dialog "Type" is a `ty-segmented` with "Expense" and "Income", and the title, the submit button's label and its colour follow the choice as before. The Pocket group is still made of `ty-chip`s.
8. At 1280px, 390px and 360px wide, in both dialogs: the segments of a control sit on one line, are equally wide to within 1px, and the control is as wide as the "Name" or "Date" input. It is 40px tall at 1280px and at least 44px tall at 390px, and at 390px each segment's radio input is at least 44px tall too.
9. In light and in dark: the track has the `--surface-sunken` background; the chosen segment has the `--surface` background, an `--ink` border and `--ink` text; the others have no background and `--ink-muted` text.
10. From the keyboard, the arrow keys move the choice within a control, Tab leaves it for the next field, and the chosen segment shows the focus ring.
11. The "Budget", "Type" and "Pocket" legends start at the same left edge as the "Name" or "Date" label, to within 0.5px.
12. `web/src` still has no colour literals, and `web/src/app.css` has no rule for the segmented control.
13. The screenshots match `design/components/Segmented`, `SectionDialog` and `TransactionDialog`.
