# Lead Finder: leads for every Pro client, twice a day, every day

Grayson's standing order (Oct 24, 2026): "make sure we are sending agents to get them more leads
if they buy for that package." Since Oct 31, 2026 this runs INSIDE the reply desk
(stages/reply-desk/CONTEXT.md "Lane LF") on its 8 AM and 4 PM Central runs, every day (weekends
too), so a paying client never waits for leads; the separate scheduled task is off because its
environment could not run it (0 runs ever). This stage only finds, logs and sends leads; the
rest of the desk answers emails and the Day Shift does the rest of the client work.

## Inputs
| File | Section |
|---|---|
| specs/lead-tracking.md | all (the ONLY allowed sources and the NEVER list) |
| specs/quality.md | Leads, Format |
| shared/alerts.md | all |
| database: clients where status == active and plan == pro (out_dir); leadlog for them, last 45 days (out_dir); suppression | |

## Process
0. No active Pro client → write the run-log line ("no lead clients") and stop. Cheap.
1. Per client: the search plan, kept on the client as `leadSearch` (build it the first time,
   improve it every run): their kind of business + 3 to 5 words customers use for it (services,
   synonyms, problems: "haircut", "fade", "beard trim"), their town + every town within about 20
   miles, the town's and nearest city's subreddits, and what a good lead looks like for them.
2. Reddit (official API through the "Ridgeline lead finder" Action): one job file for all clients
   (`office/leadfinder/jobs/lf-<day>-<slot>-<4 hex>.json`, town + terms only, NEVER a client's
   name), commit, pull --rebase, push, poll the out file (15 s, up to 6 min). Out says "not set
   up" → skip Reddit, note it.
3. Web search: 3 to 5 WebSearch queries per client, varied every run (e.g. "<town> recommend
   <trade>", "looking for <trade> near <town>", "<nearby town> best <trade> reddit", "who do you
   use for <service> <town>"), results from the last 14 days only. Use only the search result's
   URL, title and snippet; public pages only; never Facebook groups, Nextdoor or anything behind a
   login. Never open a page whose site forbids automated access.
4. Judge each candidate honestly: a real person, asking now, for what this client sells, in or
   near their area. Dedupe against leadlog by URL. Write every real one to leadlog (counted true)
   and the near-misses with counted false + why.
5. Send (specs/lead-tracking.md "Sending leads to the client", specs/quality.md "Leads"):
   Pro = each new lead at once, one email each, subject "New lead: <their ask in 6 words>";
   Growth clients get no lead emails (leads are sold on Pro only, Grayson Oct 27, 2026).
   Inside the reply desk (since Oct 31, 2026) the Gmail tool is present: send each email yourself
   (mcp__Gmail__send_message, plain text) and record the Gmail id on the row. Only a session
   WITHOUT Gmail writes each email as a drafts doc kind "leads", status "ready", clientId,
   priority true, with the finished subject + body + leadlog ids, for the desk's Lane D to send
   within the hour. Each lead: what they asked (their words),
   when, where (link), and a copy-ready suggested reply in the owner's voice. Record
   sentToClientAt + sentGmailId on every row. No new leads → send nothing to the client.
6. Learn: on the client, `leadSearch.stats` += {run, candidates, counted, bySource}. If a client
   has had 0 counted leads for 7 days, widen the plan this run (more towns, more synonyms, more
   subreddits) and write what changed. Never invent or pad a lead to fill a gap.
7. Any failure (Action red, search tool error, Gmail error) → alert (shared/alerts.md). Without
   a Gmail tool, write the alert as `office/alerts/lf-<day>-<slot>.json` = {id, what, link:"",
   fix, at, emailed:false} (commit, push); the reply desk emails it within the hour.

## Outputs
| Where | What |
|---|---|
| leadlog/<id> | every candidate judged (counted true/false) |
| clients/<id> | leadSearch (plan + stats) |
| Gmail | leads emails to clients (Gmail ids recorded) |
| repo | office/leadfinder/jobs/*, office/runlog.jsonl (`--task lead-finder`) |
