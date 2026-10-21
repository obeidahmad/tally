# Spec 24: Subsection emojis and goals with a date

Follows specs 01 to 23, which stay the reference for everything not changed here. Migration `017_goals.sql`.

## Goal

From the user: Tally offers what Monarch and YNAB offer.
- Monarch gives every category an emoji, which makes the budget easy to scan.
- Monarch's goals and YNAB's targets say how much a month is needed to reach a target by a date, and whether the budget is on track.

Tally's savings goals (spec 11) have a target but no date.

## Out of scope

- Goals that span several subsections.
- Contributions from outside the budget.
- YNAB's other target types (spend by a date, weekly).

## Shared contract

### Emoji

- `subsections.emoji TEXT NULL`, validated like a pocket's emoji (spec 02).
- `POST`/`PATCH /api/.../subsections` accept `emoji` (null clears it), and every response carrying a subsection carries `emoji`.

### Goal date

- `subsections.target_month TEXT NULL` (`YYYY-MM`), only for `kind: 'goal'`. On a spending subsection: 400 on `targetMonth`, "Only a savings goal has a target date."
- It may be the current month or later when it is set ("Choose this month or later.").
- For each goal with a target and a date, `GET /api/budget?month=` adds:
  - **`neededMinor`:** (target − what the goal held at the start of the month) ÷ the months left including this one, rounded up to the cent; never below 0. Null without a date.
  - **`goalStatus`**, one of:

    | Status | When |
    |---|---|
    | `done` | What it holds now ≥ the target |
    | `on_track` | This month's budget ≥ `neededMinor` |
    | `behind` | The budget is below it |
    | `past` | The month is after `target_month` and the goal is not done |

    Null for a goal without a date, unless it is `done`.
- The budget gains `underfundedMinor`: the sum over goals of max(0, `neededMinor` − budget), as YNAB shows.

## Backend

Owner: `backend-dev`. Paths: `server/**`. Tests:
- emoji validation and clearing;
- the target month rules;
- needed, rounded up, with 1 and 12 months left;
- each status;
- underfunded;
- a closed month keeping its figures;
- isolation.

## UI

Owner: `ui-dev`. Paths: `web/**`. Built on spec 21's look.

- **Subsection dialog:**
  - "Emoji" with the existing `EmojiPicker` (optional, with "No emoji").
  - For a savings goal, "Reach it by" as a month input (optional) under "Target".
- **The emoji shows before the subsection's name** everywhere the name shows: the Budget table, pickers, transaction rows, Recurring rows, and the Reports tables. Charts keep their colour dots.
- **Budget table, for a goal:**
  - The Rule cell reads "15,000.00 by Jun 2027".
  - When `behind`, the Budgeted figure is in the warning colour with `title` "Needs {neededMinor} a month to reach {target} by {month}".
  - `done` shows a positive `Pill` "Reached" in Available.
  - `past` shows a warning `Pill` "Date passed".
- **Budget summary aside** (spec 21): when `underfundedMinor` > 0, the line "Goals need {x} more this month", with a list of the behind goals and each one's shortfall.

## Browser tests

Owner: `tester`. Paths: `e2e/**`. Tests:
- giving a subsection an emoji and seeing it on the Budget page and in a transaction;
- a goal with a date on track and behind, and the summary line;
- a reached goal.

Screenshots light and dark, desktop and phone, of the Budget page with emojis and goals.

## Acceptance criteria

1. From the root, `npm run build`, `npm test` and `npm run test:e2e` succeed.
2. A goal of 1,200.00 to reach in 12 months from 0 needs 100.00 a month.
3. Emojis show wherever a subsection's name does, except chart legends.
4. The backend tests cover every rule in the contract.
