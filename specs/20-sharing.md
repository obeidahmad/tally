# Spec 20: Sharing a budget between partners

Follows specs 01 to 19, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`, "Later": sharing one budget between partners. Two people on the same server work on one budget together, each signing in with their own account.

## Out of scope

- Inviting someone who has no account on the server (the owner of the server creates accounts, as now).
- Read-only access or per-section permissions: a member can do everything the owner can in the budget, except what is listed below.
- Merging two existing budgets into one.

## Shared contract

### Model

- Every person's data stays theirs, keyed by their user id as now. That set of data is **their budget**.
- A person (the **owner** of a budget) can add other people on the server as **members** of it. A member can switch to view that budget; while they do, every data route acts on the owner's data exactly as if the owner made the request, with these exceptions:
  - Sharing settings of that budget, bank connections (spec 17) and the Trading212 connection (spec 16) belong to the owner: their routes answer 403 `owner_only` "Only {owner's display name} can change this." for a member viewing it. A member's own versions of them apply to the member's own budget only.
  - `/api/me` and the password routes stay the member's own.
- The budget's base currency is the owner's.
- `users` gains `viewing_owner_id` (null: their own budget). Every request resolves the acting budget: the viewing owner if that person still lists them as a member, otherwise their own (and `viewing_owner_id` is cleared).
- Every transaction gains `createdBy` (the user id who created it; existing ones: the owner). `Transaction` in the API gains `createdBy` and `createdByName`.

### Routes

| Route | Body | Success |
|---|---|---|
| `GET /api/sharing` | | 200 `{ members: [{ id, displayName }], sharedWithMe: [{ ownerId, displayName }], viewing: ownerId \| null }` (members of the person's own budget; budgets shared with them) |
| `POST /api/sharing/members` | `{ username }` | 201 `{ member }`. 400 on `username`: "There is no account with this username." / "You cannot add yourself." / "This person is already a member." |
| `DELETE /api/sharing/members/:id` | | 204; that person stops viewing it at once |
| `POST /api/sharing/view` | `{ ownerId \| null }` | 200 `{ viewing }`; 400 on `ownerId` "Choose a budget shared with you." |
| `DELETE /api/sharing/shared/:ownerId` | | 204: the member leaves that budget |

`GET /api/auth/state` and `/api/me` gain `viewing: { ownerId, displayName, baseCurrency } | null`.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Migration `014_sharing.sql`. Data stays keyed by `user_id`; the acting budget is the owner's user id, resolved once in the auth middleware into something like `req.budgetId`, and every data, bank, broker, recurring, import, rules and reports query uses it (bank, broker and sharing routes use the real user and refuse a member as the contract says). Resolve the acting budget in one place (the auth middleware) and make every data query use it, so no route can forget. Tests: adding, removing and leaving; a member reading and writing the owner's budget through each data route family (sections, pockets, transactions, pipeline, months, moves, holdings, imports, rules, reports); the owner-only routes answering 403 for a member; `createdBy`; a removed member's next request acting on their own budget; a third person seeing neither; the base currency.

## UI

Owner: `ui-dev`. Paths: `web/**`. No new design component.

- **Settings, "Sharing" card:** "Share this budget with" (a text field for a username) and "Add"; the members listed with "Remove". Under them, "Budgets shared with you" with each owner and "Leave".
- **Switching:** when anything is shared with the person, the sidebar shows a "Budget" select above the navigation ("Your budget", then each owner's display name). On phones it sits at the top of Settings. Switching reloads the page's data. While viewing someone else's budget, the sidebar's foot reads "Signed in as Alex · viewing Sam's budget" — written "viewing the budget of Sam" to avoid possessives.
- **Transactions:** a row created by someone other than the viewer adds "· entered by Sam" to its second line.
- **Owner-only cards** (bank connections, Trading212, sharing) show for a member viewing another budget: "Only Sam can change this." and no controls.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Two people in two browser contexts: Sam shares with Alex; Alex switches, adds a transaction and a section; Sam sees both, with "entered by Alex"; Alex cannot see Sam's bank card controls; Sam removes Alex, whose next page load shows their own budget. Screenshots light and dark, desktop and phone, of the Sharing card and the switcher.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. A member works on the owner's budget through every page, and the owner sees their changes.
3. Bank, broker and sharing settings stay the owner's.
4. Removing or leaving takes effect on the member's next request.
5. A person with no share sees no switcher and nothing of anyone else's.
6. The backend tests cover every rule in the contract.
