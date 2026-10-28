# Second Month Free Guarantee: how it is measured and paid (fully automatic)

Grayson's standing order (Oct 24, 2026). Website wording (word for word): "If your first month
brings you zero tracked leads AND no improvement in your AI visibility, your second month is free.
No arguing." Terms: https://ridgelinehq.github.io/guarantee.html. Covers Growth and Pro only.
Owner: the reply desk (it runs every 2 hours, every day, so day 28 is never missed on a weekend).

## 1. Baseline (day 0, the run that creates the client)
1. The client's 3 questions (town-level, never their name; the repo is public):
   - `<town>-<st>-<slug>-q1`: "Who are the best <trade phrase> in <Town>, <ST>?"
   - `<town>-<st>-<slug>-q2`: "Can you recommend a good <trade singular> in <Town>, <ST>?"
   - `<town>-<st>-<slug>-q3`: "Which <trade phrase> in <Town>, <ST> have the best reviews?"
   Trade phrase rules: specs/free-check.md step 1. Store the keys and exact questions on the
   client as `aiQuestions` so day 30 asks exactly the same thing.
2. One gateway job with those 3 queries (shared/gateway.md protocol). A fresh job, never a cached
   out file: the baseline must be dated on/after the signup day.
3. Score: `python3 office/tools/ai_score.py --name "<business>" --keys <q1,q2,q3> office/gw/out/<file>.json`.
   (Oct 28, 2026: ai_score.py prints a WARNING and adds "warning" to its JSON when the keys are not
   exactly the client's 3 distinct questions; a warned score is a first check, never the baseline.)
   Save on the client: `baseline = {score, points, answers, jobId, at, detail}` and append the
   same to `aiTrend` (the weekly history).
4. Email the client their starting score in the welcome thread: the score, who ChatGPT and
   Gemini named, the exact question asked. (Starter clients get the baseline too; it powers the
   monthly report. Only Growth/Pro get the guarantee lines.)
5. Gateway failed → retry next run (max 3 runs), then alert Grayson (shared/alerts.md). The
   guarantee clock does not wait: if no baseline exists by day 7, the client's baseline score is
   recorded as 0 (the most generous reading for the client) and the alert says so.

## 2. Tracked leads (all month)
Only rows in `leadlog` with clientId = this client, `counted: true`, created between startedAt
and the check (specs/lead-tracking.md says what counts). Spam, duplicates and tests are logged
with counted:false and never counted.

## 3. The check (day 28 after startedAt, first reply-desk run on or after it)
Day 28, not 30, so the credit lands before Stripe bills month 2 (Stripe bills on day ~30/31).
1. Re-run the SAME 3 questions as a fresh gateway job; score with ai_score.py. Append to aiTrend.
2. leads = count of counted leadlog rows for the client.
3. owed = (leads == 0) AND (dayScore <= baseline.score).
4. Write `client.guarantee = {checkedAt, leads, baselineScore, dayScore, owed, jobId, stripeJob, applied:false}`.
5. If the gateway fails 3 runs in a row at the check: treat dayScore as baseline.score (no
   improvement) so a broken tool never costs the client their guarantee, and alert Grayson.

## 4. Paying it (only when owed)
1. Stripe job file `office/stripe/jobs/g-<clientId>-<day>.json`:
   - with the checkout session id from the onboarding form: `{"id": "g-<clientId>-<day>", "action": "guarantee", "session": "<cs_...>"}`
   - otherwise: `{"id": ..., "action": "guarantee", "emailHash": "<python3 office/stripe/stripe_ops.py --hash <customer email>>"}`
   NEVER the email, name or business in the file (public repo).
2. Commit, `git pull --rebase`, `git push origin HEAD:main`. The "Ridgeline Stripe" Action runs on
   the push (and hourly) and writes `office/stripe/out/<same name>`: {ok, what, error}.
   Poll it (git fetch + git show origin/main:office/stripe/out/<file>) every 20 s for up to
   5 minutes; if not there yet, check again next run.
3. ok true → client.guarantee.applied = true, appliedAt, what. Email the client in their thread:
   "Your second month is on us. Your first month brought <0> tracked leads and your AI
   visibility score went from <x> to <y>, so per our guarantee your second month is free. The
   credit is already on your account (<what>). We keep working as normal." Tell Grayson one
   line ("Guarantee applied for <business>: month 2 free").
4. ok false → alert Grayson at once with the error and the fix (shared/alerts.md); retry the job
   once next run with a new id; never email the client that it was applied until ok is true.
5. Not owed → email the client their day-28 numbers in one short paragraph (leads, score then vs
   now) as part of the first monthly report; nothing in Stripe.

## Honesty
Never nudge a score, never drop a counted lead, never skip a check. The numbers in the client's
email are the numbers in the database. If anything is uncertain, the client gets the credit.
