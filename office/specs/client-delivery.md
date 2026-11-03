# Client delivery: signup to results, fully automatic

Grayson's standing order (Oct 24, 2026): "Fully automatic. No approvals from me." Every step
below is done by the crew, or by one Action, or is one tap for the client. Grayson is told, never
asked, except for the alerts in shared/alerts.md.
Grayson's standing order (Nov 3, 2026): every plan is "Leads + Reviews" from day one: a
quote-request page with lead alerts, review requests and review replies, a private results page
and one monthly check-in. Starter $39.99 gets all of it; Growth $75 adds the weekly AI checks,
monthly profile updates and Google posts; Pro $125 adds the AI Lead Finder and competitor
tracking (specs/offer.md).

## The flow
1. **Pick a plan** on https://ridgelinehq.github.io/#pricing → start.html → Stripe checkout (link
   from data/stripe-links.json, made by the "Ridgeline Stripe" Action).
2. **Pay.** Stripe redirects to welcome.html?plan=<plan>&billing=<b>&session_id=<cs_...> and
   emails ridgelinemarketinghq@gmail.com the payment.
3. **Onboarding form** (welcome.html): business name, Google profile link, phone, services, city,
   email, and (Nov 3, 2026) lead_cell, lead_carrier, lead_alerts ("text and email" | "email
   only"), industry (insurance-agents | roofers | home-services | salons | other), service_area,
   hours, review_link, customers (names + emails, one per line, up to 10 real recent customers),
   notes. It arrives in the Ridgeline Gmail as "Onboarding — <business>" (FormSubmit). Every
   field is stored on the client (stages/reply-desk Lane C step 2).
4. **Reply desk, Lane C** (within the hour, any day, every plan): creates clients/<id>, sends the
   welcome, runs the baseline AI check (specs/guarantee.md §1), reads the client's playbook
   (office/playbooks/<industry>.md; "other" = these specs), then the same-day setup (Nov 3, 2026):
   - **Quote page** for every plan: office/landing/<slug>.json → make_landing.py → commit
     p/<slug>/, with the tracking links (?src=gbp, ?src=card, ?src=facebook). The form collects
     name, phone, email, what, when, area, details and emails "Lead for <slug> — <business>:
     <name> · <what> · <when>" to the Ridgeline inbox with _cc to the client, plus a follow_up_tip.
   - **Lead alerts** (Nov 3, 2026): leadEmail = the client's email, always (the Gmail app shows it on
     their phone within seconds). Texts, in this order: (1) Ridgeline Instant texts the client's own
     cell through Twilio the minute the "Lead for" email lands (office/instant/Code.gs leadText_;
     needs the TWILIO_SID / TWILIO_TOKEN / TWILIO_FROM script properties, SETUP_NEEDED.md "Text
     alerts"). Instant matches the lead to the stored cell by the business name, so the landing
     JSON "business" must be the onboarding form's business name word for word. (2) Until Twilio
     is on, leadCc adds the cell's carrier email-to-text address ONLY for carriers that still run
     one: T-Mobile number@tmomail.net (unreliable), Verizon number@vtext.com (closes March 31,
     2027), US Cellular number@email.uscc.net, Cricket number@sms.cricketwireless.net, Boost
     number@sms.myboostmobile.com, Metro number@mymetropcs.com, Google Fi number@msg.fi.google.com.
     AT&T closed txt.att.net on June 17, 2025: AT&T, Other and "not sure" get no carrier address.
     (3) Email always. The day-0 test below decides what the client is told; never claim a text
     went out that nobody confirmed. The crew never texts anyone else: alerts go only to the
     client's own cell, from their own form.
   - **The test**: ONE test request through the page ("TEST from Ridgeline"), logged counted
     false, and the Welcome Pack asks the client to reply "got it" when the text arrives. No reply
     or "no text" → email only (client.leadAlertsVerified false), logged, and the client told.
   - **First review requests** to the customers they gave, the same day (rules below).
   - **Results page**: token + data/results/<token>.json written ("Results page" below).
   - **Welcome Pack** (one email, one PDF, specs/quality.md): starting score, profile fixes,
     review kit (link + QR card), the quote-page link and tracking links, the results link.
   Tells Grayson "NEW CLIENT". If the Stripe email came but no onboarding form within 24 hours:
   one friendly reminder with the form link; again at 72 hours; then alert Grayson.
5. **Work begins** (Day Shift 09, next weekday morning, and every weekday after).

## Week 1 (Day Shift 09)
| Item | Output |
|---|---|
| Playbook first (Nov 3, 2026) | Read office/playbooks/<industry>.md (only the client's; "other" = these specs) before the profile fixes, the quote-page config and the review kit. |
| Profile audit | From public info (WebSearch of their Google listing, their site): categories, services, description, hours, photos count, review count + rating, gaps. Saved as client.audit {at, ...}. client.reviewsAtStart = the public count (or "unknown"). |
| Profile fixes ("buildout-plan") | Exact text, ready to paste: primary + secondary categories, services list, 750-char description naming the town and services, hours, service area, 10 photo asks, Q&A pairs. Drafted as drafts kind "plan"; the desk emails it (Lane D) with the 10-minute how-to. |
| Review request system ("review-kit") | (a) the text message for the owner to send (under 300 chars, their review link), (b) the QR card (cards Action), (c) "send us your customers' emails" ask: the owner replies with a list or a CSV, and the desk emails each real customer one review request (Lane D, rules below). |
| Quote page (every plan, Nov 3, 2026) | The desk built it within the hour of onboarding (The flow, step 4). Here: open it (curl or WebFetch) to confirm it is live, check the lead test was logged, refine office/landing/<slug>.json from the playbook (cta, reviewLine, whenOptions, extraQuestion; leadEmail/leadCc untouched) → `python3 office/tools/make_landing.py office/landing/<slug>.json` → commit p/<slug>/. Missing = build it now. |

## Every week (Day Shift 09)
- **AI visibility re-check:** one gateway job per run covering the clients whose last aiTrend
  point is 7+ days old (their 3 aiQuestions; max 6 queries per job, so at most 2 clients per job,
  more jobs if needed). Score with office/tools/ai_score.py, append to client.aiTrend
  {at, score, jobId}. Pro: also store the competitors named (competitor tracking).
- **Profile check:** WebSearch the client's public Google listing; compare with the fixes we sent;
  log each change seen in client.profileLog [{at, field, before, after, source}]. A fix not live
  after 7 days → one nudge to the owner with just that fix.
- **Lead Finder** (Pro only): specs/lead-tracking.md.
- **Review replies** (Nov 3, 2026, every plan): every new review (the client forwards it, or
  Google emails us as Manager) gets a drafted reply the same run, kind "reviewreply": short,
  specific to what they wrote, no arguing, no admitting fault, never mention a review was
  requested. The desk emails it to the client in the same run, ready to paste.
- **Google post draft** (one per week, kind "post") for the owner to paste.

## Flat after 2 weeks: fix it ourselves (Day Shift 09)
At day 14+ (and every 14 days after), a client is FLAT when aiTrend has no point above baseline
AND counted leads == 0 (any source; every plan has a quote page) AND reviews gained is 0 or unknown. For a flat client, in the
same run, without asking anyone, pick the next 2 untried fixes from this ladder and do them
(record each in client.fixesTried [{at, fix, result}]):
1. Re-send the one profile fix that is still not live, shortened to a single step.
2. Second review push: a new review request email to customers who haven't been asked (or ask the
   owner again for 10 customer emails).
3. Pro: add 2 more Lead Finder searches (nearby towns within 25 miles, synonyms of their service).
4. New Google post angle + 5 Q&A pairs for the profile (people ask, owner answers).
5. Listing consistency: find their name/address/phone on Yelp, Facebook page, Apple Maps,
   Bing Places (public pages, WebSearch); list mismatches with the exact fix, email to owner.
6. Refresh the quote page copy (every plan) with the services people ask about in logged leads
   and the playbook's wording.
Tell Grayson in the morning report only: "<business> flat at day N; tried: <fix>, <fix>".

## Monthly (startedAt day-of-month)
- (Nov 3, 2026, every plan) ONE email: the monthly report PDF (leads by source and outcome, new
  reviews, star-rating change; AI score on Growth/Pro) with the check-in as its note (wins + the
  one next step we're taking, under 120 words, the results page link; specs/client-happiness.md
  §1). The "Did this lead turn into a customer?" email (specs/lead-tracking.md) goes to every
  plan. The same run updates data/results/<token>.json ("Results page" below) before the send.
- Pro: a short promo video (Nova, office/studio/CONTEXT.md, the client's own photos and facts;
  their real reviews quoted only with the reviewer's first name and the exact words), rendered,
  committed under office/studio/out/clients/<slug>-<yyyymm>.mp4, link emailed with the report.
  No photos from the client = a text-and-site video, said honestly in the email.
- Day 28: the guarantee check (specs/guarantee.md) by the reply desk, every plan since Nov 3,
  2026, with the new condition: zero new leads AND zero new reviews in month one → month two free.

## Keep improving (monthly; Nov 3, 2026)
On the first run of each month Sage reads every client's numbers (leads by source, reviews
gained, AI trend, what was tried: client.fixesTried) and writes dated "What worked" lines with
the evidence in office/playbooks/README.md (numbers, never a client's name or contact). The
Clients worker (Day Shift 09) applies each adopted idea to every active account that month,
logged in client.fixesTried {at, fix, result, from:"playbooks/README.md <date>"}.

## Results page (Nov 3, 2026)
Every client has https://ridgelinehq.github.io/results.html?c=<token>, token = 16 random hex
(client.resultsToken), backed by data/results/<token>.json in the public repo. NUMBERS ONLY:
{business, town, plan, period, leads:{bySource, byOutcome}, reviews:{atStart, now}, rating,
requestsSent, ai:{score, trend, named} (Growth/Pro), done[], next[], links:{quotePage,
reviewLink}, guarantee:{status}, updatedAt}. Never a lead's name, phone or email; never
client.customers; every number equals the database when written; zeros shown honestly; unknown =
"unknown". Written at onboarding (reply desk), updated on the monthly date and whenever a win is
logged (Day Shift 09). The link goes in the Welcome Pack and every monthly email.

## Review requests to real customers (the rules)
- Only addresses the owner gave us, for people who actually bought from them. One request per
  customer, never a second within 180 days. Plain text, from Ridgeline Local "on behalf of
  <business>", under 90 words, their review link, no incentive, no "5 stars please", no review
  gating (everyone gets the same link). Footer: the owner's business name + "Reply 'stop' and we
  won't email you again." Replies of stop → suppression.
- Max 25 per client per day, inside the normal sending window, through the reply desk.
- Never write a review, never ask staff or friends to post one, never offer anything for one.
- Texting customers is the owner's (we give them the ready text); the crew never sends SMS.

## Refunds (terms.html: payments are final)
No refunds. A refund request gets a kind reply, an offer to cancel future charges and to make it
right, and an alert to Grayson, who alone can approve one. A duplicate or mistaken charge is
refunded automatically. Disputes: evidence PDF to Grayson the same run. Reply desk Lane C2.

## Cancel or pause
"cancel" from a client → Stripe job `{"id": "c-<clientId>-<day>", "action": "cancel", "session"|"emailHash": ...}`
(same rules as specs/guarantee.md §4: no email in the file), client.status cancelled once the out
file says ok, and a short confirmation with the date the last paid period ends. ok false → alert. Their quote page and results JSON stay up 30 days, then are removed.

## Quality and happiness
Every deliverable passes specs/quality.md (85+, scored by a fresh grader) before it is ready, and goes out
automatically. Check-ins, win emails, the day-21 update and cancel reasons: specs/client-happiness.md.

## Honesty
No work is marked done unless a Gmail id, a commit or a database row proves it. Reports show the
real numbers, including zeros. Never promise rankings or a number of leads or reviews. "We only
collect genuine reviews from your real customers." "Every lead is someone who asked to hear from
you." The crew never texts strangers: lead alerts go only to the client's own cell, from their
own form (Nov 3, 2026).
