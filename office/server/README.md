# Ridgeline AI Office — server edition

The always-on edition of the Ridgeline Office: a FastAPI backend, a SQLite database, a worker
and a scheduler, and the same visual office floor as the phone page. It is **not** what runs
the business today (that is the Ridgeline Office artifact plus the scheduled Claude runs in
`office/`); it is the edition to deploy when you want the office on a server you control.

## What it does
- Stores leads, tasks, drafts, lessons, workflow versions, suppression, clients, runs, audit.
- Runs a **worker** that claims tasks atomically (one claim per task, 15-minute lease, 2
  attempts, resumes after restart) and executes them with the 8 agents.
- Runs a **scheduler** that queues the Day Shift pipeline every weekday at `day_shift_time`.
- Gates every email through `sending_gates()`: paused, dry run, mailing address, lead status,
  suppression list, max touches, weekday, send window, daily cap, approval or autosend + QA 80,
  configured provider. A blocked email stays approved with its reasons; nothing is lost.
- Learns only from verified outcomes (statuses, sends with message ids, call logs), refuses
  lessons under 20 sends, tests workflow versions on real sends, adopts or rolls back.
- Backs up the database (`backups/`, newest 14) on every Patch run and on demand.

## What is real vs. not configured (honest status at `/api/health`)
| Piece | Default | How to turn it on |
|---|---|---|
| AI (Quinn's angles, Parker, Echo, Nova) | not configured; those tasks fail with "not configured" | `ANTHROPIC_API_KEY`, optional `RIDGELINE_MODEL` |
| Research (Scout) | not configured; add leads by hand on the Lead Desk | `BRAVE_API_KEY` (Brave Search API) |
| Email (Echo sends) | draft-only; nothing is ever sent | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` (Gmail: an App Password), then turn dry run off in Settings |
| Reply reading | not automated here (the phone office's Sage reads the Ridgeline Gmail) | record a reply with `POST /api/replies/opt-out` or change the lead's status |
| Social publishing | never; Nova writes briefs, you post | — |
| Payments | not integrated; add clients by hand | — |

Scoring without a research provider: Quinn needs review counts or a search check to say "Not a
fit"; a lead with no profile facts stays **Researching** until someone adds them.

## Run it (any computer, or a $5-7/month host)
```
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # fill in what you have; export the variables (or let the host set them)
uvicorn app:app --host 127.0.0.1 --port 8000
```
Open http://127.0.0.1:8000. Tests: `pytest -q` (30 tests; all providers mocked, nothing sent).

Worker in its own process (optional): `RIDGELINE_WORKER=false uvicorn app:app ...` plus
`python worker.py`. Both may run at once; task claims are atomic.

## Deployment, plainly
- **Local (laptop/desktop):** works while the computer is on. Close the lid and the worker
  stops. The phone's browser is never needed for background work; the server is.
- **Always-on host:** Docker image included (`Dockerfile`, data in `/data`). Any small VPS or
  container host works; expect about $5 to $7 a month for an always-on instance. Free tiers
  that sleep when idle will miss the morning Day Shift, so this app does not promise free 24/7.
- **Before exposing it:** set `RIDGELINE_TOKEN` (state-changing endpoints require it; reads are
  open), put it behind HTTPS (the host's proxy or Caddy), and keep secrets in the host's
  environment, never in the repo. Without a token the app refuses state changes from anywhere
  but localhost.
- Costs you control: AI tokens (tracked at `/api/usage`; set `RIDGELINE_COST_PER_MTOK_*` from
  the provider's current price list to see dollars), a search API plan, hosting.

## Phone-friendly next step
Nothing to install on the iPhone. When you want this edition live, open a small VPS or container
host from Safari, create a Python service from this folder (or the Dockerfile), set the
environment variables from `.env.example`, and open the URL. The dashboard is mobile-first.

## Files
`app.py` API, database, gates, agents, worker, scheduler · `providers.py` AI, research and email
adapters · `dashboard.html` the UI · `worker.py` standalone worker · `test_app.py` tests ·
`Dockerfile`, `.env.example`, `requirements.txt`.
