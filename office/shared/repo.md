# The repo: RidgeLinehq/ridgelinehq.github.io

Canonical home for how every crew uses the Ridgeline GitHub repo. The repo is PUBLIC: it is the
website (index.html at the root, served at https://ridgelinehq.github.io) and it carries this
workspace under office/. Nothing private goes in it: no leads, no emails, no screenshots of
prospects, no backups.

## Getting it
- Check first: `git -C /home/claude/ridgeline remote -v` (a scheduled run may already have it,
  possibly at /home/claude/ridgelinehq.github.io; use whichever exists). Then `cd` there and
  `git pull --rebase`.
- Only if missing, the LIGHT clone (about 1 second and 500 KB; the full tree carries the
  studio's videos and photos, which no crew needs):
  `git clone --depth 1 --filter=blob:none --sparse https://github.com/RidgeLinehq/ridgelinehq.github.io /home/claude/ridgeline`
  then `git -C /home/claude/ridgeline sparse-checkout set office/shared office/specs office/stages office/skills office/gw office/cards office/health office/playbooks office/tools office/stripe office/leadfinder office/landing office/alerts office/instant office/emailcheck office/examples data p`
  An existing clone made before Oct 24, 2026: run `git sparse-checkout add office/stripe office/leadfinder office/landing office/alerts data p` once.
  An existing clone made before Oct 28, 2026: run `git sparse-checkout add office/examples office/instant office/emailcheck` once
  (office/examples holds the golden Welcome Pack that quality.md and the test buy read; a clone
  without it makes the crew draft blind).
  (root files such as index.html and office/CLAUDE.md, CONTEXT.md, LESSONS.md, runlog.jsonl come
  along automatically). Commits and pushes work normally from this clone. Do not use add_repo;
  it is not available in scheduled runs. Never `git add` anything under office/studio/.

## Committing
- `git config user.email noreply@anthropic.com` and `git config user.name Claude`.
- Commit message: short, starts with the crew or task name and the day key, and ends with the
  trailer line `Co-Authored-By: Claude <noreply@anthropic.com>`.
- `git pull --rebase` then `git push origin HEAD:main`. If rejected as non-fast-forward, pull
  --rebase and push again (up to 3 times).
- If a push fails with 403: do not retry. The office keeps working: write your lessons and skill
  lines into the database instead (collection `repo-pending`, doc `<day>-<agent>`, with the
  file path and the lines), write "GitHub access needs a look" into your crew doc's lastError
  and the run doc's needsYou, and finish the run. The next run with access replays
  `repo-pending` into the files and clears it.

## Serving files
- A pushed file is live at `https://ridgelinehq.github.io/<path>` within about a minute (GitHub
  Pages). `https://raw.githubusercontent.com/RidgeLinehq/ridgelinehq.github.io/main/<path>`
  within about 60 seconds. Check with `curl -sI` for a 200 before relying on it.
- robots.txt disallows /office/ so search engines skip the workspace; curious humans can still
  read it, which is why nothing private goes here.

## Write paths (one table; a crew writes ONLY inside its paths)

| Crew / task | May write |
|-------------|-----------|
| Day Shift (all workers) | office/skills/<own agent>/SKILL.md ("What I've learned" lines, or a proven rewrite of "Exact steps" after Sage's go), office/LESSONS.md, office/playbooks/, office/stages/day-shift/output/, office/runlog.jsonl |
| Sage | the above plus office/skills/*/SKILL.md "Exact steps" (only when a workflow/<version> doc says adopted) |
| Patch | the above plus index.html (a broken element only, after a 3-line plan and a before/after check; never copy, prices or the offer), office/health/ (site check outputs) |
| Reply desk | office/runlog.jsonl, office/gw/jobs/, office/cards/jobs/, office/stripe/jobs/ (guarantee, cancel, lookup), office/alerts/ (emailed flags), office/landing/ + p/<slug>/ (Pro lead pages) |
| Day Shift 09 (Clients) | the Day Shift paths plus office/gw/jobs/, office/leadfinder/jobs/, office/landing/ + p/<slug>/, office/studio/out/clients/ |
| Server work (only when Grayson asks for it in chat) | office/server/ |

Never write a client's or a lead's email, name or customer list into any job file: jobs carry
town + trade, an opaque Stripe session id, or a salted hash (office/stripe/stripe_ops.py --hash).
Never touch: `.github/`, `office/page/` (backups), `office/shared/` and `office/specs/` (Grayson's
standing orders; propose changes as a NEEDS YOU line), CNAME, any secret, any file that belongs
to another crew. Never force-push, never reset, never delete a folder.
