# Spec 08: Add income source

Follows `specs/06-pipeline.md` and `specs/07-add-destination.md`, which stay the reference for everything not changed here.

## Goal

The user asked for the Pipeline page's button "Add source" to read "Add income source", "just to make it more understandable". This spec renames that button, and the dialog it opens so the two still agree.

## Out of scope

- Any change to `server/`.
- The income dialog: the group "Source", the chip "+ Add source" and the field "Source name" stay. That dialog is already about income.
- The fields of the source dialog ("Name", "Box" and its choices), its sentences, "Save", "Delete", "Cancel" and the "Edit" buttons on the page.
- Any change to layout, colour or motion.

## Shared contract

No route or data shape changes. What `ui-dev` and `tester` share is the wording below. The design system has already been changed for this spec in `design/components/PipelineScreen`. Neither of you edits `design/`.

Sentence case, as on every other button: "Add income source", not "Add Income Source".

| Where | Was | Is now |
|---|---|---|
| Pipeline page, title row, primary button | "Add source" | "Add income source" |
| Pipeline page with no source, the card's button | "Add source" | "Add income source" |
| Source dialog when adding: its title and its primary button | "Add source" | "Add income source" |
| Source dialog when editing: its title | "Edit source" | "Edit income source" |

## UI

Owner: `ui-dev`. Paths: `web/**`.

Make the four wording changes above. Nothing else changes: same classes, same behaviour. Update any unit test that names the old words.

## Backend

Nothing to do. `backend-dev` is not part of this spec.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Update the existing tests and helpers that use the old words. Take care not to change the income dialog's "+ Add source" chip.
- Add tests for acceptance criteria 2 to 6.
- Screenshots, each in light and dark, on desktop: the Pipeline page with the worked example, and the source dialog when adding.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` all succeed.
2. The Pipeline page's title row has a primary button named exactly "Add income source", and no button named exactly "Add source".
3. On an account with no source, the card's button is named exactly "Add income source".
4. Either button opens a dialog titled "Add income source" whose primary button is "Add income source". Saving a name with it creates the source, as in spec 06.
5. "Edit" on a source opens a dialog titled "Edit income source" whose primary button is "Save".
6. In the income dialog the chip still reads "+ Add source" and the panel's field is still "Source name".
7. At 1024px wide the Pipeline page still does not scroll sideways, and the title row's buttons stay on one line.
8. The screenshots match `design/components/PipelineScreen` for the button's name and place.
