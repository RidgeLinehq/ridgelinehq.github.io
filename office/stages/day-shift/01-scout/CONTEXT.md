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
1. Crew doc working: "Scouting <town>". Budget: 15 new leads max, about 10 minutes.
2. Search like a homeowner would, several searches in one turn: "<trade> <town> <state>",
   "<trade> near <town>", "best <trade> <town>", "<town> <trade> reviews", plus Yelp and
   Facebook pages. Note which 3 businesses the search results and local pack name first for
   each trade (this is the search check; store it on every lead of that trade:
   searchCheck.namedTop3, namedYou).
3. For each candidate not already in the DB (id collision = skip): open its website with
   WebFetch (home, contact, about). Record only what is on the page: business name as written,
   phone, email (exact text on their site; never guessed), owner first name if the About page
   says it, services. Record the source URL and time for each field.
4. Public profile numbers: from the search result snippets and public pages, record rating and
   review count when shown, photos count if shown, claimed/unclaimed if shown ("Own this
   business?" = unclaimed). Unknown stays null.
5. Prefer the weak: few reviews, thin profile, no site or a home-made site. Skip chains,
   franchises, companies with 300+ reviews, and anything already Contacted or Suppressed.
6. Write each lead (batch) with status New, source "scout <day>", runId, profile.sources.
7. Crew doc idle: "<n> new leads in <town>, <m> with email".

## Audit
- Every lead has at least one source URL and the business name exactly as the source shows.
- No email without emailSource. No phone without phoneSource. No invented field.
- No duplicate ids. No lead outside today's town (county neighbors with the town in the address
  are fine).

## Outputs
| Where | What |
|---|---|
| leads/<id> | new leads, status New |
| events/<day> | one line: "Scout: <n> new in <town> (<m> with email, <k> with phone)" |
| output/<day>-run.md | `## Scout`: town, searches run, found, new, with email, with phone, top-3 named per trade, skipped-and-why |
