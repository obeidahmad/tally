# Tally roadmap

Tally is an open-source budgeting app that people run on their own machine. One server holds several accounts, so one person can host it for their family: each person signs in and sees only their own budget. It runs in phone and desktop browsers.

It borrows the strongest ideas of YNAB (every unit of money has a job), Monarch (net worth and investments) and Rocket Money (recurring bills), and adds its own model of sections, capped rollover, rest, and per-income split rules.

Phases are built in order. Each feature below states the behaviour agreed with the user.

## How it is built

- Two packages: `server/` (Node, TypeScript, Express, SQLite) and `web/` (React, TypeScript, Vite). In production the server serves the web app, so Tally is one process on one port.
- Money is stored as whole minor units (cents), never as fractions.
- Each piece of work has a spec in `specs/`.

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
2. **Income and month close:** income sources and split rules, tax-style sections, percentage budgets, rollover with caps, rest, closing a month, overspending carried forward, moving money between subsections.
3. **Currencies and net worth:** pockets in other currencies, transfers and conversions, where each subsection's money sits, net worth over time.

**Accounts**

- Several accounts on one server, each with its own sign-in and its own data.
- Each account picks a base currency (the user's is EUR).

**Pockets**

- A pocket is where money sits: cash, a bank account, a fund, a broker.
- Each pocket has one currency.

**Sections and subsections**

- A section is a top-level group such as Needs, Wants or Savings.
- Subsections (mortgage, food, car) draw their budget from their section.
- A subsection's budget is a fixed amount or a percentage. Fixed amounts are taken first, and percentages apply to what remains.
- Each percentage share is rounded down to the cent, and the leftover cents join the section's rest. Example: 1,000.01 in the section, A fixed at 60, B 60%, C 40% gives B 564.00, C 376.00 and 0.01 to the rest.

**Income and split rules**

- Each income source (paycheck, last month's leftover, investment payouts) has its own rule for how it is divided between sections. Example: paycheck 50% Needs, 20% Wants, 30% Savings; leftover 50% Needs, 50% Savings.
- Tax-style sections take their share first, from the income sources the user chooses, before the rest of that income is split. Example: Zakat applies to the paycheck but not to last month's leftover.

**Transactions**

- Entered by hand. Each one records a pocket and a subsection, and both can be edited.
- Transfers between pockets, including currency conversions recorded at the rate the user actually got.
- Where each subsection's money sits is calculated from the transactions, for example Car 6,000 = 4,000 in Bank A + 2,000 in the fund.

**Rollover**

- A subsection keeps its unspent money into the next month, up to a cap the user sets.
- This doubles as a savings goal: a Car subsection capped at 15,000 fills month by month, and paying for the car is a transaction that brings it back to 0.

**Rest**

- The rest is what a section has left at month end: money no subsection claimed, plus anything above the caps.
- The user decides where it goes: another section, next month's income, rollover inside the section, or a mix of these.

**Month close**

- A new month starts on its own. The previous month stays open and editable until the user closes it.
- Saved preferences pre-fill where the rest goes, and the user can adjust before closing.

**Overspending and moving money**

- An overspent subsection goes negative and starts the next month in the red, unless the user covers it.
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

- **File import:** bank statement files (CSV) from any bank. This is the fallback that keeps working when a live connection does not.
- **Trading212:** through the user's own API key. The official API is in beta and covers Invest and Stocks ISA accounts.
- **Banks (Revolut, Bank of Cyprus):** through Enable Banking, which is free for a private individual reading their own accounts. Each person on the server uses their own registration.
- Imported transactions keep the pocket the source reported; the subsection can be changed. Hand-entered ones stay fully editable.
- Bank access has to be re-approved from time to time; the app reminds the user before it lapses.

## Later

Taken from the three apps, after the phases above:

- Rules that categorise transactions automatically.
- Detection of subscriptions and recurring bills.
- Reports and charts: spending by section over time, cash flow.
- Sharing one budget between partners.

## Not planned

- A hosted service for the public. It would need a paid bank-data agreement and the legal duties of holding other people's financial data.

## Open decisions

- The open-source licence.
- How a host reaches their server away from home (a private network tool or a rented server). Linking a bank needs an HTTPS address.
- Whether Enable Banking covers the user's Revolut account. Its documentation describes Bank of Cyprus; Revolut is unconfirmed until an account is linked.
