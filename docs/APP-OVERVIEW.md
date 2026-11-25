# PCC Dashboard: what it is and how it works

Written during the test-and-fix round (November 2026). The README is one line, so the rules below come from the code, its comments and the on-screen definitions. Where a rule was unclear it is listed as a QUESTION at the end.

## What the app does
One web page (`index.html`). A supervisor drops in the phone system's export files and a QA audit sheet. The page reads them inside the browser and draws two reports:

1. **Production report**: executive summary, overview, coverage and missed calls, agent scorecard, volume trends, voice of the patient, insights and flags, recommendations.
2. **QA report**: overview, fatal and non-fatal errors, score breakdown, outliers, Pareto and root cause notes, rebuttals, feedback, duplicate audits, recommendations.

Nothing is sent anywhere. There is no server, no database and no sign-in.

## Who uses it (roles)
There is only one kind of user: whoever opens the page (a PCC supervisor, QA lead or manager). There are no accounts, so there is no "who sees what" inside the app. Whoever has the page and the files sees everything in those files.

## Main workflows
1. Open the page, pick a theme (Classic, Purview Light, Purview Dark). The theme is remembered in that browser.
2. Upload production files (CSV, box 1). Each file is recognised by its column names.
3. Upload the QA sheet (Excel or CSV, box 2). Excel reading needs the SheetJS library, fetched from a public CDN the first time.
4. Read the Production report and the QA report. Change the filters: date range, queue, agent, group by (day, week, month), shift start and end, include device lines.
5. QA report has its own filters: client, agent, auditor, audit date range.
6. Download lists (missed calls, no-callback list, agent scorecard, quality audits) as CSV.
7. Print either report.
8. Type supervisor notes per agent and root-cause notes per QA parameter. These are kept in the browser only.
9. Send feedback: opens the person's email app with a pre-filled message.

## What it connects to
- Google Fonts (styling only; the page works without it).
- cdnjs.cloudflare.com for the Excel reader (only when an .xlsx file is uploaded).
- The person's own email app through a `mailto:` link (Feedback tab).
- Browser storage (theme, notes, root-cause notes, feedback name).

## The files it recognises
| File | Recognised by columns | Used for |
|---|---|---|
| Queue caller details | Left Queue Reason, Wait time (s) | Offered, handled, no agent, abandoned, service level |
| Call log (conversations) | AI Summary | Missed calls, callbacks, direction, sentiment, topics |
| Agent productivity | Occupancy, # of queues | Logged in, working, paused, utilisation |
| Individual performance | Missed ring percentage | Handle time, missed rings, holds, transfers |
| Agent activity | Superstate, Substate | Present days, time by state |
| Pause usage | Pause reason, Pause Count | Do Not Disturb and pause time |
| Grouped by date | Total calls count, End time | The phone system's own daily totals |
| Grouped by queue, Agent calls | (recognised, not used on screen) | |
| QA sheet | "Agent Name" header row; optional "Scoring Key" tab | QA report |

## The number rules (from the code and on-screen definitions)
- **Offered** = unique calls that entered a queue. A call with several queue legs (same Conversation Space Id) counts once, with its best result (handled beats abandoned beats outflowed).
- **Handled %** = handled / offered.
- **No agent** = Left Queue Reason is "no agents - joined empty". Only in-shift ones count as a gap.
- **Abandoned** = Outcome "abandoned". **Queue timeout** = reason "queue timeout".
- **Not answered** = offered minus handled. **Total not reached** = no agent (in shift) + abandoned + queue timeout.
- **Service level** = Met SL YES / (YES + NO), in-shift calls only.
- **Shift** = 9 AM to 6 PM US Central by default; hours come straight from the timestamps in the files, so the viewer's own time zone must not change any number.
- **Missed calls** = call log rows with Call Result "Missed Call". In-shift only for the headline figures.
- **Weekend** calls are a separate category from "during shift" (Call categories section).
- **Callback** = a later outbound call to the same phone number.
- **Device lines** (Yealink phones, front desk, billing admin, billing department, manager lines, names starting with a digit) are left out of agent figures unless the toggle is on.
- **Agent targets**: handle time 315s, missed rings 10%, ring 5s, hold 140s. Green within target, amber up to 20% over, red beyond.
- **Login/logout issue**: more than 8h 15m logged in per present day.
- **QA score**: from the sheet's Total Score. A miss on any Fatal parameter scores the audit 0; otherwise 100 minus the weights of missed parameters. Fatal list comes from the workbook's Scoring Key tab, else the built-in key.
- **QA outlier** = agent average 95% or below; two or more weeks in a row means QIP/PIP.
- **Pareto**: the "vital few" parameters that make up 80% of defects.

## QUESTIONS (rules that are not written down anywhere)
These are answered with the safest choice for now and repeated in the NEEDS OWNER list in `docs/TEST-REPORT.md`.
1. Should missed calls on Saturday and Sunday count as "in-shift" missed calls? The Call categories section treats weekends as closed, the missed-call figures did not.
2. Should "Missed (in-shift)" count only inbound calls? Different screens counted it differently.
3. Not-answered %: the owner asked for answered + not answered as the base, and Billing Admin calls to be left out. The raw data that shows where those calls appear was never uploaded.
4. The client name "Village Eye Care" is fixed in the report header. Is this dashboard for one client only?
5. Are night shifts (shift that passes midnight) needed? The shift filter only supports same-day hours.
6. QA dates typed as day/month/year (Indian style) cannot be told apart from month/day/year when the day is 12 or less.
