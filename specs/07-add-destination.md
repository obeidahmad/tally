# Spec 07: Add destination

Follows `specs/06-pipeline.md`, which stays the reference for everything not changed here.

## Goal

In the step dialog, one step can send money to several sections. The only way to do it was a quiet text button named "Add another section". The user did not see it, tried "Position" instead, and once shown the button said: "this is very very misleading, as it reads as creating a section". The page already has "Add section", which does create one.

The user chose the word **destination**: a section that a step sends money to. This spec renames the button to "+ Add destination", makes it an outlined button so it reads as one, and brings the words around it into line.

## Out of scope

- Any change to `server/`. No route, data shape or server sentence changes.
- "Position". It still only moves a step.
- Moving the focus after a row is added.
- Creating a section from inside the step dialog.
- Any other wording of the step dialog: the titles, "Takes", the column labels "Section" and "Percentage", the field names "Section 1" and "Percentage 1", and the error sentences all stay.
- The Pipeline page itself, and any phone layout.

## Shared contract

No route or data shape changes. What `ui-dev` and `tester` share is the wording below and the design system, which has already been changed for this spec in `design/components/StepDialog`. Neither of you edits `design/`.

### Wording

| What | Was | Is now |
|---|---|---|
| The button that adds a row | "Add another section", classes `ty-btn ty-btn--quiet ty-btn--sm` | "+ Add destination", classes `ty-btn ty-btn--sm` (no `ty-btn--quiet`). Its accessible name is exactly "+ Add destination". |
| The accessible name of a row's remove button | "Remove row 1", "Remove row 2" and so on | "Remove destination 1", "Remove destination 2" and so on. Its visible text stays "Remove" and it stays a small quiet button. |
| The hint under the button | "Each percentage is taken from what reaches this step. Together they can be at most 100%." | "Each destination takes its percentage from what reaches this step. Together they can be at most 100%." |

### What the design CSS gives the button

A 1px border in `--line-strong` on a `--surface` background, 2rem (32px) tall.

| Token | Light | Dark |
|---|---|---|
| `--line-strong` | `#868f8b` | `#6c7672` |
| `--surface` | `#ffffff` | `#1a1e1c` |

### Unchanged behaviour

- The button shows only on "Percentage", in the add dialog and the edit dialog. It adds one empty row, up to 8 rows. With 8 rows it is not shown.
- A remove button shows on every row only when there is more than one row.

## UI

Owner: `ui-dev`. Paths: `web/**`.

Read the README and the preview of `design/components/StepDialog` again. Make the three wording changes above in the step dialog, with the design's classes only: no app CSS. No motion or gesture is added. Update any unit test that names the old words.

## Backend

Nothing to do. `backend-dev` is not part of this spec.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Update the existing tests and helpers that use "Add another section" or "Remove row".
- Add tests for acceptance criteria 2 to 7.
- Screenshots, each in light and dark, on desktop: the step dialog on "Percentage" with one row, and with three rows.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. On "Percentage", the add step dialog and the edit step dialog each have exactly one button named "+ Add destination". It has the classes `ty-btn` and `ty-btn--sm` and not `ty-btn--quiet`. In light and in dark its border is `--line-strong` and its background is `--surface`.
3. Pressing it adds one row with an empty "Section" select and an empty "Percentage" input, named with the next number. With 8 rows the button is not shown. On "Amount" it is not shown.
4. With one row there is no remove button. With two or more, every row has a button that reads "Remove" and is named "Remove destination 1", "Remove destination 2" and so on. Pressing one removes that row.
5. The hint under the button reads "Each destination takes its percentage from what reaches this step. Together they can be at most 100%."
6. The words "Add another section", "Remove row" and "Each percentage is taken" appear nowhere in the dialog, and nowhere in `web/src` or `e2e`.
7. "Add section" on the Pipeline page still opens the section dialog, titled "Add section".
8. A step saved with two destinations still shows as one step with one number and two rows, as in spec 06.
9. The screenshots match `design/components/StepDialog`.
