# Tabs

Page tabs in the top bar: they split one page into a few views (Reports: Cash flow, Spending, Net worth).

- A `ty-tabs` row with `role="tablist"` and an `aria-label`; each tab is a `ty-tab` link with `role="tab"` and `aria-selected`. Text at 14px 500 in `ink-muted`; the selected one is `ink` with a 2px `brand` underline. No boxes, no pills.
- Each tab has an `id` (`tab-cash-flow`) and `aria-controls="tabpanel"`; the content is one `role="tabpanel"` (`ty-panel`) with `id="tabpanel"` and `aria-labelledby` the selected tab. On phones the selected tab is scrolled into view and `scroll-margin-inline` keeps it off the screen edge.
- Only the selected tab is in the tab order (`tabindex="0"`, the others `-1`). Left and Right arrows move between tabs and select; Home and End go to the first and last. Moving focus shows that tab's content at once.
- The selected tab is in the URL as `?tab=` (the lower-case name with dashes: `?tab=cash-flow`), so a reload or a shared link opens the same tab. With no `?tab=` the first tab is selected.
- In the top bar the tabs sit right after the title and fill its height, so the underline touches the bar's lower edge. On phones they are a sideways-scrolling row under the title, each 44px tall.
- Use tabs for views of the same thing, never for steps or filters. Two to four tabs.
