# Second Month Free Guarantee: how it is measured and paid (fully automatic)

Grayson's standing order (Nov 3, 2026; replaces Oct 24). Website wording (word for word): "If your
first month brings you zero new leads AND zero new reviews, your second month is free. No
arguing." Terms: https://ridgelinehq.github.io/guarantee.html. Covers ALL plans (Starter, Growth,
Pro). The AI score no longer gates the guarantee; the AI baseline and the day-28 re-check still
run for every client because the monthly report and the results page use them.
Owner: the reply desk (it runs every 2 hours, every day, so day 28 is never missed on a weekend).

## 1. Baseline (day 0, the run that creates the client)
1. The client's 3 questions (town-level, never their name; the repo is public):
   - `<town>-<st>-<slug>-q1`: "Who are the best <trade phrase> in <Town>, <ST>?"
   - `<town>-<st>-<slug>-q2`: "Can you recommend a good <trade singular> in <Town>, <ST>?"
   - `<town>-<st>-<slug>-q3`: "Which <trade phrase> in <Town>, <ST> have the best reviews?"
   Trade phrase rules: specs/free-check.md step 1. Store the keys and exact questions on the
   client as `aiQuestions` so day 28 asks exactly the same thing.
2. One gateway job with those 3 queries (shared/gateway.md protocol). A fresh job, never a cached
   out file: the baseline must be dated on/after the signup day.
3. Score: `python3 office/tools/ai_score.py --name "<business>" --keys <q1,q2,q3> office/gw/out/<file>.json`.
   (Oct 28, 2026: ai_score.py prints a WARNING and adds "warning" to its JSON when the keys are not
   exactly the client's 3 distinct questions; a warned score is a first check, never the baseline.)
   Save on the client: `baseline = {score, points, answers, jobId, at, detail}` and append the
   same to `aiTrend` (the weekly history).
4. Reviews at day 0 (Nov 3, 2026), recorded next to the AI baseline: the public Google review
   count and star rating. Read it, first that works: a WebSearch of the public listing
   ("<business> <town> <ST> google reviews"; the listing shows "4.8 (123)"), the onboarding
   form's review_link (open the public place page), or the Manager view of the profile. None
   readable → "unknown" (never a guess, never 0 as a stand-in). Save on the client:
   `reviewsAtStart = {count, rating, source, at}` (count and rating are numbers or "unknown") and
   append the same to `reviewTrend`.
5. Email the client their starting numbers in the welcome thread: the AI score, who ChatGPT and
   Gemini named, the exact question asked, and their review count and rating today. Every plan
   gets the baseline (it powers the monthly report and the results page) and every plan gets the
   guarantee line.
6. Gateway failed → retry next run (max 3 runs), then alert Grayson (shared/alerts.md). The
   guarantee clock does not wait: if no baseline exists by day 7, the client's baseline score is
   recorded as 0 (the most generous reading for the client) and the alert says so. The AI score
   does not change what is owed (§3), so a missing baseline never blocks the day-28 check.

## 2. Tracked leads (all month, every plan)
Only rows in `leadlog` with clientId = this client, `counted: true`, created between startedAt
and the check (specs/lead-tracking.md says what counts). Sources: the client's quote-request page
form (p/<slug>/, "Lead for <slug>" emails), Google profile message/call notices (Manager
access), the Pro Lead Finder, and leads the client forwards to us. Spam, duplicates and tests are
logged with counted:false and never counted.

## 2b. New reviews (day 28)
1. reviewsNow = the public Google review count and rating at the check, read the same way as
   §1.4 (WebSearch of the public listing, the form's review_link, or the Manager view; none
   readable = "unknown"). Append to `reviewTrend`.
2. reviewsGained = reviewsNow.count - reviewsAtStart.count.
3. If either side is "unknown", reviewsGained is treated as 0 (the client's favor: a count we
   could not read never costs them the credit). Note which side was unknown in client.guarantee.

## 3. The check (day 28 after startedAt, first reply-desk run on or after it)
Day 28, not 30, so the credit lands before Stripe bills month 2 (Stripe bills on day ~30/31).
1. Re-run the SAME 3 questions as a fresh gateway job; score with ai_score.py. Append to aiTrend.
   The report and the results page use it; it does not change what is owed.
2. leads = count of counted leadlog rows for the client (§2).
3. reviewsGained per §2b.
4. owed = (leads == 0) AND (reviewsGained <= 0).
5. Write `client.guarantee = {checkedAt, leads, reviewsAtStart, reviewsNow, reviewsGained,
   baselineScore, dayScore, owed, jobId, stripeJob, applied:false}`.
6. If the gateway fails 3 runs in a row at the check: record dayScore as baseline.score in
   aiTrend (no trend claimed) and alert Grayson; owed is unaffected, so a broken AI tool never
   delays or costs the client their guarantee.

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
   "Your second month is on us. Your first month brought 0 new leads and 0 new reviews, so per
   our guarantee your second month is free. The credit is already on your account (<what>). We
   keep working as normal." Tell Grayson one line ("Guarantee applied for <business>: month 2
   free").
4. ok false → alert Grayson at once with the error and the fix (shared/alerts.md); retry the job
   once next run with a new id; never email the client that it was applied until ok is true.
5. Not owed → email the client their day-28 numbers in one short paragraph (leads, new reviews
   and star rating then vs now, AI score then vs now) as part of the first monthly report;
   nothing in Stripe.

## Honesty
Never nudge a score, never drop a counted lead, never guess a review count, never skip a check.
The numbers in the client's email are the numbers in the database. If anything is uncertain, the
client gets the credit.
