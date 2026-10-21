# Spec 13: Moving money

Follows specs 01 to 11, which stay the reference for everything not changed here.

## Goal

From `ROADMAP.md`, "Overspending and moving money": moving money between subsections or sections (for example out of Emergencies) is possible, but as a deliberate advanced action, not a quick one, so the app keeps nudging the person to respect the budget.

- A move takes an amount from a subsection, or from a section's rest, and gives it to another subsection or section's rest, in one month.
- It always asks why, and the Budget page lists the month's moves with their reasons.

## Out of scope

- Moving money between months (closing does that) or between people.
- Moves that change a step, a rest rule or a subsection's settings.
- Any change to pockets or transactions: a move is a change of plan, not of money in a pocket.

## Shared contract

### Objects and routes

```ts
type End = { subsectionId: number } | { sectionId: number };   // a subsection, or a section's rest
type Move = { id: number; month: string; from: End; to: End; amountMinor: number; reason: string };
```

| Route | Body | Success | Notes |
|---|---|---|---|
| `GET /api/moves?month=YYYY-MM` | | 200 `{ "moves": Move[] }` | Oldest first. |
| `POST /api/moves` | `{ month, from, to, amountMinor, reason }` | 201 `{ move }` | |
| `DELETE /api/moves/:id` | | 204 | |

A move in a closed month, or deleting one, answers 409 `closed`: "This month is closed. Reopen it to change it."

### Field rules

| Field | Rule | Message |
|---|---|---|
| `from`, `to` | Each names exactly one of the person's subsections or sections. | "Choose where the money comes from." / "Choose where the money goes." |
| `to` | Not the same as `from`. | "Choose a different place." |
| `amountMinor` | An integer from 1 to 10^13, and at most what `from` has available in that month (a subsection's `availableMinor`, a section's `restMinor`) when that is above zero; when it is zero or below, nothing can be moved from it. | "Enter an amount above zero." / "Emergencies has only 2,400.00 to move." / "Emergencies has nothing to move." |
| `reason` | 1 to 200 characters after trimming. | "Say why you are moving this money." |

### Effect on the month's figures

For each subsection, `movedMinor` = what moves gave it − what they took from it that month. For each section, `movedMinor` = the same for its rest.

- A subsection's money is budget + carried + `movedMinor`. Its `availableMinor`, its overspending and what it keeps at closing (spec 11) use that.
- A section's `restMinor` adds its own `movedMinor`. Its `availableMinor` adds its subsections' and its own `movedMinor`.
- `GET /api/budget` gives every subsection and section its `movedMinor`. The close summary and carries follow from these figures with no other change.

Example: Emergencies (goal, target 3,000.00) has 2,400.00 available; Car has 300.00. Moving 200.00 from Emergencies to Car: Emergencies 2,200.00 available, `movedMinor` −20000; Car 500.00, `movedMinor` 20000. The month's total available does not change.

## Backend

Owner: `backend-dev`. Paths: `server/**`.

1. Migration `007_moves.sql`. Deleting a subsection or section with a move answers 409 `in_use`: "This subsection has money moved this month." / "This section has money moved this month."
2. The routes, rules and figures above.
3. Tests: the example; a move from and to a section's rest; the amount limits; closing after a move (what is kept and the rest); closed months; isolation between two people; every field rule.

## UI

Owner: `ui-dev`. Paths: `web/**`.

No new design component: build it from `Dialog`, `Field`, `Amount`, `Toast` and `BudgetRow`'s note.

- **Where it starts:** the subsection dialog and the section dialog each get a small quiet button "Move money", on the left of the footer next to "Delete", shown only when editing in an open month. It opens the move dialog with "From" set to that subsection, or to that section's rest.
- **Move dialog:** title "Move money in October 2026", and under it in `ty-cap`: "Moving money changes your plan for the month. Do it when you have to, and say why." Fields: "From" and "To" (selects listing, per section in order, "Rest of Needs" then its subsections by position), "Amount" with the base currency code, and "Why" (a text field). Under "Amount" a hint: "Emergencies has 2,400.00. After the move: 2,200.00." The primary button reads "Move 200.00" (or "Move" while the amount is empty). On success: the toast "Moved 200.00" and the page's figures follow.
- **Budget page:** a subsection or section with `movedMinor` not 0 gets the note "−200.00 moved" or "+200.00 moved" (joined with the other notes by " · "). Under the last section, when the month has moves, a card titled "Moved this month" lists them: "200.00 from Emergencies to Car", the reason in `ty-cap` under it, and a small quiet "Undo" (deletes the move, open months only).

## Browser tests

Owner: `tester`. Paths: `e2e/**`.

- Tests for acceptance criteria 2 to 5.
- Screenshots, light and dark, desktop and phone: the move dialog; the Budget page with a move.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. "Move money" in Emergencies' dialog opens the move dialog with "From" on Emergencies. Moving 200.00 to Car with a reason shows Emergencies 2,200.00 and Car 500.00, their notes, and the move in "Moved this month".
3. An empty reason, an amount above what is available, and the same place twice are refused with their sentences, and nothing moves.
4. "Undo" on the move puts both figures back.
5. A closed month shows no "Move money" and no "Undo".
6. The backend tests cover every rule in the contract.
7. The screenshots match the existing `Dialog` and `BudgetRow` styles.
