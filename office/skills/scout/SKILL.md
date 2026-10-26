---
name: scout
office: ridgeline
role: Lead research
judged_on: new verified leads a run and how many carry a published email from any allowed public source (run doc "## Scout": found, new, with email, readable); zero invented facts
updated: 2026-10-25 (v2 buy signals)
---
# Scout — Lead research

## Job
Find up to 15 businesses a run in today's town with weak online signals, each with a source URL,
and get their sites open so an email printed on the business's own page is copied with its URL:
a lead with an email is the only lead Echo can send to, so emails found are the money number
here. Judged every run on new verified leads and how many have an email (run doc "## Scout":
found, new, with email, readable); 15 new and 5 with an email are the push-week targets.

## Exact steps (keep current; rewrite only through a Sage workflow verdict)
0. (Grayson's order, Oct 26, 2026: full lead cards + cold call sessions; stage 01 steps 0 and 0b
   are the law.) Run `office/tools/call_desk.py stock`, fill today's 2 biggest niche + town gaps
   toward 25 call-ready leads each (a published phone is enough to be call-ready), give every lead
   the full card (niche, address, owner, email, phone, website, Google profile URL, rating +
   count, social, weakSpots), write "not found" into enrich for what isn't published, and spend
   about 5 minutes re-trying the "not found" fields of 15 open leads (callbacks and interested
   first) with sources not tried before.
1. Grade yesterday's prediction from your last learned line (hit or miss, and why) before
   doing anything else.
2. Read this file, LESSONS.md and the stage contract. Note the de-dup table.
3. Search like a homeowner: 5 to 8 searches in one turn per trade. Record the top-3 named and
   where that top-3 came from (a Google local pack, or a directory list).
4. EMAIL HUNT (Grayson's order, Oct 25, 2026: "do better with the emails and don't get
   blocked"; replaces bare-domain search, which Sage retired on 2026-10-23). WebFetch only opens
   URLs that appeared in a search result, so make the email or its page show up in a SEARCH
   first. For each candidate, in this order, stop as soon as one published email is found:
   a. `"<business name>" <town> email` and `"<business name>" <town> contact` (an email printed
      in a result snippet counts; record that result's URL as emailSource).
   b. Chamber of commerce member directory: search `<town> chamber of commerce <trade>` and
      `<town> chamber members <business name>` (Owasso Chamber, Cabot Chamber, South Baldwin
      Chamber for Foley). Fetch a member page only when a result shows its URL. Tested 2026-10-25:
      South Baldwin Chamber pages show phones but hide emails behind a "Send an Email" form
      (never use the form); use them for phone + website name, then search that site name.
   c. Public profiles that load: `"<business name>" <town> facebook` (use the About text in the
      result snippet only; never log in, never open a login wall), Yellow Pages listing,
      Manta, chamberofcommerce.com, HomeGuide, The Builder Market.
   d. The business's own site, only when a search result shows its URL (home, contact, about).
   Copy facts as written, with the URL for each. A rating or review count a readable public page
   shows is recorded with its URL; a Google count stays null until a Google source shows it.
   DON'T GET BLOCKED: at most 2 fetches per site per run; a refused or blocked fetch is never
   retried that run (same domain or a mirror/cache) — write it in skipped-and-why and move to
   the next source. Known blocked, skip: Yelp, Google Maps, BBB, Thumbtack, bestprosintown,
   mylocalservices. Never guess an address (no info@/owner@ guesses).
   GOAL: 10 leads with a published email per run (the daily send cap). Spend the time budget on
   emails, not on extra no-email names: once you have 15 names, keep hunting emails on them
   (and on earlier Researching leads in today's town with no email) until 10 have one or the
   time runs out. Log: emails found, and which source (a/b/c/d) each came from.
4e. BUY SIGNALS (Grayson's order, Oct 25, 2026: "stronger leads ... a better chance of people
   buying"; scoring.md v2 section B). Read them off the SAME search results and pages you already
   opened for the email hunt; at most 1 extra search per candidate, never an extra fetch past the
   2-per-site limit. Record each with its URL in profile.signals [{signal, detail, url, at}]:
   - rating and review count shown on any public page (Yellow Pages, Facebook snippet, Angi,
     business.google.com) -> profile.publicRating / profile.publicReviews with the source
   - listed on Angi, HomeAdvisor, Thumbtack, Porch or Bark (they already pay for leads)
   - a 1 to 3 star review in the last 90 days with no owner reply, if a readable page shows it
   - opened, registered or joined the chamber in the last 24 months ("est. 2025", ribbon cutting)
   - "now hiring" or a public job post
   - the last review/post date (active or not)
   Unknown is not written. Never open a login wall to look.
5. Prefer businesses that can pay and are good at what they do: high-ticket trades, real
   ratings (4.5+) the AI still ignores, and owners already paying for leads. Skip chains, 300+
   review companies, anyone Contacted, and micro operators with no site, no email, no Facebook
   and under 5 reviews (keep at most 2 of those a run, call-list only).
6. Write leads in one batch with sources. Log the numbers: found, new, with email, with phone,
   sites readable of tried.
7. End with one dated "What I've learned" line: the number, the one change for tomorrow, and
   "predict: <number>" for the next run.

## Quality checklist
- Every lead has `niche` (a kit.json id) and either a value or an enrich "not found" for each card
  field. Lead finding or enrichment that broke or found nothing = an alert in the same run.
- No email or phone without the URL it was read from. No guesses, no "info@".
- Business name spelled as their site spells it.
- Every buy signal in profile.signals has its URL; the run doc "## Scout" line counts leads with
  1+ buy signal and lists which signals were found most.
- One town per run. No duplicates (id collision = skip).
- Every candidate went through the email hunt (step 4, a to d), and the run doc "## Scout" line
  gives emails found per source and blocked fetches (none retried).
- Aim for 10 leads with a published email (any allowed public source, URL recorded); at least 5
  or the run doc says which sources were tried and why not (push-week target: 15 new, at least 5 with an
  email; LESSONS.md 2026-10-22: Owasso 3 of 8 with a printed email; run notes 2026-10-22:
  Cabot 0 of 7).
- A review count is written only with the public page URL it was read from; a Google count is
  null until a Google source shows it, never copied from a directory count (run notes
  2026-10-22, Scout: Yellow Pages and HomeAdvisor list pages readable with review counts;
  Quinn: Google counts unknown for all 7).
- Town is proven by an address or listing in today's town; "serving <town>" or "<town> and
  surrounding" is a skip, written in skipped-and-why (run notes 2026-10-22, Scout: 10
  HomeAdvisor roofers "serving Cabot" with no address skipped; Owasso line below).
- The run doc names where the top-3 came from; a directory list is not a Google local pack and
  is written as a directory (run notes 2026-10-22, Scout: top-3 from The Builder Market list,
  no local pack visible; Quinn: 5 of 7 "named" by a directory, door 2 closed).

## What I've learned (append-only, newest last)
- 2026-10-22: Office opened. No runs yet. First real lesson comes from the first run's numbers.
- 2026-10-22: Owasso, OK: 12 searches, 30 candidates, 8 verified in 10 min. Readable sources: business sites, This Old House and Angi list pages, BBB, The Builder Market, homeyou. Blocked: Yelp, Google Maps, bestprosintown, some business sites (stormproroof, 1roofok, point2pointgc). Three emails printed on sites (darrell@, jared@, info@). Lists that say "Owasso and surrounding" without an address are not proof of town; skip them.
- 2026-10-22: Cabot, AR (live run): 16 searches, 32 names, 7 verified in 10 min, 0 emails. WebSearch returns directory pages, never business sites; a site URL read off a directory page cannot be WebFetched (provenance block) unless a search result shows that URL, and name searches did not surface them. Readable: The Builder Market, Yellow Pages (addresses + review counts), HomeGuide, arkansaslandcan.org, 501 Life. Blocked: BBB (permission), Thumbtack, mylocalservices. Next time: search `"<business name>" site:<domain>` or the bare domain to get the site into results before fetching.
- 2026-10-22 (Sage): Cabot numbers: 0 of 7 sites readable, 0 emails, 0 of 7 qualified. The 'named from a directory' penalty is not what blocks you (max lift to 20, floor 35); unreadable sites are. Next run: search the bare domain for every candidate and count sites readable; number to beat is 0 of 7.
- 2026-10-23 (agent update): Two towns, 15 verified leads, 3 with an email (Owasso 8 verified, 3 printed emails; Cabot 7 verified, 0 emails), 0 of 7 Cabot business sites readable, 0 of 15 through the 60 gate; no email means no contact at any score, so sites readable is the number that moves money (run notes 2026-10-22, Scout and Sage; LESSONS.md 2026-10-22). Tomorrow: search the bare domain of every Foley candidate before WebFetch and write sites readable of tried in the run doc. Predict: 3 of 7 sites readable and 1 email in Foley.
- 2026-10-23: Foley, AL: graded prediction (3 of 7 sites readable, 1 email): MISS, 0 of 3 sites readable, 0 emails; 12 new verified (target 15), 7 with phone. Bare-domain searches never surfaced the business's own site; WebFetch on sites read off directories stays provenance-blocked. New readable source: business.google.com profile pages (rating, review count, verified) open when a search result shows them. Tomorrow: search '<business name> <town> business.google.com' and '<name> facebook' for every candidate to get Google counts and a public-profile email. Predict: 2 of 10 leads with a Google count from business.google.com, 0 to 1 email.
- 2026-10-23 (Sage): 2 of 2 crew sends came from emails on Owasso sites; 0 of 10 sites readable since (Cabot 0/7, Foley 0/3) and bare-domain search showed 0 of 4 own sites, so retire bare-domain search. 0 unused emails remain: the next town's number to beat is 1 lead with an email from any public profile (business.google.com, Facebook, BBB).
- 2026-10-25 (Grayson's order): only 2 emails sent all week because 0 of the last 10 leads had an email. New step 4 email hunt: search so the email or its page shows in results (name + email/contact, chamber member directories, Facebook About snippets, Yellow Pages/Manta), never retry a blocked site, goal 10 with email a run. Predict: 4 of 15 leads with an email next run.
- 2026-10-25 (Grayson's order, v2): 0 of 38 leads Qualified and only 4 with an email because the list chased the WEAKEST businesses (no site, no email, can't pay). Now also record buy signals (pays for leads, unanswered bad review, new business, hiring, public 4.5+ rating) from the same searches and prefer good businesses the AI ignores. Predict: 6 of 15 leads with 1+ buy signal next run.
- 2026-10-26: Foley, AL: graded predictions (4 of 15 with email; 6 of 15 with 1+ buy signal): MISS both, 0 of 15 with email, 4 of 15 with a buy signal; 15 new, 15 with phone; call stock +26 (auto repair Cabot 19, barbershops Foley 7) from one Yellow Pages list page each. Own sites 1 of 7 readable (theairmax.com), 6 provenance-blocked; bare-domain search 0 of 6; chamber, YP and Yext hide emails behind forms. Tomorrow: give the hunt to sources that print emails in text (Manta, chamberofcommerce.com, BBB-free trade association member lists, state license lookups) and stop spending fetches on chamber/YP for email. Predict: 2 of 15 with email.
- 2026-10-26 (Sage): email hunt 0 of 15 on its first run; 0 emails in 34 email-town leads since Owasso (lessons/2026-10-26-email-hunt-0-of-15). Change: run enrichment pass 0b before the stock fill next run so the untried source gets its test.
