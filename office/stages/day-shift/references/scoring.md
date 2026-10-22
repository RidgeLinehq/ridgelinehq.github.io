# Quinn's scoring rubric (0 to 100; the gate is settings.scoreGate, default 60)

A score answers one question: how likely is this owner to reply and buy, and how much can we
help. Evidence only; every point names its source. Unknown fields score 0, never a guess.

| Signal | Points | Why |
|---|---|---|
| Google profile found, under 30 reviews | +20 | the gap is real and fixable; AI names 133-review businesses |
| 30 to 80 reviews | +10 | still beatable |
| Over 150 reviews, 4.7+ | 0, and note "already strong" | less to fix; lower urgency |
| Profile has under 10 photos, or no services, or no hours | +10 | concrete fixes to name in the email |
| Not named in the search check for "<trade> <town>" (top 3) | +15 | the loss line writes itself |
| Named in the search check | 0, note it | harder sell |
| Yelp unclaimed or missing | +5 | 10-minute win to mention |
| Has a website with a published business email | +15 | we can email (the only channel) |
| Website but no email (contact form only) | +5, flag "form only" | call list or form |
| No website at all | +10, flag "no site" | needs everything; call list priority |
| Published phone on their own site or profile | +5 | call list eligible |
| Owner's first name found (website "About", public profile) | +5 | personal opener |
| Active: a review or post in the last 90 days | +5 | alive and busy |
| Storm or seasonal signal in the town this month (Scout notes) | +5 | timing |
| Chain, franchise, or an agency already visible (pro site, 500+ reviews, ads) | -30 | not our buyer |
| Already a client of a known marketing agency (badge or footer) | -20 | they have help |
| Contacted before (in the DB) with no reply | -40 | follow-ups handle them, not new scoring |
| On the suppression list or Not a fit | score 0, status unchanged | never |

## Two doors to Qualified (added Oct 22, 2026 after the first run)
The crew cannot read Google Maps, Yelp or HomeAdvisor profile pages (WebFetch is blocked
there), so the Google signals are usually unknown until Grayson types them on the page.
1. Full evidence: score >= settings.scoreGate (60).
2. Reachable evidence: Google facts unknown (profile.reviews is null) AND score >= 35 AND a
   published email or phone AND searchCheck.namedYou is false. Status Qualified, with the
   why-line "qualified on reachable evidence; Google count unknown". These leads get a
   "Type the Google review count" tap on the page (Lead Desk → lead → Google facts); the next
   run re-scores them with the real numbers and Echo can cite the count in the email.
A lead that is named in the search check and has no other gap is a weak target: leave it at
Researching, never force it through door 2.

scoreWhy = one short line per signal that scored, with the number and the source URL. The top
five of the run are listed in the run notes with their why lines. Scores that later predict
replies are kept; Sage re-weights this table only through a workflow/<version> doc with
evidence from 30+ sends.
