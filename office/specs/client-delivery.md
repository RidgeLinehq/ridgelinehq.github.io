# Client delivery: signup to results, fully automatic

Grayson's standing order (Oct 24, 2026): "Fully automatic. No approvals from me." Every step
below is done by the crew, or by one Action, or is one tap for the client. Grayson is told, never
asked, except for the alerts in shared/alerts.md.

## The flow
1. **Pick a plan** on https://ridgelinehq.github.io/#pricing → start.html → Stripe checkout (link
   from data/stripe-links.json, made by the "Ridgeline Stripe" Action).
2. **Pay.** Stripe redirects to welcome.html?plan=<plan>&billing=<b>&session_id=<cs_...> and
   emails ridgelinemarketinghq@gmail.com the payment.
3. **Onboarding form** (welcome.html): business name, Google profile link, phone, services, city,
   email. It arrives in the Ridgeline Gmail as "Onboarding — <business>" (FormSubmit).
4. **Reply desk, Lane C** (within 2 hours, any day): creates clients/<id>, sends the welcome,
   runs the baseline AI check (specs/guarantee.md §1), lowers data/founding.json by 1, tells
   Grayson "NEW CLIENT". If the Stripe email came but no onboarding form within 24 hours: one
   friendly reminder with the form link; again at 72 hours; then alert Grayson.
5. **Work begins** (Day Shift 09, next weekday morning, and every weekday after).

## Week 1 (Day Shift 09)
| Item | Output |
|---|---|
| Profile audit | From public info (WebSearch of their Google listing, their site): categories, services, description, hours, photos count, review count + rating, gaps. Saved as client.audit {at, ...}. client.reviewsAtStart = the public count (or "unknown"). |
| Profile fixes ("buildout-plan") | Exact text, ready to paste: primary + secondary categories, services list, 750-char description naming the town and services, hours, service area, 10 photo asks, Q&A pairs. Drafted as drafts kind "plan"; the desk emails it (Lane D) with the 10-minute how-to. |
| Review request system ("review-kit") | (a) the text message for the owner to send (under 300 chars, their review link), (b) the QR card (cards Action), (c) "send us your customers' emails" ask: the owner replies with a list or a CSV, and the desk emails each real customer one review request (Lane D, rules below). |
| Pro: lead page | office/landing/<slug>.json from the onboarding facts → `python3 office/tools/make_landing.py office/landing/<slug>.json` → commit p/<slug>/ → the desk emails the owner the link and the tracking links (?src=gbp, ?src=card, ?src=facebook). |

## Every week (Day Shift 09)
- **AI visibility re-check:** one gateway job per run covering the clients whose last aiTrend
  point is 7+ days old (their 3 aiQuestions; max 6 queries per job, so at most 2 clients per job,
  more jobs if needed). Score with office/tools/ai_score.py, append to client.aiTrend
  {at, score, jobId}. Pro: also store the competitors named (competitor tracking).
- **Profile check:** WebSearch the client's public Google listing; compare with the fixes we sent;
  log each change seen in client.profileLog [{at, field, before, after, source}]. A fix not live
  after 7 days → one nudge to the owner with just that fix.
- **Lead Finder** (Growth, Pro): specs/lead-tracking.md.
- **Google post draft** (one per week, kind "post") for the owner to paste.

## Flat after 2 weeks: fix it ourselves (Day Shift 09)
At day 14+ (and every 14 days after), a client is FLAT when aiTrend has no point above baseline
AND (Growth/Pro) counted leads == 0 AND reviews gained is 0 or unknown. For a flat client, in the
same run, without asking anyone, pick the next 2 untried fixes from this ladder and do them
(record each in client.fixesTried [{at, fix, result}]):
1. Re-send the one profile fix that is still not live, shortened to a single step.
2. Second review push: a new review request email to customers who haven't been asked (or ask the
   owner again for 10 customer emails).
3. Add 2 more Lead Finder searches (nearby towns within 25 miles, synonyms of their service).
4. New Google post angle + 5 Q&A pairs for the profile (people ask, owner answers).
5. Listing consistency: find their name/address/phone on Yelp, Facebook page, Apple Maps,
   Bing Places (public pages, WebSearch); list mismatches with the exact fix, email to owner.
6. Pro: refresh the lead page copy with the services people ask about in found leads.
Tell Grayson in the morning report only: "<business> flat at day N; tried: <fix>, <fix>".

## Monthly (startedAt day-of-month)
- "Did this lead turn into a job?" email (Growth, Pro) and the results report (all plans):
  specs/lead-tracking.md.
- Pro: a short promo video (Nova, office/studio/CONTEXT.md, the client's own photos and facts;
  their real reviews quoted only with the reviewer's first name and the exact words), rendered,
  committed under office/studio/out/clients/<slug>-<yyyymm>.mp4, link emailed with the report.
  No photos from the client = a text-and-site video, said honestly in the email.
- Day 28: the guarantee check (specs/guarantee.md), Growth and Pro, by the reply desk.

## Review requests to real customers (the rules)
- Only addresses the owner gave us, for people who actually bought from them. One request per
  customer, never a second within 180 days. Plain text, from Ridgeline Local "on behalf of
  <business>", under 90 words, their review link, no incentive, no "5 stars please", no review
  gating (everyone gets the same link). Footer: the owner's business name + "Reply 'stop' and we
  won't email you again." Replies of stop → suppression.
- Max 25 per client per day, inside the normal sending window, through the reply desk.
- Never write a review, never ask staff or friends to post one, never offer anything for one.
- Texting customers is the owner's (we give them the ready text); the crew never sends SMS.

## Cancel or pause
"cancel" from a client → Stripe job `{"id": "c-<clientId>-<day>", "action": "cancel", "session"|"emailHash": ...}`
(same rules as specs/guarantee.md §4: no email in the file), client.status cancelled once the out
file says ok, and a short confirmation with the date the last paid period ends. ok false → alert. Their lead page stays up 30 days, then is removed.

## Honesty
No work is marked done unless a Gmail id, a commit or a database row proves it. Reports show the
real numbers, including zeros. Never promise rankings or a number of leads.
