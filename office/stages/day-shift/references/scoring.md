# Quinn's scoring rubric v2 (0 to 100; the gate is settings.scoreGate, default 60)

rubricVersion: 2 (Grayson's order, Oct 25, 2026: "make my leads stronger ... a better chance of
people buying", like a real lead finder). v1 only measured how WEAK a business looks online, so
the list filled with tiny no-site operators who can't pay $75+ (38 leads on Oct 25: 4 with an
email, 0 Qualified, scores 5 to 40, 0 replies of 10 sends). v2 scores three things: can they pay
and can we help (Fit), why would they buy NOW (Buy triggers), and can we reach them (Reach).

A score answers one question: how likely is this owner to reply and buy. Evidence only; every
point names its source URL. Unknown fields score 0, never a guess.

## A. Fit: can they pay, can we help
| Signal | Points | Why |
|---|---|---|
| High-ticket trade (average job $300+: dentist, med spa, HVAC, plumber, roofer, remodeler, auto repair, landscaping install, chiropractor, lawyer) | +10 | one new customer pays a whole year of Ridgeline |
| Hidden gem: public rating 4.5+ on 10 to 80 reviews (any public page) AND not named by the AI check | +15 | good business the AI ignores: happy customers to ask for reviews, easiest sale |
| Google profile found, under 30 reviews | +10 | gap is real and fixable |
| 30 to 80 reviews | +5 | still beatable |
| Profile under 10 photos, or no services, or no hours | +5 | concrete fixes to name |
| Too small to pay: no website AND no email AND under 5 public reviews AND no Facebook page | -15, note "micro" | a $75/mo service is a stretch for them |
| Over 150 reviews, 4.7+ | 0, note "already strong" | less to fix |
| Chain, franchise, or agency visible (pro site, 500+ reviews, ads managed by an agency) | -30 | not our buyer |
| Agency badge or "website by <marketing agency>" footer | -20 | they have help |

## B. Buy triggers: why NOW (each is a reason to call this week)
| Trigger | Points | Proof it needs (URL) |
|---|---|---|
| Competitor named: the AI check names 1+ local competitors and NOT them (ChatGPT or Gemini) | +15 | aiCheck by "gateway" |
| Pays for leads already: listed on Angi, HomeAdvisor, Thumbtack, Porch or Bark | +10 | the listing in a search result |
| Unanswered bad review: a 1 to 3 star review in the last 90 days with no owner reply | +10 | the public review page |
| New business: opened, registered or joined the chamber in the last 24 months ("est. 2025", ribbon cutting, new member) | +10 | site, chamber or news page |
| Hiring now: a public job post or "now hiring" on their site or page | +5 | the post |
| Active: a review, post or owner reply in the last 90 days | +5 | the page |
| Peak season for the trade in the next 60 days in that town (storm, HVAC heat/cold, holiday, wedding, tax) | +5 | Scout's note with a source |

## C. Reach: can we get to them
| Signal | Points |
|---|---|
| Published business email (any allowed public source, emailSource URL) | +15 |
| Website with a contact form only | +5, flag "form only" |
| Published phone | +5 |
| Owner's first name found (About page, public profile) | +5 |
| Contacted before with no reply | -40 (follow-ups handle them) |
| On the suppression list or Not a fit | score 0, status unchanged |

Named by BOTH ChatGPT and Gemini: 0 and note "named by both (weak target)".

## Tier (write `tier` on every scored lead; the call list and Echo work Hot first)
- **Hot**: Qualified AND (score >= 60 OR 2+ buy triggers from section B, "Active" and "Peak
  season" not counted). Call these first, email these first.
- **Warm**: Qualified, not Hot.
- **Cold**: Researching, or "micro", or named by both.

## whyNow (one sentence, written on every Qualified lead)
The one true reason this owner should care this week, built from the strongest trigger with
real names and numbers only, in plain words Grayson can say on a call. Examples of the shape:
- "ChatGPT sends people asking for a roofer in Owasso to GoldenRite and Ridgeback, not you."
- "You've got 4.8 stars on 41 reviews, but neither ChatGPT nor Gemini mentions you."
- "You're paying Angi for leads, and the AI still names two other shops first."
No fact in it that is not in the lead's sources or aiCheck. No promise of results.

## Two doors to Qualified
The crew cannot read Google Maps, Yelp or HomeAdvisor profile pages (WebFetch is blocked
there), so the Google count is usually unknown.
1. Full evidence: score >= settings.scoreGate (60).
2. Reachable evidence: Google count unknown (profile.reviews is null) AND score >= 30 AND a
   published email or phone AND not "micro" AND not named where it counts: searchCheck.namedYou
   is false, OR the gateway AI check shows it not named by ChatGPT AND not named by Gemini. The
   AI check is what we sell, so it beats a directory-based search check. Why-line: "qualified on
   reachable evidence; Google count unknown". The optional "Type the Google review count" tap on
   the page stays optional; never put it in NEEDS YOU.
A lead named by both AIs with no other gap is a weak target: leave it at Researching.

## One-time re-score when the rubric changes
Any open lead (New, Researching, Qualified) whose rubricVersion is below 2 is re-scored with this
table on the next Day Shift, whatever its town, from the facts already on file (no new research
for other towns). Write rubricVersion: 2. Contacted, Replied, Meeting, Client, Suppressed and
Not a fit leads are never touched.

scoreWhy = one short line per signal that scored, with the number and the source URL. buySignals
= the section-B trigger names that scored. The top five of the run go in the run notes with their
whyNow. Sage re-weights this table only through a workflow/<version> doc with evidence from 30+
sends; the first check of v2 is reply rate Hot vs Warm vs v1 once 20 v2 sends exist.
