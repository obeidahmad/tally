# Spec 21: A compact, columnar look

Follows specs 01 to 20, which stay the reference for everything not changed here. Nothing about the data changes; this spec is the look only.

## Goal

The user, after using Tally with their real data:
- It looks nothing like YNAB or Monarch, which they asked for at the start.
- Everything is too big, and they scroll for ages.
- The empty bar under each subsection makes no sense.
- Figures are written as small notes next to a name ("44.45% of what is left · +1,562.94 from September") instead of sitting in columns.
- Monarch (monarch.com) is the reference for how it should feel: calm, light, dense and tidy.

So:
- One type and spacing scale, about a quarter smaller.
- Cards that read like Monarch's.
- The Budget page as one table with a column for every figure, as YNAB and Monarch do.
- The same density on every page.

## Out of scope

- New figures or features, colour changes beyond the surfaces below, a logo, emojis on subsections, and charts on the Budget page.
- Changing any route or any data.

## Design system

Owner: `ui-dev`. The design system has a generator at `C:\Users\obeid\AppData\Local\Temp\claude\C--Users-obeid-Projects-Tally\99527cd6-e112-4e05-9759-0e767b8e836f\scratchpad\ds-build\build.js`, changed so far by `patch17.js` to `patch21.js` in the same folder.
- Write `patch22.js` the same way and run it.
- Rebuild with `node build.js ../tally-ds`.
- Export with `node export-to-repo.js ../tally-ds/project C:\Users\obeid\Projects\Tally\design`.
- Never edit `design/` by hand.
- The boss publishes the review page afterwards.

### Type and controls

| Style | Now | New |
|---|---|---|
| `text-display` (page title) | 32/36 | 24/30 |
| `text-title` | 20/28 | 17/24 |
| `text-heading` | 16/22 | 14/20, 600 |
| `text-body`, `num` | 15/22 | 14/20 (`num` keeps tabular figures) |
| `text-caption` | 13/18 | 12/16 |
| `text-label` | 12/16 | 11/14 |
| `num-lg` | 26/32 | 20/26 |
| `num-hero` | 44/48 | 32/38 |

- **Sizes:** buttons and inputs are 36px tall and `ty-btn--sm` 28px. On `(pointer: coarse)` every control and every row keeps a hit area of at least 44px, through padding or `min-height`.
- **Spacing:**
  - the page gutter is 24px on desktop (16px on phones);
  - card padding is 16px;
  - the gap between cards is 16px;
  - the page content is at most 1200px wide.

### Surfaces (the Monarch feel)

- **Light mode:** the page background is the sunken surface. Cards are the raised white surface with no outline, a 12px radius, and a soft shadow, the new token `shadow-card`: `0 1px 2px rgba(20,26,24,0.06), 0 1px 3px rgba(20,26,24,0.08)`.
- **Dark mode:** cards are one surface step above the page, with the existing faint line and no shadow.
- `shadow-raised` stays for dialogs and menus. Cards stay opaque, as the design skill says.

### Rows

- **Height:** a table row is 40px on desktop, 44px on phones. Content is centred vertically and separated by the `line` colour, with a 150ms hover background.
- **Second lines:** a row has a second line only when it has a second fact to show. Never a placeholder.
- **Meters:** a meter (progress bar) only appears where it shows something that is not already a column figure: savings-goal progress, and the Reports charts. Remove it from budget rows.

### New component `BudgetTable`

It replaces `BudgetRow` and `SectionGroup` on the Budget screens. It is one card holding every section.

- **Column header:** one header row at the top of the card, sticky under the top bar, in `text-label`. Desktop columns:

  | Column | Content |
  |---|---|
  | **Subsection** | The name, plus the "Edit" control for section rows. |
  | **Rule** | "44.45%" or "Fixed" for a spending subsection, "Goal 15,000.00" for a savings goal; in `ink-muted`. |
  | **From last month** | The carried amount, negative for a debt; "—" when 0. |
  | **Moved** | Shown only when the month has a move; "—" when 0. |
  | **Budgeted** | |
  | **Spent** | |
  | **Available** | Budgeted + from last month + moved − spent, as a `Pill`: positive, warning when 0 < left < 10% of the total, neutral at 0, negative below 0. For a savings goal, the saved amount, and "42%" in the Rule column after the target. |

- **Section row:** a disclosure chevron button that collapses the section (`aria-expanded`; remembered per section in `localStorage`, wrapped in try/catch), then the colour dot, then the name in `text-heading`. The section's totals sit in each figure column in 600 weight, on the `surface-sunken` background.
- **Rest row:** the last row of each section, labelled "Rest". It shows where the rest goes in the Rule column ("to next month's income" or "kept in {section}"), and the rest in the Available column as a `Pill`. It replaces today's "Rest" pill next to the section name.
- **"Add subsection":** a quiet button row of 36px at the end of each section.
- **Phones (< 640px):** the columns are Subsection, Spent and Available. The others are in the subsection dialog, which already shows them. Every row stays tappable as now.

### Budget screen layout

- **Header:** one 48px row with ‹, the month in `text-display`, › and the state pill on the left. On the right, "Add income" and "Add transaction" (the existing colours).
- **Wide screens (≥ 1100px):** two columns, `BudgetTable` on the left and a 300px aside on the right.
  - The aside's first card is the month summary, in label-left and amount-right rows: Income, Budgeted, Spent, Left over. Under them in `ty-cap` comes the existing "left over" sentence. Then the "Close {month}" button and the reminder when they apply.
  - Below it, "Moved this month" when there are moves.
- **Narrower:** the summary becomes one row of four compact stats (`text-label` over a 18px `num`) above the table, and "Moved this month" goes below the table.

### Other screens

- **`TransactionsScreen`:** one card.
  - Sticky date header rows, 32px, in `text-label` ("FRI 16 OCT").
  - Rows of 44px: the payee in `text-body` 500, the subsection with its dot, the pocket with its emoji, and the amount right-aligned (income in `positive`).
  - The phone layout puts the subsection under the payee in `ty-cap`.
- **`PocketsScreen`:**
  - Net worth in `num-hero`.
  - The pockets as one card of 48px rows: emoji, name, kind in `ty-cap`, and balance right-aligned. Where its money sits stays behind the row's tap, as now.
- Update `BudgetScreen`, `BudgetPhone`, `TransactionsScreen` and `PocketsScreen`, and the README's component list. Keep the examples' figures.

## UI

Owner: `ui-dev`. Paths: `web/**`, plus the design system above. Do the design system first, then the app, so the app uses only design classes.

- **Budget page:** build it to `BudgetTable` and the layout above. Every fact the current notes show keeps a home:
  - the percentage → Rule;
  - "+x from September" → From last month;
  - "x moved" → Moved;
  - "rolls over up to x" / "does not roll over" / "fills to x" → the Rule cell's `title` and the subsection dialog;
  - where its money sits → the row's dialog, as now;
  - "x of y spent" → gone, since the columns say it.
- **Transactions, Pockets:** build them to their screens above.
- **Every other page** (Pipeline, Recurring, Investments, Reports, Settings, Entry): the new scale, cards and row rules. Remove empty lines and placeholder meters. Keep any page title in `text-display`.
- Phone layout, accessibility (labels, focus rings, keyboard, reduced motion) and every existing behaviour stay as they are.

## Browser tests

Owner: `tester`. Paths: `e2e/**`.
- Update the existing tests whose selectors or text this changes, keeping what each test checks.
- New tests:
  - the Budget table's columns show the right figures for a subsection with a percentage, a carry and a move;
  - the Rest row;
  - collapsing a section, and it staying collapsed after a reload;
  - the phone columns.
- Screenshots light and dark, desktop and phone, of Budget (with enough subsections to scroll), Transactions and Pockets. Report the Budget page's height at 1280×800 with 5 sections and 23 subsections.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. A budget row has no empty bar and no notes beside its name. Every figure sits in its column.
3. With 5 sections and 23 subsections, the Budget table at 1280 wide is at most about 1.3 screens tall (40px rows).
4. Light mode reads like Monarch: soft grey page, white cards without outlines, soft shadow. Dark mode is coherent with it.
5. The design system in `design/` matches the app, and every existing behaviour still works.

## Decisions after the first test round

These replace the matching lines above.

- **Fewer rows:**
  - There is no "Add subsection" row. The section row carries two icon buttons after the name: a pencil "Edit {section}" and a plus "Add subsection to {section}", each with an accessible name and a 28px icon (44px hit area on touch).
  - The Rest row stays.
  - Acceptance criterion 3 becomes: the table holds only the header, section rows, subsection rows and Rest rows, each 40px tall (44px on phones). With 5 sections and 23 subsections that is 34 rows.
- **No meter on Budget rows at all, goals included.** A goal's progress is the "· 42%" in its Rule cell. Meters stay on Home's goals card (spec 26) and in Reports.
- **Held holdings:** "paid {x} · worth {y}" for a subsection holding investments shows in the subsection dialog, beside where its money sits, and in the Rule cell's `title`.
- **The aside** appears from a 1464px viewport, so a 1280 laptop gets every column. The stat label is "Spent" in both the aside and the stats row.
- **The page content** is at most 1264px wide, which leaves room for the aside.
- **The light page background** is `bg` `#f3f5f1`. The sunken surface failed the 3:1 contrast checks for buttons on the page.
- **Header labels** fit on one line. "From last month" is labelled "Carried" in the header, with `title` "From last month".
- **The Available pill** shows the amount only. Its accessible name and `title` read "{amount} left" or "{amount} over". A positive Rest pill uses the positive state.
- **A row height includes its separator:** 40px or 44px in total, the 1px line included.
- **No filler second lines anywhere:**
  - A transaction row has a second line only for a note, a conversion, or where it came from when it was imported or synced ("From Revolut", "Imported 16 Oct"). "Entered by hand" is never shown on a row.
  - The same goes for pocket rows.
- **Phones:** a section row never clips its name. The name takes the free width and the icon buttons stay icon-only.
- **Section row totals** are the sums of the rows below them: Budgeted and Spent sum its subsections, and Available sums its subsections' available plus the Rest.
- **Dark mode:** a section row sits one surface step above the card.
- **Source lines:** a transaction's source line reads "From a statement", "From your bank" or "From Trading212".
