# Spec 27: The Monarch look

Follows specs 01 to 26, which stay the reference for everything not changed here. This spec changes only the look. Every figure, route and behaviour stays as it is, except the page tabs and the appearance setting below.

## Goal

The user showed a screen recording of Monarch and said Tally is not similar:
- too rounded and "goofy", and too spaced;
- black and white with no colour;
- no tabs to make pages easy to read;
- a cash flow drawing that is barely readable;
- stuck in an ugly dark mode, with no way to choose light.

They want the same vibe as Monarch. The reference frames are in `C:\Users\obeid\AppData\Local\Temp\claude\C--Users-obeid-Projects-Tally\99527cd6-e112-4e05-9759-0e767b8e836f\scratchpad\video-frames\` (`f00`–`f11.png`: Reports with Cash Flow and Spending tabs, and Accounts). Every UI owner opens them before starting. Match their feel: colour, shape, density, type, chart style. Never copy Monarch's name, logo or wording.

## Out of scope

- New data or new routes beyond the tabs.
- Bank logos, "Share", "Download CSV", "Advice".
- Arranging the dashboard.

## Design system (owner: `ui-dev`, the designer, step 1)

The design system is rebuilt to this look before any page changes.
- **Generator:** `ds-build/build.js` in the scratchpad named above, with a new patch after `patch25.js`.
- **Rebuild and export:** `node build.js ../tally-ds`, then `node export-to-repo.js ../tally-ds C:\Users\obeid\Projects\Tally\design`.
- **Contrast:** check text pairs with the generator's checks (4.5:1 for text, 3:1 for UI). Check the section palette with the dataviz skill's `validate_palette.js` in light and dark.

### Colour tokens

| Token | Light | Dark |
|---|---|---|
| `bg` (page and sidebar) | `#F6F5F2` | `#141416` |
| `surface` (cards) | `#FFFFFF` | `#1D1D20` |
| `surface-sunken` (table heads, date rows, group headers) | `#F4F2EE` | `#19191C` |
| `surface-hover` | `#EFEDE8` | `#26262A` |
| `line` | `#E8E5E0` | `#2C2C31` |
| `line-strong` | `#D6D2CB` | `#3A3A40` |
| `ink` | `#1F1E1C` | `#ECEBE8` |
| `ink-muted` | `#6E6A64` | `#A19D97` |
| `brand` (accents: active tab underline, logo, focus ring) | `#F26A32` | `#F47A45` |
| `primary` (primary button background, white 600 text) | darken from `#D4501C` until white text passes 4.5:1 | same rule |
| `positive` (income, gains, "left") | `#1E8E4E` | `#3BB273` |
| `negative` (expenses in stat cards, overspent, losses) | `#D23B30` | `#F0645A` |
| `link` | `#1C7DA8` | `#5BB6DE` |

- **Section colour slots 1–8**, vivid, used for dots, chart marks and Sankey bands. Start from:
  1. blue `#2F80ED`
  2. yellow `#F2B705`
  3. magenta `#C13B91`
  4. indigo `#4C55D6`
  5. green `#2FA05A`
  6. orange `#F07B2F`
  7. teal `#17A2B8`
  8. purple `#8C5AD8`

  Adjust steps only as far as the validator needs, and give dark mode its own validated steps.
- **Dark mode** is a neutral, slightly warm dark, never green-tinted. Cards sit one step above the page.

### Shape, type and density

- **Radius:** 6px for buttons, inputs, selects, segmented controls and chips. 8px for cards, dialogs and menus. Fully round only for status pills, tag pills, avatars and dots. No pill-shaped buttons.
- **Shadow:** cards have no border in light mode and a very soft shadow, `0 1px 2px rgba(0,0,0,0.05)`. In dark mode they have a 1px `line` border and no shadow.
- **Fonts:** IBM Plex Sans everywhere, so Bricolage Grotesque is removed. Update `.claude/skills/apple-design/SKILL.md` "How Tally uses this skill" to say so, as the user's new choice.

  | Use | Style |
  |---|---|
  | Page title | 20px/28px, 600 |
  | Card title | 16px/22px, 600 |
  | Section and column labels | 11px/14px, 600, uppercase, 0.06em, `ink-muted` |
  | Body | 14px/20px |
  | Figures | tabular |
  | Stat figure | 24px/30px, 600 |
  | Hero figure | 30px/36px, 600 |

- **Controls:** 32px tall in the top bar and filter row, 36px in dialogs. On touch, hit areas are 44px.
- **Spacing:** page padding 24px, card padding 20px, card gap 16px.
- **Rows:** the budget table rows stay 40px, list rows 44px, and pocket rows 56px (they have two lines).

### Components (new or rebuilt, each with README and preview, light and dark)

- **`AppShell`:**
  - **Sidebar** (220px, `bg`):
    - The logo is an orange mark with the word "Tally".
    - Each item has an 18px stroke icon (inline SVG, 1.5px stroke, no icon library) and a 14px 500 label, 36px tall, with an active background of `surface-hover` and a 6px radius.
    - The items are Home, Budget, Pipeline, Transactions, Recurring, Pockets, Investments, Reports and Settings.
    - The footer holds the person's name, "Sign out", and an icon button "Switch to dark mode" / "Switch to light mode".
  - **Top bar** (56px, sticky, `bg`): the page title, then the page tabs, then the page actions on the right. Actions are outline buttons of 32px, with at most one `primary` button.
  - **Phone:** the existing tab bar, restyled with icons. The page tabs become a sideways-scrolling row under the title.
- **`Tabs`:**
  - Text tabs of 14px 500 in `ink-muted`. The active one is `ink` with a 2px `brand` underline, as in the frames.
  - `role="tablist"`, with arrow-key navigation.
  - The selected tab is in the URL as `?tab=`.
- **`StatCards`:** a row of 2–4 equal white cards with the figure centred (stat figure size) and the label under it in label style.
  - The figure takes `positive` for income, `negative` for expenses, and `ink` otherwise.
  - On phones they show two per row.
- **`BudgetTable`:** the same structure, restyled.
  - The section header row is `surface-sunken`, with a 10px section-colour dot and the name at 600.
  - The Available pill is tinted: `positive` text on a 12% `positive` background, `negative` on a 12% `negative` background, and neutral grey at 0.
- **`TransactionList`:** like the frames.
  - A date header row (`surface-sunken`, 36px) holds "Sunday, 18 October" on the left and the day's total on the right.
  - Rows are 44px: payee at 500, subsection (emoji and name), pocket (emoji and name), and the amount right-aligned (income in `positive` with "+"), then a chevron.
  - It replaces `TransactionRow`'s look.
- **`AccountGroups`** (Pockets):
  - Group cards with a chevron to collapse, the group name at 600, and the total on the right.
  - Rows show a 36px round avatar with the pocket's emoji on a tint of its group colour, the name at 500 with the kind in muted text under it, and the balance right-aligned with "Reconciled 16 Oct" or "Synced 2 h ago" under it.
  - A right column holds the `SummaryCard`.
- **`SummaryCard`:** "Assets {total}" with a 8px stacked bar of the groups' shares in their colours and a legend list (dot, name, amount). "Debts {total}" works the same way.
- **`AreaChart`** (net worth): a 2px line in teal (slot 7) with a soft fill from 25% to 0% under it, a recessive grid, axis labels at 11px, and a hover crosshair with a tooltip. Above it sits the figure (hero size) and "↑ {change} ({pct}) since {month}" in `positive` or `negative`.
- **`FlowDiagram`** (Sankey), rebuilt to read like the frames:
  - **Size:** the full card width; height = max(480px, 34px × the number of nodes in the busiest column).
  - **Columns:** sources ("From last month" included) → one "Income" node holding the total → sections and "Left over" → subsections and "Kept".
  - **Nodes:** solid 10px-wide bars. Sources are teal, "Income" is green, sections use their colour, subsections their section's colour, and "Left over" and "Kept" are neutral grey.
  - **Bands:** a gradient from the source node's colour to the target's at 30% opacity, with no stroke. Hovering or focusing a band darkens it and shows a tooltip "{from} → {to}: {amount}".
  - **Labels:** two lines, the name (13px 500 `ink-muted`, emoji first) and "{amount} ({pct}%)" (14px 600 `ink`), where pct is a share of total income.
    - The first two columns put them just right of the node bar, over the band.
    - The other columns put them just left of the node bar, right-aligned.
    - A node shorter than 30px shows its label only on hover or focus. Every figure is in the table toggle.
  - **Phones:** sideways scroll inside the card, at a minimum width of 720px.
- **`DonutChart`:** a 220px ring, 28px thick, with segments in section colours separated by 2px `surface` gaps. The centre shows the total at 22px 600 with "Total" under it. The legend is a grid of up to 3 columns: dot, name, then "{amount} ({pct}%)" under it. Hover or focus shows a tooltip.
- **`BillsCalendar`, `FilterBar`, `SplitParts`, `TagInput`, `ReceiptList`, `HomeCards`:** restyle them to the new tokens and shapes.
- **Screens:** rebuild `HomeScreen`, `BudgetScreen`, `TransactionsScreen`, `PocketsScreen`, a new `ReportsScreen` (the Cash flow tab) and `BudgetPhone` to the new look.

## UI (step 2, after the design system; two `ui-dev`s in parallel)

Pages are built only with design-system classes. No page-level CSS beyond layout glue.

### `ui-dev` A: shell and core pages

- **Shell:** the sidebar with icons, the top bar with title, tabs and actions on every page, and the phone tab bar.
- **Appearance:**
  - **Setting:** Settings has an "Appearance" choice: "Light", "Dark" or "Match system". The default is **Light**.
  - **Storage:** the choice is stored in `localStorage` `tally.theme` (inside try/catch), and an inline script in `web/index.html` applies `data-theme` on `<html>` before the first paint, so there is no flash.
  - **Sidebar toggle:** the icon button in the sidebar footer switches between light and dark and stores the choice.
- **Home:** the existing cards in the new style. Card titles get a quiet "View all" link where a page exists.
- **Budget:**
  - Top bar: title "Budget", the month ‹ › on the right, and "Add income" (outline) and "Add transaction" (primary).
  - `StatCards`: Income, Budgeted, Spent, Left over.
  - Then `BudgetTable` and the aside as today.
- **Transactions:** `TransactionList` with the filter row restyled. The top bar's actions are "Import a statement" (outline) and "Add transaction" (primary).
- **Pockets:**
  - Top bar: title "Pockets" with "Transfer" (outline) and "Add pocket" (primary).
  - A net worth card with `AreaChart` over `GET /api/reports?months=` (a `Segmented` "3M", "6M", "12M", "24M", default 6M).
  - Then `AccountGroups` on the left and `SummaryCard` on the right, at 1100px and wider; the summary goes on top below that.

### `ui-dev` B: tabbed pages and charts

- **Reports** (title "Reports"):
  - **Tabs:** "Cash flow", "Spending" and "Net worth".
  - **Top bar:** the month ‹ › on the right. It drives the Sankey, the donut and the stat cards.
  - **Cash flow tab:**
    - `StatCards` for the chosen month: Total income, Total spending, Net (income − spending), and Savings rate (net ÷ income, one decimal, "—" without income).
    - The `FlowDiagram` card, titled "Where {Month}'s money went".
    - The "Cash flow" bars card (spec 19) with its 3/6/12/24 months control.
  - **Spending tab:**
    - A "Spending by section" card with a `DonutChart` of the chosen month's spending by section and its legend.
    - Under it, the existing stacked bars over time.
    - Then "Top payees".
  - **Net worth tab:** `AreaChart` at full width with a 3/6/12/24 months control, and the table toggle.
  - Every chart keeps "Show as table".
- **Recurring:** tabs "Upcoming" (headline, price-rise banners, "Due in the next 7 days", "All", "Hidden") and "Calendar" (`BillsCalendar`).
- **Settings:** tabs "Account", "People and sharing", "Connections" (Bank connections, Trading212, Import rules) and "Appearance".
- **Investments, Pipeline:** the top bar and the new tokens. The Pipeline diagram takes section colours for its boxes' accents.

## Browser tests (owner: `tester`)

- **Update** the existing tests for:
  - the tabs (Reports, Recurring and Settings content now sits behind tabs, reachable as `?tab=`);
  - the top bar.
- **New tests:**
  - the default theme is light even when the system prefers dark;
  - "Dark", "Light" and "Match system" in Settings, and the sidebar toggle, each surviving a reload;
  - the tabs: click, arrow keys, and `?tab=` on reload;
  - the stat cards' figures;
  - the Sankey: the "Income" node equals total income, every visible label sits inside the card, and no two labels overlap;
  - the donut legend's figures against the table.
- **Screenshots**, light and dark, desktop (1280 and 1600) and phone, of every page.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. The app opens in light mode by default, and the person can choose Dark or Match system, which sticks.
3. Placed beside the reference frames, the Reports Cash flow tab, the Pockets page and the Transactions list have the same feel: warm light page, white cards, colour in figures and charts, small radii, tabs.
4. The Sankey's labels are readable, inside the card, and never overlap.
5. The design system matches the app and is published.
