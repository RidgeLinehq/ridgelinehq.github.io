# Which stage handles my task

Read `CLAUDE.md` first. Then find your task below and go to its folder. Load nothing else
until that folder's CONTEXT.md tells you to.

| Scheduled task (name in the task list) | Folder | What it is |
|---|---|---|
| Ridgeline Office · Day Shift | `stages/day-shift/` | The daily run: Scout finds businesses, Quinn scores, Parker picks the angle, Echo writes and (when allowed) sends, Nova writes video briefs, Sage learns from replies, Patch checks health, Mara reports |
| Ridgeline · reply desk | `stages/reply-desk/` | Every 2 hours, every day: emails alerts, answers prospect replies, runs and sends the free AI check, signs up paying clients (onboarding form, baseline AI check), runs the day-28 guarantee check and Stripe credit, logs leads, emails the crew's client work (`stages/reply-desk/CONTEXT.md`) |
| Ridgeline · Lead Finder | `stages/lead-finder/` | 8:23 AM and 4:23 PM Central, every day: finds, logs and sends leads for every Pro client (`stages/lead-finder/CONTEXT.md`) |
| The week's standing order (Oct 31 to Nov 7, 2026) | `specs/buyers-week-2026-10-31.md` | Mission numbers, daily targets per agent, the scoreboard, Grayson's taps; Mara loads it at stages 00 and 08 |
| A task assigned from the office page (tasks collection, status queued) | `stages/day-shift/CONTEXT.md` section "Assigned tasks" | Grayson queued a one-off job for a named agent |

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
Lead callStatus (Grayson's call word, a separate field; Oct 26, 2026): New, Called, Voicemail,
Callback, Interested, Sold, Not interested, Do not contact. Never overwrite one with the other.
Draft: draft, ready (awaiting Grayson), approved (send on next run), sent, rejected, published.
Task: queued, running, done, failed, blocked.
Crew: idle, working, paused, error.
