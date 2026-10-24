# Which stage handles my task

Read `CLAUDE.md` first. Then find your task below and go to its folder. Load nothing else
until that folder's CONTEXT.md tells you to.

| Scheduled task (name in the task list) | Folder | What it is |
|---|---|---|
| Ridgeline Office · Day Shift | `stages/day-shift/` | The daily run: Scout finds businesses, Quinn scores, Parker picks the angle, Echo writes and (when allowed) sends, Nova writes video briefs, Sage learns from replies, Patch checks health, Mara reports |
| Ridgeline · reply desk | `stages/reply-desk/` | Every 2 hours, every day: answers prospect replies, runs and sends the free AI check in the same run, welcomes paying clients, emails the crew's client work (`stages/reply-desk/CONTEXT.md`) |
| The week's standing order (Oct 23-30, 2026) | `specs/push-week-2026-10-23.md` | Mission numbers, daily targets per agent, the scoreboard, Grayson's taps; Mara loads it at stages 00 and 08 |
| A task assigned from the office page (tasks collection, status queued) | `stages/day-shift/CONTEXT.md` section "Assigned tasks" | Grayson queued a one-off job for a named agent |
| A tap on the Calls screen (lead.followUp pending) | `stages/reply-desk/CONTEXT.md` Lane G | Grayson called a business; the desk sends the free check (and the offer) within 2 hours. The call words live in `office/call_kit/` |
| A Medic ticket (`office/medic/queue/*.json`, status open) or a red lane on the Medic board | `stages/reply-desk/CONTEXT.md` Lane H | The Medic (`office/medic/`, plain Python on a GitHub Action every 30 min) could not fix it alone: fire the Day Shift once, or tell Grayson the one tap |
| Every run, before and after the work | `memory/MEMORY.md` (read first), `memory/agents/<id>.md`, `memory/handoffs/` | The crew's long-term memory (CLAUDE.md "Memory rule"): standing truths, gotchas, Grayson's decisions, each agent's durable memory; `python3 office/memory/memory.py show --agent <id>` |

## The crew (8 agents, one skill file each in `skills/`)

| Agent | Role | Judged on |
|---|---|---|
| Mara | Commander: runs the day, prioritizes, reports | runs finished clean, needs-you lines that were real |
| Scout | Lead research: finds businesses with weak online signals | verified leads with a source URL, zero invented facts |
| Quinn | Qualification: scores 0 to 100 with reasons | scores that predict replies (Sage checks) |
| Parker | Offer strategist: the angle and the hook per lead | reply rate by angle |
| Echo | Outreach writer: emails and follow-ups, approval gate, sending | replies per 100 emails, zero spam flags |
| Nova | Creative studio: video briefs, captions, calendar | videos filmed and posted, clicks to the site |
| Sage | Learning and review: verified outcomes to lessons | lessons with numbers, workflow changes that held up |
| Patch | Maintenance: site, database, failed tasks, backups | red lights caught before Grayson sees them |

## Day keys and time
Day key = Grayson's date in Central: `TZ=America/Chicago date +%F`. Prospects live in Central
time too (Oklahoma, Arkansas, Alabama).

## Status words (the only ones the page understands)
Lead: New, Researching, Qualified, Contacted, Replied, Meeting, Client, Not a fit, Suppressed.
Draft: draft, ready (awaiting Grayson), approved (send on next run), sent, rejected, published.
Task: queued, running, done, failed, blocked.
Crew: idle, working, paused, error.
