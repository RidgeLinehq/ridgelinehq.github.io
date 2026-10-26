# 01 Scout: find businesses with weak online signals (today's town only)

## Inputs
| File | Section |
|---|---|
| specs/offer.md | Targets |
| shared/outreach-law.md | Where leads come from |
| skills/scout/SKILL.md | all |
| LESSONS.md | all |
| references/database-fields.md | leads |
| database: leads where town == today's town (out_dir, then a table of id, businessName, status) | for de-duplication |
| database: ALL leads (list, limit 1000, out_dir) then `python3 office/tools/call_desk.py stock <out_dir> --towns "<settings.targets as Town,ST;Town,ST>"` | the call stock (step 0) |
| call_kit/kit.json | `niches` only (ids, labels, match words) |

## Process
0. CALL STOCK (Grayson's order, Oct 26, 2026: "keep enough fresh leads loaded so every niche session
   has at least 25"). Run the stock command above. Its "Fill today" list is the niche + town pairs
   under 25 call-ready leads, biggest gap first. This run, after today's email town (steps 1-7),
   fill the top 2 pairs of that list (call-ready = business name as written + a published business
   phone + its source URL; email is a bonus, never a blocker here): up to 30 call-ready leads in
   total, same sources, same law, same de-dup, `niche` set to the kit id, `trade` the niche label in
   lower case. Every lead still gets the full card fields below. Write the stock numbers (before
   and after) in the run doc. A niche that can't reach 25 in its town (not enough real businesses)
   moves to the next target town; never pad, never invent, never repeat a business.
   FULL LEAD CARD (every new lead, from the same searches; each field with its URL): niche,
   address, owner/manager first name (contactName + contactRole), email, phone, website, gbpUrl
   (only a Google Business Profile URL a search result showed), rating + review count (Google
   only when a Google source shows it; else publicRating/publicReviews with the source), social
   (public Facebook/Instagram page URLs), and weakSpots (2 to 4 short true lines from those facts:
   "No website", "Only 7 Google reviews", "Google profile unclaimed", "Rating 3.9★"...). Business
   contact info only: never a personal cell marked personal, a home address or a private profile.
   A field you could not find: write enrich.<field> {status:"not found", tries:1, lastTriedAt,
   sources:[urls tried]} and leave the field empty. Never guess a name, email or number.
0b. ENRICHMENT PASS (every run, about 5 minutes, after the stock fill): the 15 open leads (status
   not Suppressed/Client/Not a fit, callStatus not Do not contact) with the most "not found"
   fields and the oldest enrich.*.lastTriedAt, Callback/Interested/Voicemail leads first (and any
   lead whose followUp.status is "waiting-email": the email is what Echo needs). Try ONE new
   source per missing field (step 4's list, never a source already in enrich.<field>.sources,
   never a blocked site again). Found = fill the field with its source, enrich.<field>.status
   "found". Still missing = tries + 1. Stop retrying a field after 5 tries over 30 days (it stays
   "Not found" on the card).
1. Crew doc working: "Scouting <town>". Budget: 15 new leads max, about 15 minutes; the goal is 10 leads with a published email.
2. Search like a homeowner would, several searches in one turn: "<trade> <town> <state>",
   "<trade> near <town>", "best <trade> <town>", "<town> <trade> reviews", plus Yelp and
   Facebook pages. Note which 3 businesses the search results and local pack name first for
   each trade (this is the search check; store it on every lead of that trade:
   searchCheck.namedTop3, namedYou).
3. For each candidate not already in the DB (id collision = skip): run the EMAIL HUNT in
   skills/scout/SKILL.md step 4 (search so the email or its page appears in results: name +
   email/contact, chamber of commerce member directory, Facebook About snippet, Yellow Pages/
   Manta, then the business's own site if a result shows it). Record only what is published:
   business name as written, phone, email (exact text; never guessed), owner first name if
   shown, services, with the source URL and time for each field. Never retry a blocked or
   refused site in the same run; move to the next source. Then go back over today's town's
   Researching/Qualified leads with no email and hunt those too until 10 have an email.
   While on each candidate, record its BUY SIGNALS (skills/scout/SKILL.md step 4e) in
   profile.signals with URLs, from the same results: public rating/count, pay-per-lead
   listings (Angi, HomeAdvisor, Thumbtack, Porch, Bark), unanswered recent bad review, opened in
   the last 24 months, hiring, last activity date.
4. Public profile numbers: from the search result snippets and public pages, record rating and
   review count when shown, photos count if shown, claimed/unclaimed if shown ("Own this
   business?" = unclaimed). Unknown stays null.
5. Prefer the ones who can buy: high-ticket trades, a real 4.5+ rating the AI ignores, owners
   already paying for leads, new businesses, thin profiles. Skip chains, franchises, companies
   with 300+ reviews, anything already Contacted or Suppressed, and micro operators (no site, no
   email, no Facebook, under 5 reviews; at most 2 a run).
6. Write each lead (batch) with status New, source "scout <day>", runId, profile.sources.
7. Crew doc idle: "<n> new leads in <town>, <m> with email".

## Audit
- Every lead has a niche id from kit.json, and every card field is either filled with its source
  or marked in enrich as "not found" (never a guess).
- Call stock before/after is in the run doc; every pair still under 25 is named with the reason.
- Every lead has at least one source URL and the business name exactly as the source shows.
- No email without emailSource. No phone without phoneSource. No invented field.
- Every buy signal has a URL. No signal guessed from a name or a trade.
- No duplicate ids. No lead outside today's town (county neighbors with the town in the address
  are fine).

## Outputs
| Where | What |
|---|---|
| leads/<id> | new leads, status New |
| events/<day> | one line: "Scout: <n> new in <town> (<m> with email, <k> with phone)" |
| alerts (shared/alerts.md) | AT ONCE, in this run: lead finding broke or came back empty (0 new leads, or every search/fetch errored) → key `scout-nofind-<day>`; the enrichment pass errored or found 0 of 15 → key `scout-enrich-<day>`; any niche with 0 call-ready leads after the fill and no plan to fix it → key `scout-stock-<niche>-<day>`. Also one NEEDS YOU line on the run doc (the Emergency Watch re-checks it) |
| output/<day>-run.md | `## Scout`: call stock before/after per niche, pairs filled, enrichment pass (tried, found per field), plus town, searches run, found, new, with email, with phone, with 1+ buy signal (and which), top-3 named per trade, skipped-and-why |
