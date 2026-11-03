# Leads: where they come from, how they are logged, how we prove value

Grayson's standing order (Oct 24, 2026). Every lead we send a client is logged, so the
guarantee and the monthly report are built on real rows, never on a feeling.
Nov 3, 2026: every plan has a quote-request page, so every plan gets leads logged, alerted within
minutes and asked about monthly. The Lead Finder (Reddit + web search) stays Pro only.

## The lead log (database collection `leadlog`, one doc per lead)
`leadlog/<clientId>-<yyyymmdd>-<4 hex>` = {clientId, at (ISO), source, sourceUrl, contact:{name,
phone, email, handle}, summary (one line, their words), what, when, area, followUpTip, status,
counted, sentToClientAt, sentGmailId, jobAnswer:{askedAt, answer:"job"|"no job"|"pending"|"no
answer", answeredAt, value, source:"email"|"dashboard"}, dashboardId ("L-0007", Nov 3, 2026),
createdBy, notes}
- The lead standard (Nov 3, 2026): every lead sent or logged carries name, contact, what they
  want, when, where (area), source and date, plus the follow-up tip (one line, the owner's best
  next move: "Call before 5 today; they want a quote this week"). A piece the source didn't give
  = "not given", never guessed.
- source: "reddit" | "web-search" | "gbp-message" | "gbp-call" | "lead-page" | "client-forward"
  | "free-check-referral"
- status: new → sent (emailed to the client) → contacted (client says they reached out) → job |
  no job. Statuses change; rows are never deleted.
- counted: true for a real person asking for what the client sells, in/near their area, inside
  the window. false for spam, duplicates (same person or post within 30 days), the client's own
  tests, or anything older than 14 days when found. Write the reason in notes when false.
- Contact info is only what the source showed publicly or the person typed into a form. Never
  look a person up, never guess an email.
- The database is private; NOTHING from leadlog goes in the public repo except the dashboard's
  lead list below (id, date, what, when, source, status; never contact, summary, area, details
  or the URL).
- dashboardId (Nov 3, 2026): "L-" + a 4-digit number per client, in logging order, given when
  the row is created, never reused or renumbered. It is the only piece of a lead that reaches the
  public dashboard JSON, so the owner's answer on the dashboard can be applied to the right row.

## Allowed sources (only these; Grayson Oct 24, 2026: "must be legit")
| Source | How | Needs |
|---|---|---|
| Reddit (public posts asking for a recommendation) | Day Shift 09: one lead-finder job per run with a search per Pro client (town + kind of business, never the client's name), through the official Reddit Data API ("Ridgeline lead finder" Action, office/leadfinder/finder.py). | REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET secrets (SETUP_NEEDED.md). Until set, the out file says "not set up" and the source is skipped (noted in the report). |
| Public web posts found by search | Day Shift 09: WebSearch (the search engine's results only) for recent public posts asking for that kind of business in that town, e.g. "<town> recommend a good <trade>". Use the result's URL, title and snippet only. | nothing |
| The client's Google Business Profile | Once ridgelinemarketinghq@gmail.com is a Manager, Google emails new-message, new-call and lead notices to the Ridgeline Gmail; the reply desk (Lane G) logs each as a lead. Clients can also forward these emails. | client adds us as Manager (optional) |
| The quote page (every plan, Nov 3, 2026) | p/<slug>/ form (name, phone, email, what, when, area, details) → email "Lead for <slug> — <business>: <name> · <what> · <when>" to the Ridgeline Gmail with _cc to the client's email and, when they chose "text and email", their own cell's carrier email-to-text address (within minutes; carrier table in specs/client-delivery.md "The flow"), with follow_up_tip. The reply desk (Lane G) logs it: source "lead-page", sourceUrl = the tracking link's ?src= value, counted for every plan. The crew's setup test and the client's own tests are counted false. | FormSubmit activated once (SETUP_NEEDED.md) |
| Client forwards | The owner forwards any inquiry to the Ridgeline Gmail with "lead" in the subject. | nothing |

NEVER: Facebook groups, Nextdoor, or any site that forbids automated access or needs a login;
buying or renting lists; scraping emails; messaging, DMing, commenting or posting to the people
we find; contacting a lead on the client's behalf. We send the lead to the client; the client
decides whether and how to answer.

## Sending leads to the client
- Lead Finder leads: Pro only (Grayson, Oct 27, 2026: the Lead Finder is sold on Pro). Each
  lead the moment it is found in that run (one email per lead, subject "New lead: <one line>"),
  plain text: the source, the date, what they asked (their words, one line), when, where, the
  link or contact info, and the follow-up tip ("Reply on the post with your shop name and
  booking link").
- Quote-page leads (every plan, Nov 3, 2026) reach the owner within minutes by the form's own
  _cc (email, and text to their cell when they chose it) with name, contact, what, when, area
  and the follow-up tip; the desk logs them and sends nothing more unless the copy failed.
- A Google-profile message or call notice for any plan is logged (it counts for the guarantee)
  and forwarded to the owner with a follow-up tip. Starter and Growth get no Lead Finder emails.
- Every send records sentToClientAt and sentGmailId on the row. No id, no "sent".

## "Did this lead turn into a customer?" (monthly, every plan since Nov 3, 2026; Lane D of the reply desk)
On the client's monthly date (startedAt day-of-month), one email to the owner listing every lead
sent in the last 30 days still at status sent/contacted AND still pending (no jobAnswer, or
"pending" / "no answer"; a lead already answered on the dashboard is left out, and nothing
pending = no email that month), numbered: "Reply with the numbers that
became customers (e.g. 1, 4), or 'none'." Parse the reply: listed numbers → job, the rest → no
job; "none" → all no job; no reply in 7 days → no answer. Log jobAnswer on each row (the field
keeps its name; "job" = became a customer; source "email"). Never assume.
The dashboard path (Nov 3, 2026): the dashboard shows the same leads by dashboardId and the
owner taps customer / no-customer / pending on each. It arrives as a "Dashboard — <business>
[<token>]: lead-outcome" email (reply desk Lane K) and counts exactly like a monthly-email
answer: jobAnswer {answer "job" | "no job" | "pending", answeredAt now, source "dashboard"} on
that row, status job / no job, and the JSON refreshed the same run. Two answers for one lead:
the newer one stands. The guarantee and the report read jobAnswer and never care which path.

## The dashboard's lead list (leads.items; Nov 3, 2026)
data/results/<token>.json (specs/client-delivery.md "Dashboard (the results page)") carries one
item per counted lead: {id: dashboardId, at: the date only, what, when (as typed), source,
status}. NO names, phones, emails, addresses, handles or URLs: contact, summary, area, details
and sourceUrl never leave the database. source maps from the row: lead-page → "quote-page";
gbp-message, gbp-call → "google-profile"; reddit, web-search → "lead-finder"; client-forward,
free-check-referral → "client-forward". status: "customer" (jobAnswer job), "no-customer" (no
job), "pending" (asked and not answered, or the owner tapped pending), "new" (logged, not asked
yet). Leads counted false are left out. Whoever logs or answers a lead (desk Lanes G and K, Day
Shift 09 7b) refreshes the list in the same run.

## The monthly results report (Day Shift 09 drafts it, reply desk sends it)
Per client, every plan, plain text, under 250 words:
- Leads this month: N (by source; lead-page and gbp on every plan, reddit/web-search on Pro),
  leads that became customers: J (from their answers, by email or on the dashboard), "not
  answered yet" when unknown.
- Growth/Pro: AI visibility: score at start (baseline) vs now, and this month's trend line from
  aiTrend (e.g. "0 → 17 → 33"), plus who ChatGPT and Gemini name now.
- Reviews gained: review count at start vs now and the star-rating change (from the public
  Google profile as Scout reads it via WebSearch, or the owner's reply). Unknown = "unknown",
  never a guess.
- Work done this month (from client.work and the profile changes log), next month's plan.
- Pro: competitor tracking (the businesses named instead of them, week by week) and the video link.
- (Nov 3, 2026) The report email's note IS the monthly check-in (specs/client-happiness.md §1:
  wins + the one next step, under 120 words, the dashboard link; one email, never two). The
  same run writes data/results/<token>.json (specs/client-delivery.md "Dashboard (the results
  page)", numbers only) BEFORE the email goes out, so the link shows this month's numbers.
