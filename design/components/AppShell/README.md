# AppShell

The frame around every page. Provide the active page and the page content.

- Desktop: a 220px sidebar on `surface` with the wordmark, the six pages (Budget, Pipeline, Transactions, Pockets, Investments, Settings) and the signed-in person. Content sits on `bg` with `space-6` gutters.
- Phone (up to 640px): the sidebar is replaced by a bottom tab bar with Budget, Transactions, Pockets and More. The Pipeline page has no phone layout yet and is not in the tab bar.
- The active page uses `aria-current="page"`.
- On phones every page starts with `ty-topbar`, a translucent bar that stays at the top while the page scrolls under it. It holds the page title in `text-title` and the page's primary action shortened to one word ("Add"), with the full name as its `aria-label`. Where that action is "Add transaction" (Budget and Transactions) the button is `ty-btn--spend`. The Budget page adds the previous and next month buttons around the title. The desktop title row is not shown on phones.
- The frame fills the height of the window, so the sidebar always reaches the bottom.
