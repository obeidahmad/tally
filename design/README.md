# Tally design system

This folder is the design reference for Tally. Build the interface from it and do not invent colours, sizes or components.

- `tokens.json` holds every colour (light and dark), type style, spacing step and corner radius, each with a note on where it is used. `tokens.css` is the same as CSS variables and type classes.
- `components.css` holds the classes for every component.
- `components/<Name>/README.md` says when to use a component and what to give it. `components/<Name>/preview.html` is its reference markup: open it in a browser, or copy its structure. `BudgetScreen`, `BudgetPhone`, `TransactionsScreen` and `PocketsScreen` are whole pages.
- The app loads IBM Plex Sans and Bricolage Grotesque from npm packages so it works offline. Only the preview pages here link Google Fonts.
- The figures in the previews are examples.

The rules below apply to every screen.

Tally is a self-hosted budgeting app for a household. Its screens should feel familiar to anyone who has used YNAB, Monarch or Rocket Money: a sidebar, a grouped budget table, cards for accounts, a day-grouped transaction list. Its own identity is restraint: the interface is ink on paper, and colour appears only where it says something about money. Compose every screen from these rules.

## Content fundamentals

- Write short, plain sentences in sentence case. Buttons are verbs that say what happens: "Add transaction", "Close month", "Import a statement".
- Use the app's own nouns and never rename them: section, subsection, pocket, source, step, destination, left over, rest, rollover, cap, income, base currency. A section is a group such as Needs. A subsection is a line inside it such as Food. A pocket is where money sits. A destination is a section that a step sends money to.
- Write amounts with two decimals and thousands separators and no currency symbol: `1,175.00`. Add the currency code only when the amount is not in the base currency: `1,240.00 USD`, with `≈ 1,141.80 EUR` under it.
- Money out carries a minus sign (`−48.20`). Money in carries a plus sign.
- State a rule in words next to the thing it governs: "rolls over up to 100.00", "1,950.00 left", "60% of what is left".
- Say where a figure came from: "From your bank", "Entered by hand", "Synced 2 hours ago".
- An error sits under its field and says what to do: "The cap must be at least the monthly budget."
- Dates read "11 October" in lists and "October 2026" for a month.
- The app's own words never use emoji. The one place emoji appear is as the mark a person picks for a pocket, always next to that pocket's name.

## Visual foundations

- **Ground and surfaces.** The page is `bg`. Cards, tables, the sidebar and dialogs are `surface` with a 1px `line` outline and `radius-lg`. Section header rows and neutral pills are `surface-sunken`. Cards are flat; only dialogs and menus take `shadow-raised`.
- **Ink is the brand.** Text is `ink`, secondary text `ink-muted`. The one primary button per view is `action` with `on-action` text. There is no brand hue.
- **Colour means money.** `positive`, `warning` and `negative` describe a money state and nothing else: text on their `-soft` fills in a Pill, and the meter fill. Each is always paired with a sign or a word ("over", "left"), never colour alone.
- **Two buttons carry colour.** The buttons that record money moving are filled: `income` (green) for "Add income" and `spend` (orange) for "Add transaction", both with `on-money` text, which is dark in both themes. Spending is orange, not red, because it is an ordinary act: red stays for overspending and errors. Where a page has the spend button it takes the place of the primary button. Nothing else uses these two fills.
- **Section colours.** Each section takes the next of `sec-1` to `sec-8` in the order it was created and keeps it for good. The colour appears as the section's dot and its allocation segment, never as text and never as a fill behind text. A ninth section folds into Other in `ink-muted`. Keep the order: it is what keeps neighbouring segments distinguishable for colour-blind readers.
- **Type.** IBM Plex Sans for everything, Bricolage Grotesque for the wordmark, the page title (`text-display`) and the one headline figure (`num-hero`). Column and field labels are `text-label`, uppercase, `ink-muted`.
- **Numbers.** Amounts use `num` with tabular figures and are right-aligned in columns. A pocket balance or month stat uses `num-lg`. One `num-hero` per page at most.
- **Controls.** Buttons are 40px tall with `radius-md`; inputs are 40px with `radius-sm` and a `line-strong` border. Pills, dots and meters are `radius-pill`. A segmented control is a 40px `surface-sunken` track with `radius-md`; its chosen segment is `surface` outlined in `ink`. On phones buttons, chips and segmented controls grow to 44px.
- **Focus.** Every focusable control shows a 2px solid `focus` outline with a 2px offset. A row inside a section (`ty-brow`, `ty-trow`) draws the same outline 2px inside its edge instead, because the section clips whatever reaches past it.
- **Spacing.** Rows pad `space-3` by `space-4`. Cards pad `space-5`. Page blocks are `space-6` apart on desktop and `space-5` on phones.
- **Meters.** 6px tall on a `line` track. The fill is `positive`, `warning` above 90% and `negative` when over. A savings goal's fill is `ink`.
- **Materials.** Only phone chrome is translucent: the top bar and tab bar are `glass` with a 20px blur and content scrolls under them; a bottom sheet is `glass-thick` with a 30px blur. Text on glass is `ink`, never `ink-muted`. Never put glass on glass. Cards, tables, the sidebar and desktop dialogs stay opaque `surface`.
- **Text size.** Type, spacing and control sizes are in `rem`, so the layout grows with the reader's text-size setting. Large type is tracked tighter (`text-display`, `num-hero`); `text-label` is tracked wider; body text is left at zero.

## Motion and interaction

- **Respond on press.** A button scales to 0.97 within 100ms of the pointer going down; a row darkens to `surface-sunken`. Never wait for release to show that a press registered.
- **Plain transitions by default.** Colour, opacity and expand or collapse take 150ms ease-out. Nothing bounces. A desktop dialog fades in; it does not spring.
- **One spring: the phone sheet.** It tracks the finger 1:1 from where it was grabbed, can be caught mid-flight, and on release continues at the finger's speed toward where the flick was heading. Use a critically damped spring (no overshoot), with a slight bounce only after a flick. Past its top edge it resists instead of stopping dead.
- **Same way out as in.** A sheet that rose from the bottom leaves through the bottom. A section collapses back into its header.
- **Never block input during a transition.**
- **Four kinds of feedback.** Status (Open, Synced 2 hours ago), completion (a short confirmation after saving), warning (a `warning` pill before the money runs out), error (under the field, as it is typed).
- **Undo over confirm.** Deleting a transaction, a subsection, a section or a pocket happens at once and a `Toast` offers Undo. Only closing a month and deleting an account ask first. Anything that still has transactions cannot be deleted, and the dialog says so.
- **Reduced motion** replaces the sheet's slide and every scale with a short fade. **Reduced transparency** and **more contrast** make glass solid `surface`; more contrast also draws outlines in `line-strong`.

## Layout

- **Desktop.** A 220px sidebar with the wordmark, Budget, Pipeline, Transactions, Pockets, Investments and Settings. The page starts with its title and its actions on one line, primary button rightmost.
- **Phone (up to 640px).** One column with `space-4` gutters, a translucent top bar holding the page title and its primary action, and a bottom tab bar with Budget, Transactions, Pockets and More. Budget rows drop the Budgeted and Spent columns and say the same in one line under the meter, and a section header does the same under its name. Dialogs become bottom sheets.
- **Budget page order.** MonthHeader, then a SectionGroup per section in the order they were created. How income reaches the sections is set on the Pipeline page.

## Iconography

Tally has no icon set and no logo yet. The wordmark is the name set in Bricolage Grotesque Bold. Navigation is text only. The only glyphs are `‹` and `›` for previous and next. The tally-mark motif on the cover is decoration for the cover only.

Pocket marks are emoji drawn in Noto Emoji at weight 700 (`ty-emoji`): thick, rounded, single-colour line drawings in `ink`, so they sit with the type instead of adding colour. A person picks one of 32 in the `EmojiPicker`. The app loads the font from an npm package like the other two faces.

## Components

`Button`, `Field`, `Pill`, `Amount`, `BudgetRow`, `SectionGroup`, `MonthHeader`, `AllocationBar`, `PocketCard`, `TransactionRow`, `Dialog`, `Toast`, `AppShell`. Also `Segmented`, `Chips`, `EmojiPicker`, `TransactionDialog`, `SectionDialog` and `StepDialog`. They are plain HTML with the classes in `components/bundle.css`; there is no script. Four screens show them composed: `BudgetScreen`, `BudgetPhone`, `TransactionsScreen`, `PocketsScreen`. `PipelineScreen` is the Pipeline page. `PipelineNextMonth` is the Pipeline page once months close. The figures on the screens are examples.
