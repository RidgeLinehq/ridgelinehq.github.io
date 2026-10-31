# Buyer week, Oct 31 to Nov 7, 2026 (Grayson's standing order, Oct 31, 2026)

_Same authority as the other files in specs/. Replaces push-week-2026-10-23.md (kept for the record). Mara reads it at stage 00 and puts each worker's line into that worker's brief; at stage 08 the scoreboard leads the run doc and the morning message; the reply desk reads "Buyer rules" every run. Every number below is the office's real number on Oct 31 (run notes 2026-10-30-run.md, LESSONS.md, runlog.jsonl, the scheduled-task list). Nothing here is a forecast, and nothing here bends shared/rules.md or specs/email-rules.md._

## Grayson's order (Oct 31, 2026, in his words, shortened)
Big buyers are coming. Every agent fully focused, on its best behavior, producing quality work and
real products that help these businesses, learning every run. Cold emails go out every weekday
without failing, short ("not 13,000 paragraphs"), with a little picture (the Ridgeline card:
free AI check, then $39.99 a month). Everything automated and ready.

## Where we start (Oct 31)
- Clients 0 paying (1 test client, not counted), revenue $0 a month, spend $0.
- Leads 440: New 153, Researching 120, Qualified 20 (0 with email), Contacted 36, Replied 5,
  Meeting 15, Not a fit 46, Suppressed 44. Follow-ups due: Nov 1 x2, Nov 2 x15, Nov 3 x19.
- Cold email: 46 sends (38 crew, 8 hand), plain text; the 34 crew sends of Oct 29 to 30 ran 88 to
  112 words each (run notes 10-29, 10-30); 0 replies, 0 bounces on own-site emails. Push week
  sent 38 of its 50 target (2, 0, 0, 2, 15, 19). Cap 20, window 7:00 to 9:30 AM Central, Oct 30:
  19 of 20 sent by Mara, 0 failed.
- Free checks: 13 delivered since Oct 26 after calls, 0 replies, 0 clients. Calls 137: auto repair
  16 of 72 Interested (22%), roofing 0 of 23; 2 to 4 PM 18.5% vs 9 to 11 AM 7.4%.
- Open: the Lead Finder scheduled task had never run (0 run-log lines): it fired in the Default
  cloud environment, whose setup script runs `make me` and dies before the session starts, and a
  task made from outside the desk's environment has no Gmail, database or repo access. Since Oct
  31 the reply desk does the Lead Finder's work itself on its 8 AM and 4 PM runs (Lane LF); the
  separate task is off.
  Old bad prospect addresses are closed, not chased (Grayson, Oct 31: "those are long gone").
- New since today: every cold email is under 90 words, three short paragraphs, built by
  `office/tools/cold_email.py` with the card (specs/email-rules.md "Shape" and "The HTML version").

## The one goal
Turn this week's buyers into paying clients who stay: every reply answered within one run, every
free check sent the same run, every new client's Welcome Pack graded 85+ by a fresh grader and
emailed within the hour, every client question answered within one run, and the full daily cap of
QA 80+ cold emails in the new shape sent every weekday inside the window. A paying client is the
goal the week works for; it is not promised.

## Buyer rules (every paying client, first 7 days; the reply desk and Day Shift 09 follow these)
1. Payment lands: the welcome goes the same run (Instant within minutes when it is on; the desk
   within the hour either way). Never a second welcome.
2. Within the hour of the onboarding form: ONE email with the branded Welcome Pack PDF (starting
   AI score, profile fixes, review kit, next 30 days), graded 85+ by a fresh grader
   (specs/quality.md "Who grades"); under 85 after two rounds = ship 75+ with an alert, never silence.
3. Day 1 to 2: profile fixes applied as Manager (Grayson's "Apply on Google" task) or sent
   paste-ready; a fix is "done" only when checked live.
4. Day 3: the check-in note (specs/client-happiness.md). Day 7: the first weekly AI re-check.
5. Every client email answered within one run. Any unhappy, confused or "cancel" word: a kind
   reply plus an alert to Grayson in the same run (shared/alerts.md). Never argue.
6. Pro: leads emailed the run they are found, twice a day. Growth and Pro: the guarantee stands
   word for word (specs/offer.md). Nothing promised beyond offer.md; zeros shown honestly.
7. Every deliverable is a real branded file (specs/quality.md "Format"), specific to their
   business, with a sources block. One invented fact = score 0 = not sent.

## Daily targets (each line goes into that worker's brief; actual vs target goes in the run doc)
| Agent | Target each run | Measured by |
|---|---|---|
| Scout | settings.dailyEmailCap new leads with a public email from the business's own site (email-first towns, dentists and auto repair led: 22% Interested on calls), each with a source URL; 0 invented facts | "## Scout": found, new, with email |
| Quinn | every new lead scored the same run; auto repair and dental first in the call list; 0 held for a Google count | "## Quinn" |
| Parker | an angle on every Qualified lead with an email; the loss line names real competitors from an AI check when one exists; two subject patterns alive | "## Parker" |
| Echo + Mara | the cap sent every weekday inside the window, each built by cold_email.py (under 90 / 60 / 45 words, three paragraphs, the card), QA 80+, a Gmail id on every send; follow-ups due go first and count toward the cap; a shortfall names its one cause | "## Echo", "## Mara sends" |
| Reply desk | every reply within one run; every "yes" gets the check the same run; Buyer rules 1 to 7 on time; I2 follow-ups on their day; Lane LF (the Lead Finder) on the 8 AM and 4 PM runs with health/leadfinder written each time | health/desk lanes, clients work items |
| Clients (09) | every active client has a done work item inside 48 hours of onboarding; week-1 fixes checked live; Monday test buy 85+ on the first grade | "## Clients" |
| Sage | the first reply-rate lesson at day 3 of the Oct 30 batch (Nov 2); old shape (46 sends) vs new shape (first 20 sends) scored apart; levers and subject patterns by reply | "## Sage", LESSONS.md |
| Nova | Monday and Thursday: one brief in the video-briefs.md format with the hook, the pop-up text and the second it appears | "## Nova" |
| Patch | five lights true plus a sixth: the card URL (assets/email/free-ai-check.png) answers 200 on the live site; a failing scheduled task is an alert the same run | "## Patch" |
| Mara | scoreboard first; each worker's target vs actual; every ALERT emailed; at most one NEEDS YOU line, only from the "needs Grayson's go" list | "## Money", the morning message |

## Scoreboard (stage 08 writes it; the morning message's first line)
`Ridgeline: $<verified this month> · <clients> clients · <sent today>/<cap> sent · <replies this week> replies · <free checks this week> checks · <clients served on time>/<clients> on time · $<spent> spent`. Every number from the database, Gmail ids or Stripe; a number the run could not read is "unknown".

## Grayson's taps (the only things the crew may not do itself)
1. Merge branch `claude/ai-agents-buyer-prep-l307ph` into main: the card image and these rules go
   live on the site and in the crews' clones only from main.
2. Film the Nova briefs when there is time; the office never waits on them.
(The Default cloud environment's setup script still runs `make me` and dies; nothing in the office
depends on it since Oct 31, so it is not a tap. Old bad prospect addresses are not a tap either.)

## What a win looks like on Nov 7 (measured, not promised)
100 crew emails sent inside the gates (5 weekdays x 20) in the new shape, 0 bounces or spam
flags, the first reply-rate lesson written, every reply answered inside one run, every new
client's Welcome Pack graded 85+ and sent within the hour, every day-3 check-in sent, the Lead
Finder running twice a day, and 0 red lights Grayson sees first.
