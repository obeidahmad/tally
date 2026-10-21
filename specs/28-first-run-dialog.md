# Spec 28: The transaction dialog on a first run

Follows specs 01 to 27, which stay the reference for everything not changed here. UI only; no migration and no API change.

## Goal

The user started from an empty account, opened "Add income", and did not like the dialog:
- With no source and no pocket yet, the dialog showed a lone "+ Add source" chip and a lone "+ Add pocket" chip, both already chosen. They looked like big orange buttons, but there was nothing else to choose, so they did nothing useful.
- Under each chip was a grey nested panel, and the pocket panel held a grid of 32 emojis, which made the dialog long.

## Out of scope

- Changing the API, the Pockets page's own "Add pocket" dialog, or the source dialog on the Pipeline page.
- Turning the chips into selects or searchable menus.
- A first-run guide or onboarding.
- A side-by-side layout for the new pocket's fields.

## UI

Owner: `ui-dev`. Paths: `web/**` (`web/src/dialogs.tsx`, the `TransactionDialog`). Built on spec 27's look; no new design component.

### Source (income)

- **With no source yet:** no chips and no panel; Source is a single text field labelled "Source", with the placeholder "e.g. Salary". Saving creates the source first, then the income, as today. The server's `name` error shows under "Source".
- **With sources:** the chips stay as today, ending with the "+ Add source" chip. Choosing it shows one text field, "Source name", directly under the chips, with no `ty-inset` panel.

### Pocket (expense and income)

- **With no pocket yet:** no chips and no panel. Show two plain fields:
  - "Pocket", a text field with the placeholder "e.g. Current account";
  - "Kind", the existing `KindField`, starting on Bank account.

  Saving creates the pocket first, then the transaction, as today. The server's `name` error shows under "Pocket".
- **With pockets:** the chips stay as today, ending with the "+ Add pocket" chip. Choosing it shows "Pocket name" and "Kind" directly under the chips, with no `ty-inset` panel.
- **No emoji picker in this dialog.** A pocket created here gets its kind's default emoji, which `useEmoji` already picks. The emoji can be changed later on the Pockets page.

### Transfer

With fewer than two pockets, the fields under Type are replaced by `Blocked` reading "A transfer needs two pockets", with the link "Go to Pockets" to `/pockets`. This works the same way as the expense's "Add a subsection first".

### Kept as they are

Imported transactions, editing, the order of the fields, and every other behaviour stay as they are. If the pocket is created and the transaction then fails, the new pocket stays chosen as a chip (spec 02).

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Update the existing tests that click "+ Add pocket" or "+ Add source", or that fill the panel's emoji, on an account with none yet. The helpers in `e2e/support/` probably do this.

Tests:
- **The first income:** on a new account, the income dialog has no "+ Add source" or "+ Add pocket" chip. Filling "Source", "Pocket" and the amount saves, and creates the source and the pocket, with the bank emoji.
- **With existing sources and pockets:** "+ Add source" and "+ Add pocket" still work, and show no emoji grid.
- **A transfer with one pocket** shows "A transfer needs two pockets".
- **The name error:** an empty pocket name shows its error under "Pocket".

Screenshots: the first income dialog and the "+ Add pocket" case, light and dark, desktop and phone.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. A new account's first income dialog shows Type, Date, Amount, Source, Pocket, Kind, Note, Tags, and nothing else, and fits a 900px-tall window without scrolling.
3. The transaction dialog never shows the emoji grid.
