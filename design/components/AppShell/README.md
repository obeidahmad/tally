# AppShell

The frame around every page. Provide the active page, its title, its tabs and actions, and the page content.

- **Sidebar** (220px, `bg`, no border): the logo (an orange `brand` mark with white tally strokes, then "Tally" at 600), then the nine pages: Home, Budget, Pipeline, Transactions, Recurring, Pockets, Investments, Reports, Settings. Each item (`ty-nav` link) is 36px tall with an 18px stroke icon (`ty-icon`: inline svg, 1.5px stroke, no icon library) and a 14px 500 label; the active one (`aria-current="page"`) has a `surface-hover` background and a 6px radius. The footer holds the person's name, a "Sign out" link, and an icon button "Switch to dark mode" (a moon) or "Switch to light mode" (a sun) that switches the theme and remembers it.
- **Top bar** (`ty-top`, 56px, sticky, `bg`): the page title (`text-display`, 20px 600, one `h1`), then the page tabs (see Tabs), then the page's actions on the right (`ty-top__actions`). Actions are outline buttons of 32px, with at most one `ty-btn--primary`. A month stepper is `ty-monthnav`: quiet ‹ and › icon buttons around "October 2026".
- **Page** (`ty-main`): 24px padding, up to 1264px wide, cards 16px apart.
- **Phone** (up to 640px): no sidebar. The top bar is `glass` with a blur: the title on the left, the primary action shortened to one word ("Add", the full name as `aria-label`) on the right, and the tabs as a sideways-scrolling row under the title. Add `ty-wide` to the actions that do not fit. The bottom tab bar (`ty-tabbar`, `glass`) holds Home, Budget, Transactions, Pockets and Settings, each a 22px icon over an 11px label; the active one has a `primary` icon and a 600 label. Pipeline has no phone layout.
- **Theme.** The page follows `data-theme="light"` or `"dark"` on `html`; without it, light.
- The frame fills the height of the window, so the page background always reaches the bottom.
