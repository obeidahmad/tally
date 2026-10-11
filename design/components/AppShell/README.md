# AppShell

The frame around every page. Provide the active page and the page content.

- Desktop: a 220px sidebar on `surface` with the wordmark, the five pages (Budget, Transactions, Pockets, Investments, Settings) and the signed-in person. Content sits on `bg` with `space-6` gutters.
- Phone (up to 640px): the sidebar is replaced by a bottom tab bar with Budget, Transactions, Pockets and More.
- The active page uses `aria-current="page"`.
