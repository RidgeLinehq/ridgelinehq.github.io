# The Medic (V8 "The Turning Point", Oct 24, 2026)

Self-repair for the Ridgeline Office, in plain Python on GitHub's free minutes. Every 30 minutes
(`.github/workflows/medic.yml`) it reads this repo's own signals, fixes what it can for free,
checks the fix is live, learns, and writes `public/medic_report.json` for the Today screen.

| File | What it is |
|---|---|
| `medic.py` | the engine (`--dry-run`, `--selftest`, `--board`) |
| `lanes.json` | every lane: its signal, daily goal, fix playbook; the crews' cadences; the words for "needs you" |
| `schema.sql` + `db/history.sqlite` | runs, incidents, lessons, fix attempts (fix-once), lane days |
| `lessons/<lane>.md`, `lessons/RULES.md` | what broke and what fixed it; a fix that worked 3 times becomes a rule |
| `queue/*.json` | tickets for the reply desk: fixes that need a Claude crew (rebuild, re-send, fire a task) |
| `public/medic_report.json` | the board, what was fixed, what needs Grayson, yesterday's numbers |

Signals it reads: `office/runlog.jsonl` (Day Shift and reply desk lines), `office/gw/jobs` vs `office/gw/out` (AI checks),

What it fixes itself: an AI check the Action never picked up (re-dispatch, verify the answer
lands), a website that stopped answering (ask GitHub Pages to rebuild, verify it answers again),
a failed Action (re-run once). Everything else becomes a
ticket for the reply desk, who reads `queue/` on each run. Grayson is told only when neither can fix it.

Rules: fix each thing at most once a day; never spend; parked lanes (none here; the Agency.s parked lanes are not Ridgeline.s business)
are never checked; unknown stays unknown; this repo is public, so ids only in tickets (never an email or a phone).
The GM Agency has its own copy under `medic/` in the Planner repo; the two never link.
