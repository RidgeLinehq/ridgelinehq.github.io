# Leads: where they come from, how they are logged, how we prove value

Grayson's standing order (Oct 24, 2026). Every lead we send a client is logged, so the
guarantee and the monthly report are built on real rows, never on a feeling.

## The lead log (database collection `leadlog`, one doc per lead)
`leadlog/<clientId>-<yyyymmdd>-<4 hex>` = {clientId, at (ISO), source, sourceUrl, contact:{name,
phone, email, handle}, summary (one line, their words), status, counted, sentToClientAt,
sentGmailId, jobAnswer:{askedAt, answer:"job"|"no job"|"pending"|"no answer", answeredAt, value},
createdBy, notes}
- source: "reddit" | "web-search" | "gbp-message" | "gbp-call" | "lead-page" | "client-forward"
  | "free-check-referral"
- status: new → sent (emailed to the client) → contacted (client says they reached out) → job |
  no job. Statuses change; rows are never deleted.
- counted: true for a real person asking for what the client sells, in/near their area, inside
  the window. false for spam, duplicates (same person or post within 30 days), the client's own
  tests, or anything older than 14 days when found. Write the reason in notes when false.
- Contact info is only what the source showed publicly or the person typed into a form. Never
  look a person up, never guess an email.
- The database is private; NOTHING from leadlog goes in the public repo.

## Allowed sources (only these; Grayson Oct 24, 2026: "must be legit")
| Source | How | Needs |
|---|---|---|
| Reddit (public posts asking for a recommendation) | Day Shift 09: one lead-finder job per run with a search per Pro client (town + kind of business, never the client's name), through the official Reddit Data API ("Ridgeline lead finder" Action, office/leadfinder/finder.py). | REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET secrets (SETUP_NEEDED.md). Until set, the out file says "not set up" and the source is skipped (noted in the report). |
| Public web posts found by search | Day Shift 09: WebSearch (the search engine's results only) for recent public posts asking for that kind of business in that town, e.g. "<town> recommend a good <trade>". Use the result's URL, title and snippet only. | nothing |
| The client's Google Business Profile | Once ridgelinemarketinghq@gmail.com is a Manager, Google emails new-message, new-call and lead notices to the Ridgeline Gmail; the reply desk (Lane G) logs each as a lead. Clients can also forward these emails. | client adds us as Manager (optional) |
| The Pro lead page | p/<slug>/ form → email "Lead for <slug> — <business>" to the Ridgeline Gmail (copy to the owner at once); the reply desk logs it. `source` field = the tracking link's ?src= value. | FormSubmit activated once (SETUP_NEEDED.md) |
| Client forwards | The owner forwards any inquiry to the Ridgeline Gmail with "lead" in the subject. | nothing |

NEVER: Facebook groups, Nextdoor, or any site that forbids automated access or needs a login;
buying or renting lists; scraping emails; messaging, DMing, commenting or posting to the people
we find; contacting a lead on the client's behalf. We send the lead to the client; the client
decides whether and how to answer.

## Sending leads to the client
- Pro only (Grayson, Oct 27, 2026: leads are sold on Pro, not Growth). Each lead the moment it
  is found in that run (one email per lead, subject "New lead: <one line>"), plain text: the
  source, the date, what they asked (their words, one line), the link or contact info, and one
  suggested next step for the owner ("Reply on the post with your shop name and booking link").
  Lead-page leads already reach the owner instantly by the form's copy, and the desk logs them.
- Growth clients get no Lead Finder emails. A Google-profile message or call notice for any
  client is still logged (it counts for the guarantee) and forwarded to the owner.
- Every send records sentToClientAt and sentGmailId on the row. No id, no "sent".

## "Did this lead turn into a job?" (monthly, Lane D of the reply desk)
On the client's monthly date (startedAt day-of-month), one email to the owner listing every lead
sent in the last 30 days still at status sent/contacted, numbered: "Reply with the numbers that
became jobs (e.g. 1, 4), or 'none'." Parse the reply: listed numbers → job, the rest → no job;
"none" → all no job; no reply in 7 days → no answer. Log jobAnswer on each row. Never assume.

## The monthly results report (Day Shift 09 drafts it, reply desk sends it)
Per client, plain text, under 250 words:
- Leads sent this month: N (by source), leads that became jobs: J (from their answers), "not
  answered yet" when unknown.
- AI visibility: score at start (baseline) vs now, and this month's trend line from aiTrend
  (e.g. "0 → 17 → 33"), plus who ChatGPT and Gemini name now.
- Reviews gained: review count at start vs now (from the public Google profile as Scout reads it
  via WebSearch, or the owner's reply). Unknown = "unknown", never a guess.
- Work done this month (from client.work and the profile changes log), next month's plan.
- Pro: competitor tracking (the businesses named instead of them, week by week) and the video link.
