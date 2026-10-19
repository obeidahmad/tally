# Tally design system

This folder is the design reference for Tally. Build the interface from it and do not invent colours, sizes or components.

- `tokens.json` holds every colour (light and dark), type style, spacing step and corner radius, each with a note on where it is used. `tokens.css` is the same as CSS variables and type classes.
- `components.css` holds the classes for every component.
- `components/<Name>/README.md` says when to use a component and what to give it. `components/<Name>/preview.html` is its reference markup: open it in a browser, or copy its structure. `BudgetScreen`, `BudgetPhone`, `TransactionsScreen` and `PocketsScreen` are whole pages.
- The app loads IBM Plex Sans and Noto Emoji from npm packages so it works offline. Only the preview pages here link Google Fonts.
- The figures in the previews are examples.

The rules below apply to every screen.

Tally is a self-hosted budgeting app for a household. Its screens should feel familiar to anyone who has used Monarch, YNAB or Rocket Money: a sidebar with icons, tabs under a page title, white cards on a warm page, colour in figures and charts. Compose every screen from these rules.

## Content fundamentals

- Write short, plain sentences in sentence case. Buttons are verbs that say what happens: "Add transaction", "Close month", "Import a statement".
- Use the app's own nouns and never rename them: section, subsection, pocket, source, step, destination, left over, rest, rollover, cap, income, base currency. A section is a group such as Needs. A subsection is a line inside it such as Food. A pocket is where money sits. A destination is a section that a step sends money to.
- Write amounts with two decimals and thousands separators and no currency symbol: `1,175.00`. Add the currency code only when the amount is not in the base currency: `1,240.00 USD`, with `≈ 1,141.80 EUR` under it.
- Money out carries a minus sign (`−48.20`). Money in carries a plus sign.
- State a rule in words next to the thing it governs: "rolls over up to 100.00", "1,950.00 left", "60% of what is left".
- Say where a figure came from: "From your bank", "Entered by hand", "Synced 2 h ago", "Reconciled 16 Oct".
- An error sits under its field and says what to do: "The cap must be at least the monthly budget."
- Dates read "Sunday, 18 October" in day headers, "11 October" in lists and "October 2026" for a month.
- The app's own words never use emoji. Emoji appear only as the mark a person picks for a pocket or a subsection, next to its name.

## Visual foundations

- **Ground and surfaces.** The page and the sidebar are `bg`, a warm off-white. Cards, tables and dialogs are white `surface`, 8px radius (`radius-md`), no border in light mode and the very soft `shadow-card`. In dark mode cards sit one step above the page and `shadow-card` draws a 1px `line` instead. Table heads, date rows and group headers are `surface-sunken`. Only dialogs and menus take `shadow-raised`.
- **Small radii.** 6px (`radius-sm`) for buttons, inputs, selects, segmented controls and chips. 8px for cards, dialogs and menus. Fully round (`radius-pill`) only for status pills, tag pills, avatars and dots. No pill-shaped buttons.
- **Colour.** The brand orange (`brand`) is the accent: the logo, the active tab underline, today in the calendar. `primary` is the same orange darkened until white text passes 4.5:1, and fills the one primary button per view, a chosen chip and the focus ring. Colour also carries money: `positive` for income and gains, `negative` for expenses in stat cards, overspending and losses, and `link` for quiet links. Each is always paired with a sign or a word, never colour alone. Charts and dots take the section colours.
- **Section colours.** Each section takes the next of `sec-1` to `sec-8` in the order it was created and keeps it for good: blue, amber, magenta, indigo, green, orange, teal, purple. They are the dots, chart marks and Sankey bands, never text. A ninth section folds into Other in `ink-muted`. Keep the order: it keeps neighbouring slots distinguishable for colour-blind readers. Dark mode has its own steps of the same hues.
- **Type.** IBM Plex Sans everywhere. Page title 20/28 at 600, card title 16/22 at 600, section and column labels 11/14 at 600, uppercase, tracked 0.06em, in `ink-muted`; body 14/20; stat figure 24/30 at 600; hero figure 30/36 at 600. Figures are tabular.
- **Numbers.** Amounts use `num` with tabular figures and are right-aligned in columns. A headline amount uses `num-lg`. One `num-hero` per page at most.
- **Controls.** Outline buttons and inputs are 32px tall in the top bar and the filter row, 36px in dialogs, 44px on phones and any coarse pointer; outline buttons have a `line-strong` border and text fields a `line-input` border (3:1). One `primary` button per view at most. A segmented control is a `surface-sunken` track whose chosen segment is `surface`.
- **Focus.** Every focusable control shows a 2px solid `primary` outline with a 2px offset. A row inside a card draws the same outline 2px inside its edge instead, because the card clips whatever reaches past it.
- **Spacing and density.** Page padding 24px, card padding 20px, cards 16px apart. Budget table rows 40px, list rows 44px, pocket rows 56px (they have two lines). A row has a second line only when it has a second fact to show.
- **Tabs, not scrolling.** A page with several views puts them in tabs in the top bar, selected in the URL as `?tab=`.
- **Meters.** 6px tall on a `line` track. A meter appears only where it shows something that is not already a column figure.
- **Materials.** Only phone chrome is translucent: the top bar and tab bar are `glass` with a 20px blur and content scrolls under them; a bottom sheet is `glass-thick` with a 30px blur. Text on glass is `ink`. Never put glass on glass. The sidebar, cards, tables and desktop dialogs stay opaque.
- **Light and dark.** The app opens in light. Dark mode is a neutral, slightly warm dark, never green-tinted. The person chooses Light, Dark or Match system in Settings, or flips it with the sidebar button.
- **Text size.** Type, spacing and control sizes are in `rem`, so the layout grows with the reader's text-size setting.

## Motion and interaction

- **Respond on press.** A button scales to 0.97 within 100ms of the pointer going down; a row darkens to `surface-sunken`. Never wait for release to show that a press registered.
- **Plain transitions by default.** Colour, opacity and expand or collapse take 150ms ease-out. Nothing bounces. A desktop dialog fades in; it does not spring.
- **One spring: the phone sheet.** It tracks the finger 1:1 from where it was grabbed, can be caught mid-flight, and on release continues at the finger's speed toward where the flick was heading. Use a critically damped spring (no overshoot), with a slight bounce only after a flick. Past its top edge it resists instead of stopping dead.
- **Same way out as in.** A sheet that rose from the bottom leaves through the bottom. A section collapses back into its header.
- **Never block input during a transition.**
- **Four kinds of feedback.** Status (Open, Synced 2 h ago), completion (a short confirmation after saving), warning (a `warning` pill before the money runs out), error (under the field, as it is typed).
- **Undo over confirm.** Deleting a transaction, a subsection, a section or a pocket happens at once and a `Toast` offers Undo. Only closing a month and deleting an account ask first. Anything that still has transactions cannot be deleted, and the dialog says so.
- **Reduced motion** replaces the sheet's slide and every scale with a short fade. **Reduced transparency** and **more contrast** make glass solid `surface`; more contrast also draws outlines in `line-strong`.

## Layout

- **Desktop.** A 220px sidebar on `bg` with the logo, Home, Budget, Pipeline, Transactions, Recurring, Pockets, Investments, Reports and Settings, each with an icon. A sticky 56px top bar holds the page title, then the page tabs, then the page actions on the right (outline buttons, at most one primary).
- **Phone (up to 640px).** One column with 16px gutters, a translucent top bar holding the page title and its primary action with the tabs as a sideways-scrolling row under it, and a bottom tab bar with icons for Home, Budget, Transactions, Pockets and Settings. The budget table keeps Subsection, Spent and Available. Dialogs become bottom sheets.
- **Budget page.** StatCards, then the BudgetTable (every section, in the order they were created) with a 300px aside on screens from 1464px: the month summary, the close reminder and "Moved this month".
- **Pockets page.** A net worth card with the AreaChart, then AccountGroups on the left and the SummaryCard on the right (on top under 1100px).
- **Reports page.** Tabs Cash flow, Spending and Net worth. Cash flow is four StatCards, the FlowDiagram and the Cash flow bars; Spending is the DonutChart, stacked bars and top payees; Net worth is the AreaChart.

## Iconography

Navigation icons are drawn inline as svg on a 24px grid with a 1.5px round stroke in `currentColor` (`ty-icon`, 18px in the sidebar, 22px in the phone tab bar). There is no icon library. The logo is an orange tile with four tally strokes. Other drawn marks are the paperclip on a transaction with a receipt, the pencil and plus on a section row, and the chevron that collapses a section. The glyphs `‹` and `›` step through months.

Pocket and subsection marks are emoji drawn in Noto Emoji at weight 700 (`ty-emoji`): thick, single-colour line drawings, so they sit with the type. In an account row the emoji sits in a round avatar tinted with its group's colour. A person picks one of 32 in the `EmojiPicker`.

## Components

`Button`, `Field`, `Pill`, `Amount`, `Tabs`, `StatCards`, `BudgetTable`, `TransactionList`, `AccountGroups`, `SummaryCard`, `AreaChart`, `DonutChart`, `FlowDiagram`, `Dialog`, `Toast`, `AppShell`. Also `FilterBar`, `SplitParts`, `TagInput`, `ReceiptList`, `HomeCards`, `BillsCalendar`, `Segmented`, `Chips`, `EmojiPicker`, `TransactionDialog`, `SectionDialog`, `StepDialog` and `RestDialog`. They are plain HTML with the classes in `components.css`; there is no script. Screens show them composed: `HomeScreen`, `BudgetScreen`, `BudgetPhone`, `TransactionsScreen`, `PocketsScreen` and `ReportsScreen`. `PipelineScreen` is the Pipeline page and `PipelineNextMonth` the Pipeline page once months close. The figures on the screens are examples.
