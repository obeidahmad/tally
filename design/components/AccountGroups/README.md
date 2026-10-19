# AccountGroups

The Pockets page's groups of pockets. It replaces PocketGroups and PocketCard. Provide the groups (Cash, Investments, Debts) and, for each, its pockets.

- Each group is one `ty-section` card with a header row (`ty-agroup__head`, 56px): a `ty-chev` that collapses it (`aria-expanded`, "Cash pockets"), the group name in `text-title`, and its total on the right (`ty-agroup__total`, 16px 600, in the base currency).
- A pocket row (`ty-arow`, 56px because it has two lines, `role="button"`, opens the pocket's dialog) holds a 36px round avatar (`ty-avatar`) with the pocket's emoji on a tint of its group's colour (`ty-avatar--1` to `--8`, the group's section slot); the name at 500 with the kind in `ty-cap` under it; and the balance right-aligned with "Reconciled 16 Oct" or "Synced 2 h ago" under it.
- A balance in another currency adds the code (`ty-cur`) and, in the note line, the converted value. A debt's balance is negative and `ty-num--neg`.
- Wide layout (`ty-accounts`): the groups in `ty-accounts__main` on the left and `ty-accounts__side` with the SummaryCard on the right, 320px wide. Under 1100px it is one column and the summary goes on top.
