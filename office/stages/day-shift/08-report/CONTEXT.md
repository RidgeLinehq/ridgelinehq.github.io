# 08 Report (Mara): run doc, stats, the morning message, run-log line, commit

## Inputs
| File | Section |
|---|---|
| skills/mara/SKILL.md | all |
| shared/logging.md | all |
| shared/repo.md | Committing, Write paths |
| output/<day>-run.md | whole file |
| database: runs/<runId>, stats/<day> (if any), leads counts by status (query, out_dir), drafts counts by status, health/main | |

## Process
1. Counts: leads total and by status, new today, drafts ready/sent today, follow-ups due
   tomorrow, calls logged today, clients. Write stats/<day>.
2. runs/<runId>: status done or failed, stages with minutes, counts, summary (2 lines),
   needsYou (from every stage's NEEDS YOU lines, de-duplicated, each one tap).
3. settings/main: advance nextTarget (wrap around), set lastRun, and ramp.sendingSince if the
   first real send happened today (if_version).
4. `## Money` in the run doc: clients x monthly = real monthly revenue (0 is a fine number);
   spend this month (0 unless Grayson spent). `## Next move`: the single most valuable thing
   for tomorrow, one line.
5. Morning message to Grayson (SendUserMessage), at most 4 lines:
   line 1: "Ridgeline: 🟢/🟡/🔴 Leads · Outreach · Replies · Site" (from health.lights)
   line 2: real counts: "<n> new leads in <town>, <r> emails ready for your OK, <s> sent,
   <p> replies" (omit zeros except sent when autoSend is on)
   line 3: the one thing to tap, if any ("Approve 6 drafts in the office" / "Add a mailing
   address in Settings" / "Take 2 screenshots for Pine Hill Roofing")
   line 4: only if something is red.
   Mondays (Oct 28, 2026): the Clients worker's `TESTBUY:` line becomes "This week's test buy:
   <score1> -> <score2> (<kind>, <town>)" in the message, and the PDF goes to
   ridgelinemarketinghq@gmail.com with mcp__Gmail__send_message (ToolSearch it first): subject
   "Ridgeline test buy <day key>: <score2>", body = that line plus the weakest part and its fix,
   the PDF as the attachment (base64), never in the repo. Under 80: the alert from 09 Step 0.5.
   A paused run sends nothing. If nothing happened and nothing is needed, send 2 lines max.
5b. Workers cannot send email (a worker's send was refused Oct 27): every `ALERT: <key>: <what>
   | <tap to fix>` line in a worker's report is emailed by you now (shared/alerts.md, deduped),
   and the Monday `TESTBUY:` line goes into the run-log --note.
6. Set every crew doc idle with lastResult. Commit the repo writes (run notes, skills, lessons),
   `git pull --rebase`, push. Write the run-log line last (shared/logging.md), commit and push
   it too (never retried on failure).

## Audit
Every needsYou line is one tap. Counts match the database. The message has no jargon and no
line over 90 characters.

## Outputs
| Where | What |
|---|---|
| stats/<day>, runs/<runId>, settings/main (nextTarget, lastRun, ramp), crew/* | as above |
| office/runlog.jsonl, office/stages/day-shift/output/<day>-run.md | committed |
| Grayson | the morning message |
