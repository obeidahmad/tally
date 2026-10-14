# Tally roadmap

Tally is an open-source budgeting app that people run on their own machine. One server holds several accounts, so one person can host it for their family: each person signs in and sees only their own budget. It runs in phone and desktop browsers.

It borrows the strongest ideas of YNAB (every unit of money has a job), Monarch (net worth and investments) and Rocket Money (recurring bills), and adds its own idea: a pipeline that each person arranges, which carries income into sections step by step and carries what is left into the next month.

Phases are built in order. Each feature below states the behaviour agreed with the user.

## How it is built

- Two packages: `server/` (Node, TypeScript, Express, SQLite) and `web/` (React, TypeScript, Vite). In production the server serves the web app, so Tally is one process on one port.
- Money is stored as whole minor units (cents), never as fractions.
- Each piece of work has a spec in `specs/`.
- `npm run serve` runs Tally in Node's watch mode, so it restarts by itself after every build (`specs/10-app-follows-builds.md`). Before it applies a migration to an existing database, the server saves a copy in the data folder's `backups/`.

## Phase 0: Design system

Done as a first version, in `design/`. The logo is set aside for now.

- Tokens for colour, type and spacing, in light and dark.
- The components the app uses: budget row with progress bar, amount with currency, pocket card, transaction row, forms, navigation.
- Three key screens: the month's budget, transactions, pockets with net worth.
- Layout patterns stay familiar to users of the three apps (grouped budget table, dashboard, recurring list). Colours and identity are Tally's own.
- The user reviews it before the team builds on it.

## Phase 1: Budgeting core, with manual entry

Built in three slices:

1. **Foundations** (`specs/01-foundations.md`): accounts and sign-in, pockets, sections and subsections with a fixed monthly budget, hand-entered transactions, the month's budget.
   Followed by `specs/02-first-income.md`, from the user's first try of the app: "Add income" on the Budget page, a pocket created inside the transaction dialog, and an emoji on every pocket.
   Then `specs/03-add-buttons.md`: "Add income" moves next to "Add transaction", and the two are coloured buttons, green for income and orange for spending.
   Then `specs/04-section-budget.md`: a section has its own budget, set as the sum of its subsections, a fixed amount or a percentage of income.
   Then `specs/05-segmented-choices.md`: the budget choice and the transaction type become one-row segmented controls, and a new section starts on a percentage.
2. **The pipeline**, in this order:
   - `specs/06-pipeline.md`: income sources, boxes that merge sources, ordered steps into sections, and what is left over, shown as boxes and wires on a Pipeline page.
   - `specs/07-add-destination.md`: in the step dialog, the button that sends a step to one more section is named "+ Add destination" and looks like a button.
   - `specs/08-add-income-source.md`: the Pipeline page's button and its dialog read "Add income source".
   - `specs/09-closing-a-month.md`: rest rules, closing and reopening a month, subsections keeping what they did not spend, and overspending as a negative rest.
   - `specs/11-subsection-budgets.md`: subsection budgets as an amount or a percentage, their order, rollover caps and savings goals.
   - `specs/13-moving-money.md`: moving money between subsections and sections, always with a reason.
3. **Currencies and net worth:** pockets in other currencies, transfers and conversions, where each subsection's money sits, net worth over time.
   - `specs/12-currencies-and-transfers.md`: pockets in any currency at the ECB's reference rates, transfers with conversions, net worth.
   - `specs/14-where-money-sits-and-investments.md`: where each subsection's money sits, and holdings (phase 2).
   - `specs/19-reports.md`: spending by section, cash flow and net worth over time.

**Accounts**

- Several accounts on one server, each with its own sign-in and its own data.
- Each account picks a base currency (the user's is EUR).

**Pockets**

- A pocket is where money sits: cash, a bank account, a fund, a broker.
- Each pocket has one currency.
- Each pocket has an emoji the person picks, shown wherever its name is, so pockets are easy to tell apart.
- A pocket can be created from the Pockets page or in place while adding a transaction.

**Sections and subsections**

- A section is a top-level group such as Needs, Wants or Savings.
- A section holds only the money the pipeline has sent it. Budgeting from the bottom up, where a section totals its subsections, is set aside until there is a way to fit it into the pipeline.
- Subsections (mortgage, food, car) draw their budget from their section. What they have not claimed is the section's rest; they may claim more than the section has, and the rest then shows below zero.
- A subsection's budget is a fixed amount or a percentage. Fixed amounts are taken first, and percentages apply to what remains.
- Each percentage share is rounded down to the cent, and the leftover cents join the section's rest. Example: 1,000.01 in the section, A fixed at 60, B 60%, C 40% gives B 564.00, C 376.00 and 0.01 to the rest.

**The pipeline**

The pipeline is what makes Tally different: money moves through steps in an order the person sets. Example: 2.5% to Zakat, then 500.00 to Family, then what is left split 50-30-20 between Needs, Wants and Savings, then anything still left goes to next month.

- Every income belongs to a source the person names (Paycheck, Second job). The name is typed once and picked afterwards.
- A box holds one source, or several merged together, and their steps. A source feeds exactly one box. The steps act on the money of all the box's sources together.
- A step takes from what reaches it: an amount for the month, taken once however many payments come in, or percentages shared between one or more sections. A percentage is of what reaches the step, rounded down to the cent. Each section a step sends money to is called a destination.
- Two separate boxes are independent: if each sends 500.00 to Family, Family gets up to 1,000.00. Merging the sources is how to send 500.00 in total.
- Income that no step takes is left over.
- A rest rule says where a section's rest goes when the month closes. It is shares, never an amount: all of it, or a split such as 60% and 40%. It can go to next month's income, which arrives as its own source named "Last month's leftovers", or straight into a section next month, including the same one. A new section sends all of it to next month's income.
- "Last month's leftovers" is a source like any other: it has a box and steps, and can be merged with other sources.
- The page shows this as boxes and wires that the app arranges itself. Nobody drags anything. A dotted wire is money moving between months.
- Not decided or not yet built: what is left of one box flowing into another box, and a phone layout for the pipeline.

**Transactions**

- Entered by hand. Each one records a pocket and a subsection, and both can be edited.
- Transfers between pockets, including currency conversions recorded at the rate the user actually got.
- Where each subsection's money sits is calculated from the transactions, for example Car 6,000 = 4,000 in Bank A + 2,000 in the fund.

**Rollover**

- A subsection keeps its unspent money into the next month, up to a cap the user sets. Until caps exist, it keeps all of it.
- This doubles as a savings goal: a Car subsection capped at 15,000 fills month by month, and paying for the car is a transaction that brings it back to 0.

**Rest**

- The rest is what a section received, less what its subsections claim as budget, less what they overspent, plus anything above the caps.
- The user decides where it goes: another section, next month's income, rollover inside the section, or a mix of these.
- A rest below zero is overspending. It goes all to one place, chosen per section: next month's income, where it is merged with the other income, or the same section next month, whose money then makes up for it.
- What is left over always goes to next month's income.

**Month close**

- A new month starts on its own. The previous month stays open and editable until the user closes it.
- Closing is on the Budget page. From the first day of the next month, a notice reminds the user to close the month that ended. Months close in order, oldest first.
- The rest rules decide where each rest goes. Closing shows every amount and where it goes, and only asks for confirmation; to send a rest elsewhere, the user changes the rule first.
- A closed month cannot be edited. It can be reopened while the month after it is still open.

**Overspending and moving money**

- An overspent subsection's extra spending comes out of its section's rest, so the subsection starts the next month at zero.
- Moving money between subsections or sections (for example out of Emergencies) is possible, but as a deliberate advanced action, not a quick one, so the app keeps nudging the user to respect the budget.

**Currencies and net worth**

- Pockets can be in any currency. Totals are shown in the base currency at the day's reference rate.
- Net worth over time, across all pockets.

## Phase 2: Investments

- A holding belongs to a subsection and a pocket. It shows what was paid and what it is worth now, each in its own currency. Example: paid 1,000 EUR, worth 1,050 EUR, or 900 USD if it changed currency.
- The current value comes from a connected broker, or the user types it in.
- Money actually paid out (interest, dividends, profit on a sale) counts as income, with its own split rule like any other income source. Price changes only change the holding's value and the net worth.
- Funds that pay daily income: each payout is recorded as income from that fund.

## Phase 3: Connections

- `specs/15-statement-import-and-rules.md`: CSV statements and rules that sort transactions by payee.
- **File import:** bank statement files (CSV) from any bank. This is the fallback that keeps working when a live connection does not.
- **Trading212:** through the user's own API key. The official API is in beta and covers Invest and Stocks ISA accounts.
- `specs/17-bank-connections.md`: banks through Enable Banking, with each person's own registration.
- **Banks (Revolut, Bank of Cyprus):** through Enable Banking, which is free for a private individual reading their own accounts. Each person on the server uses their own registration.
- Imported transactions keep the pocket the source reported; the subsection can be changed. Hand-entered ones stay fully editable.
- Bank access has to be re-approved from time to time; the app reminds the user before it lapses.

## Later

Taken from the three apps, after the phases above:

- Rules that categorise transactions automatically.
- Detection of subscriptions and recurring bills (`specs/18-recurring.md`).
- Reports and charts: spending by section over time, cash flow.
- Sharing one budget between partners.

## Not planned

- A hosted service for the public. It would need a paid bank-data agreement and the legal duties of holding other people's financial data.

## Open decisions

- The open-source licence.- How a host reaches their server away from home (a private network tool or a rented server). Linking a bank needs an HTTPS address.
- Whether Enable Banking covers the user's Revolut account. Its documentation describes Bank of Cyprus; Revolut is unconfirmed until an account is linked.
