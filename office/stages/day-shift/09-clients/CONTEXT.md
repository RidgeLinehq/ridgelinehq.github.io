# 09 Clients: make the product work for every paying client (runs when any client is active)

Grayson's standing order (Oct 24, 2026): for every paying client the crew automatically
optimizes their Google profile and tracks changes, runs review requests to their REAL customers,
re-checks AI visibility weekly and logs the trend, finds and sends leads (Pro), and flags
any client whose numbers are flat after 2 weeks and tries new fixes on its own. No approvals.
The reply desk owns signup, baseline, the day-28 guarantee check and lead intake; this stage
owns the work.

## Inputs
| File | Section |
|---|---|
| specs/client-delivery.md | all |
| specs/quality.md | all (every drafted item passes it before status ready; reports and packs are branded PDFs via office/tools/make_pack.js) |
| specs/lead-tracking.md | all |
| specs/offer.md | The plans, Promises the crew may NOT make |
| shared/gateway.md | Protocol |
| shared/alerts.md | all |
| skills/echo/SKILL.md, skills/parker/SKILL.md | all |
| database: clients where status == active (out_dir); leadlog for those clients, last 45 days (out_dir); drafts where clientId set, newest 10 per client | |
| Tools: WebSearch (profile checks, web-search leads, review counts), Gmail read-only for the client's thread | |

## Process (per active client, oldest first; write the crew doc "working: Clients: <business>")
1. **Week 1 items** not yet done (client.work): profile audit, profile fixes ("buildout-plan",
   drafts kind "plan"), review kit (kind "kit": the text + card link + "send us your customers'
   emails"), Pro lead page if the desk hasn't built it. Status "ready", clientId set; the desk
   emails them. No reviewLink yet → kit uses the "Get more reviews" how-to and asks for it.
2. **Review requests:** customers in client.customers with askedAt null → one drafts doc kind
   "reviewreq" with recipients (max 25) and the request text (rules in client-delivery.md).
   None given yet and the kit went out 7+ days ago → one short ask to the owner for 10 emails
   (kind "fix"). Never more than one ask per 14 days.
3. **Weekly AI re-check** (last aiTrend point 7+ days old): batch the due clients' aiQuestions
   into gateway jobs (max 6 queries per job), wait for the out files (protocol), score each with
   `python3 office/tools/ai_score.py --name "<business>" --keys <their 3 keys> <out file>`,
   append {at, score, jobId, named:{chatgpt, gemini}} to client.aiTrend. Pro: store
   competitorsNow (the businesses named instead of them) and the change since last week.
4. **Profile check** (weekly): WebSearch the client's Google listing ("<business> <town>"):
   review count + rating, categories, hours, description snippet, photos count where shown.
   Compare with client.audit and the fixes sent; append changes to client.profileLog
   [{at, field, before, after, source}]; reviewsNow = the public count with its date. A fix
   not live after 7 days → one nudge draft (kind "fix") with just that step.
5. **Lead Finder** (Pro only): the dedicated Lead Finder task (stages/lead-finder/, twice a day, every day) owns this. Here, only check its last run line in office/runlog.jsonl is under 14 hours old (else alert) and fold its stats into the report. The steps below are its fallback if it hasn't run today:
   a. Reddit: one lead-finder job for all due clients: `office/leadfinder/jobs/lf-<day>-<4 hex>.json`
      = {"id", "searches":[{"key":"<town>-<st>-<trade slug>", "town", "state", "terms":[3 to 5
      words people use for their service], "subreddits":[the town's and the nearest city's
      subreddit names], "days":7}]} (NEVER the client's name), commit, pull --rebase, push,
      poll `office/leadfinder/out/<same file>` (15 s, up to 6 min). "not set up" → skip, note it.
   b. Web search: 2 WebSearch queries per client (e.g. "<town> recommend <trade>", "looking
      for <trade> <town>"), last 14 days only, public pages only (never Facebook groups,
      Nextdoor or anything behind a login). Use only the result's URL, title and snippet.
   c. Every real ask → leadlog row (specs/lead-tracking.md), dedupe by URL. counted true only
      when it is a person asking for what the client sells in/near their town.
   d. New counted leads (Pro only) → drafts kind "leads" (one per lead,
      priority). The desk sends them within 2 hours; Pro leads found in this run also go out in
      this run if the Gmail send tool is available here (record the id), else the desk's next run.
6. **Flat check** (client day 14+, every 14 days): FLAT = no aiTrend point above baseline AND
   (Pro) 0 counted leads AND reviews gained 0 or unknown. Flat → pick the next 2 untried
   fixes from the ladder in client-delivery.md, do them in this run (draft what goes to the
   owner as kind "fix", add searches, etc.), record client.fixesTried. Also add the line
   "<business> flat at day N; tried: <fix>, <fix>" to the run notes for the morning report.
7. **Monthly** (on the client's monthly date): drafts kind "jobcheck" (Growth/Pro) and kind
   "report" (all plans) per specs/lead-tracking.md; Pro: the promo video (Nova, studio), linked
   in the report. Real numbers only; unknown = "unknown".
8. Weekly Google post draft (kind "post"), Mondays.
9. Anything that failed for a client (gateway 3x, lead finder error, a WebSearch dead end that
   blocks a promised item) → alert (shared/alerts.md) and a line in the run notes. If a promise
   on the website can't be delivered, NEEDS YOU "Website promises <x>, we can't deliver it yet:
   change the wording or tell me how" (the crew does not quietly skip it).
10. Crew doc idle: "<n> clients: <items drafted>, <leads> leads, <flat> flat".

## Audit
Every drafted item has qa {score, weakest, rewrites} per specs/quality.md and 85+ (or 75+ with
an alert). Every drafted item names the client and uses only facts from the client, the lead log, the
gateway text or a source URL. No invented review counts, leads or scores. Nothing from leadlog
or client.customers in the repo. Lead finder and gateway jobs carry town + trade only.

## Outputs
| Where | What |
|---|---|
| drafts/<id> (kinds plan, kit, reviewreq, fix, leads, jobcheck, report, post) | status ready, clientId set |
| clients/<id> | work[], aiTrend, competitorsNow, profileLog, reviewsNow, fixesTried, flatAt, reportDue, updatedAt |
| leadlog/<id> | new leads |
| repo | office/gw/jobs/*, office/leadfinder/jobs/*, office/landing/*.json + p/<slug>/ (Pro) |
| events/<day> | "Clients: <n> active, <m> items drafted, <l> leads, <f> flat" |
| output/<day>-run.md | `## Clients`: per client one line: score trend, leads, items drafted, flat?, next due |
