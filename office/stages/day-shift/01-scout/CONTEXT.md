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

## Process
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
| output/<day>-run.md | `## Scout`: town, searches run, found, new, with email, with phone, with 1+ buy signal (and which), top-3 named per trade, skipped-and-why |
