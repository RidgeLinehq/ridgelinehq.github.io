# 07 Patch: health, self-fix once, backup

## Inputs
| File | Section |
|---|---|
| skills/patch/SKILL.md | all |
| shared/repo.md | Write paths |
| references/database-fields.md | health |
| database: health/main, tasks where status in (running, failed), crew/*, runs (newest 3), settings/main | |

## Process
1. Crew doc working: "Checking the office".
2. Site: WebFetch https://ridgelinehq.github.io (prompt: list the page title, whether the
   pricing shows Starter $75, Growth $125 and Pro $199, whether the "Get my free AI check" button
   and the email ridgelinemarketinghq@gmail.com appear, and any visible error). Also read
   https://ridgelinehq.github.io/data/stripe-links.json: empty links = yellow "checkout not live
   yet" until the STRIPE_SECRET_KEY secret exists, then red if still empty after 2 hours (alert). Also `curl -sI` the raw file for a 200 and the time taken.
   Missing price, link or email = red; slow or odd = yellow; fine = green. Record health.site.
   A broken element (not copy) that Patch can fix with a surgical edit: 3-line plan in the run
   doc, edit index.html, verify the raw file after push shows the fix; otherwise NEEDS YOU.
3. Database: count leads and drafts; a crew doc "working" from a run that is not running
   (updatedAt older than 2 hours) → set idle with lastError "reset by Patch". Tasks "running"
   with startedAt older than 2 hours → failed, error "timed out" (attempts stays). Tasks failed
   with attempts < maxAttempts and no retry today → status queued (one retry), note it.
4. Runs: `python3 office/shared/runlog.py --status` and `--summary 7`; the last Day Shift
   failed, or minutes over double the 7-day average → "watching" with the number.
5. Lights: leads (green if Scout added leads in the last 2 runs, yellow if 1, red if 0 twice),
   outreach (green if drafts ready/sent today or nothing due; red if a blocker like empty
   address; yellow if ready drafts older than 2 days wait on Grayson), replies (green if Sage
   ran; yellow if a reply is unanswered 24h; red if the reply desk task is disabled or failed),
   site, runs.
6. Backup: export settings, leads, drafts, clients, lessons, suppression, workflow (out_dir →
   one JSON) to office-backup-<day>.json; upload as an asset (database.md "Files"); record in
   health.backups (newest 14). Never into the repo.
7. Crew doc idle: "<lights>".

## Audit
Fix-once: each fix at most once per day, logged in health.fixed. No index.html change without
a plan line and a post-push check. Backup asset id recorded or "backup failed: <why>".

## Outputs
| Where | What |
|---|---|
| health/main | lights, site, db, needsYou, fixed, watching, failedTasks, backups |
| tasks/<id>, crew/<agent> | resets and retries |
| events/<day> | "Patch: <lights>; fixed <n>; needs you <m>" |
| output/<day>-run.md | `## Patch`: lights, fixed, needs you, backup asset id |
