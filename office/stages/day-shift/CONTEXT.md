# Day Shift pipeline

Ten sub-stages, in order, run by FRESH WORKERS so no worker carries another's context. You
(the scheduled session) are Mara, the coordinator: you keep almost nothing in your own context.
The Day Shift finds businesses, scores them, writes the outreach, prepares video briefs, learns
from replies, checks health and reports, every weekday morning. It sends email ONLY through the
gates in specs/email-rules.md. It never texts, calls, DMs or posts.

## How the coordinator runs it
1. Read this file. Do stage 00 yourself (it is tiny). Note runId, day key, the settings
   (paused, dryRun, autoSend, dailyEmailCap, targets, today's town) and the counts.
2. For each worker below, launch one fresh agent (the Agent tool, general-purpose, in the
   foreground, one at a time) with this brief, filled in, and nothing else:

   "You are the Day Shift's <WORKER> for <day key>, runId <runId>. The repo is at <repo path>
   (already pulled; do not pull again, do not push). FIRST read office/CLAUDE.md,
   office/shared/database.md, office/shared/rules.md and office/stages/day-shift/CONTEXT.md
   (its Run notes, Load map and Conflicts sections bind you; a skill's own "Exact steps" never
   override them). Then read office/stages/day-shift/<stage folder>/CONTEXT.md for each of your
   stages in order, and load ONLY what each Inputs table names (the sections it names).
   Settings today: paused <bool>, dryRun <bool>, autoSend <bool>, dailyEmailCap <n>, town
   <town, state>, trades <list>, foundingSpots <n>. Write your outputs where each stage's
   Outputs table says; after each stage append one line to events/<day key> (shape in
   database.md) and append your section to office/stages/day-shift/output/<day key>-run.md
   under the heading the stage names. Set your crew doc working/idle as database.md says.
   Report back in at most 12 plain lines: what you did, the numbers, what failed, every alert
   as an `ALERT: <key>: <what> | <tap to fix>` line (you cannot send email; Mara sends them),
   any `GRADE:` or `TESTBUY:` lines, and the list of instruction files you loaded."

2b. Fresh grader (Oct 28, 2026): a worker launched with the Agent tool has NO Agent tool of its
   own (tested), so the Clients worker cannot launch the grader that specs/quality.md "Who
   grades" requires. When its report carries `GRADE: <pdf> | <facts> | <draft id>` lines (a
   Welcome Pack, a monthly report, the Monday test-buy pack), you launch the grader yourself as
   its own fresh agent with the brief in 09-clients/CONTEXT.md "Grading hand-off", then a fresh
   Clients worker for the fix round (its brief carries the grader's JSON), then the grader once
   more. Two rounds at most, about 8 minutes each. A pack graded only by its writer is qa.by
   "self" and never status ready; the reply desk re-grades those before sending. On Mondays the
   Clients worker runs even with zero clients (the test buy), and its `TESTBUY:` line goes into
   the Report worker's brief.
3. After each worker: read its report and the run notes file, update runs/<runId> and counts,
   and decide the next worker. A failed worker is retried once with the failure in its brief; a
   second failure marks the run failed at that stage (later workers still run where they can:
   Review and Report always run).
4. If the Agent tool is not available in this session: run the stages yourself in order,
   loading each stage's CONTEXT.md only when you reach it, and say so in the run log.

## Workers (grouped so each loads a small, related set of files)

| Worker | Stages | Runs | Skip when |
|--------|--------|------|-----------|
| Research | 01-scout, 02-quinn | once | paused. (Today's town with 25+ Qualified leads not yet Contacted skips only Scout's email-town steps 1-7; the call stock fill 0, the enrichment pass 0b and Quinn's Who's On Top 3b always run while any niche is under 25.) |
| Outreach | 03-parker, 04-echo | once | paused; or no Qualified lead with an email and no follow-up due |
| Studio | 05-nova | Monday and Thursday only | a brief already exists for this week's slot |
| Review | 06-sage, 07-patch | once | never (sub-steps have their own skips) |
| Clients | 09-clients | once | no client with status active, except Mondays (the weekly test buy runs then) |
| Report | 08-report | once, last | never |

## Assigned tasks (tasks collection, status queued)
Before launching the Research worker, Mara lists tasks with status queued (ArtifactData query).
For each: claim it (update status running, runId, startedAt, with if_version; a version
conflict means another run has it, skip it), then hand it to the worker whose agent it names
by adding one line to that worker's brief: "ASSIGNED TASK <id>: <title>: <details>. Do it
within your stage's rules and write the result to tasks/<id> (status done + result, or failed
+ error)". A task for an agent with no worker this run (Nova on a Tuesday) runs as its own
small worker after Outreach. attempts +1 on each claim; attempts 2 and failed = status failed,
and Patch does not retry it again.

## Run notes (`output/<day key>-run.md`, under 120 lines; every worker appends, Report reads it whole)
Headings, in order: `# Day Shift <day key>` (00), `## Settings` (00), `## Scout` (01: town, how
many found, how many new, how many with email, sources used), `## Quinn` (02: scores, the
top 5 with why), `## Parker` (03: angle per lead, one line each), `## Echo` (04: drafts
written, QA scores, ready/approved/sent counts, Gmail ids, blockers), `## Nova` (05), `## Sage`
(06: replies found, statuses changed, lessons written, workflow verdicts), `## Patch` (07:
lights, fixed, needs you, backup id), `## Clients` (09: per client one line; Mondays first
line `testbuy {kind, town, score1, score2, weakest} pdf=<path>`), `## Money` (08), `## Next
move` (08). Plain text, numbers
only, no prose padding.

## Load map (what each stage's Inputs table points to; every worker also has CLAUDE.md, database.md, rules.md)

| Stage | Loads |
|-------|-------|
| 00 | `shared/repo.md` ("Getting it"), `specs/push-week-2026-10-23.md` (the week's standing order: Mara puts each worker's one line into its brief) |
| 01 | `call_kit/kit.json` (niches), `office/tools/call_desk.py stock` output, `specs/offer.md` (Targets), `shared/outreach-law.md` ("Where leads come from"), `skills/scout/SKILL.md`, `LESSONS.md`, `references/database-fields.md` (leads) |
| 02 | `references/scoring.md`, `skills/quinn/SKILL.md`, `specs/call-script.md` ("Ranking the call list"), `shared/gateway.md` |
| 03 | `specs/sales-psychology.md`, `specs/offer.md`, `skills/parker/SKILL.md` |
| 04 | `specs/email-rules.md`, `specs/sales-psychology.md` ("Follow-up cadence", "Subject lines", "Voice"), `shared/outreach-law.md`, `skills/echo/SKILL.md`, `LESSONS.md`, `references/database-fields.md` (drafts, suppression, stats) |
| 05 | `specs/video-briefs.md`, `specs/sales-psychology.md` ("For Nova"), `skills/nova/SKILL.md` |
| 06 | `office/tools/call_desk.py stats` output, `specs/email-rules.md` ("Reply handling"), `skills/sage/SKILL.md`, `LESSONS.md`, `references/database-fields.md` (lessons, workflow, clients) |
| 07 | `skills/patch/SKILL.md`, `shared/repo.md` ("Write paths"), `references/database-fields.md` (health) |
| 08 | `skills/mara/SKILL.md`, `shared/logging.md`, `shared/repo.md` ("Committing"), `specs/push-week-2026-10-23.md` ("Scoreboard": the money line and the day's targets vs actual) |
| 09 | `specs/client-delivery.md`, `specs/client-happiness.md`, `specs/quality.md`, `specs/lead-tracking.md`, `specs/offer.md` (The plans, Promises), `shared/gateway.md`, `shared/alerts.md`, `skills/echo/SKILL.md`, `skills/parker/SKILL.md`, `office/examples/welcome-pack.json` (every Monday, and before any Welcome Pack or report) |

Do NOT load: every skill, every spec, `office/server/`, `office/page/`, `index.html` (Patch
fetches the live site instead). If a stage file cannot be read, stop that stage, write the run
doc failed with the reason, and tell Grayson in one line.

## Handoffs
- Leads move: New (Scout) → Researching (Quinn working) → Qualified (score at or above
  settings.scoreGate, default 60) or Not a fit → Contacted (Echo sent) → Replied (Sage) →
  Meeting (free check delivered, deciding) → Client (paid) or Not a fit. Suppressed is terminal.
- Grayson's edit surface is the page: approve or reject a draft, change a status, log a call,
  add a lead, add a lesson, flip switches. The pipeline reads whatever state he left; his call
  wins. A draft he edited on the page (editedAt set) is sent as he wrote it; Echo only re-runs
  the law checks (footer, address) on it.

## Time budget and conflicts
About 25 minutes of work, plus up to 15 more for the call stock fill and enrichment pass (Oct 26,
2026) while any niche is under 25. Over budget: skip 05, then cut the stock fill to 15 leads, then cut Scout to 8 leads, then skip Sage's
workflow review (replies are never skipped). Any single wait: 5 minutes max.
`shared/rules.md` wins over anything softer. The task prompt wins over all.
