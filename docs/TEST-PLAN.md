# Test plan: PCC Dashboard test-and-fix round

All checks use made-up data built in `tests/helpers.js`. Nothing outside the page is touched: fonts and the Excel reader are served or blocked locally, no real export files, no live systems.

Run everything with `npm install` once, then `npm test`.

| # | Area | What is checked | Planned checks |
|---|---|---|---|
| 1 | Main workflows end to end | Open, upload production, upload QA (CSV and Excel), both reports draw, filters, downloads, print, notes, feedback | 25 |
| 2 | Bugs and edge cases | Empty file, header-only file, wrong file in each box, unknown file, duplicate upload, replace upload, huge file, odd characters, blank cells, bad numbers, bad dates | 35 |
| 3 | Who sees what | There are no roles or accounts. Checked instead: nothing is sent off the page, notes stay in the browser, one client's QA rows do not leak into another client's filter | 8 |
| 4 | Numbers | Every headline total, count and percentage against hand-worked answers; the same figure agrees across Executive summary, Overview, Coverage, Scorecard, Insights, printed report and CSV downloads | 60 |
| 5 | Dates and time | Viewer in India, US Central, UTC and far-east time zones gets identical numbers; weekday labels; week grouping; month and year ends; midnight calls; weekends; shift edges | 30 |
| 6 | Two people at once | No shared data exists. Checked instead: double upload, double click on downloads, two tabs editing the same note, quick repeated filter changes | 8 |
| 7 | Uploads, downloads, exports, emails | CSV downloads have the right rows and columns, open safely in Excel, feedback email goes only to the two review addresses and carries no patient data | 20 |
| 8 | Every screen in a real browser | No errors on any section, every button does something, phone width, all three themes, print layout | 30 |
| 9 | Errors and recovery | Excel reader unavailable, unreadable file, wrong file then the right file, browser storage unavailable | 10 |
| 10 | Speed | Time to load and redraw with 20,000 and 60,000 made-up calls; repeated work per redraw | 6 |
| 11 | Basic security | No secrets in the code, file contents cannot inject code into the page, downloads cannot inject formulas, outside scripts | 12 |

Not applicable to this app (noted so nothing is silently skipped): sign-in, permissions on server actions, database queries, India public holidays (the app has no holiday list), notifications.

Files:
- `tests/helpers.js`: made-up data builders, expected answers, browser helpers.
- `tests/*.test.js`: one file per area, check names in plain English.
