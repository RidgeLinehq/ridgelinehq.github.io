# 02 Quinn: score every New lead and rank the call list

## Inputs
| File | Section |
|---|---|
| references/scoring.md | all |
| skills/quinn/SKILL.md | all |
| specs/call-script.md | Ranking the call list |
| shared/gateway.md | all |
| database: leads where status in (New, Researching) in today's town; plus any lead with scoredAt older than 30 days and status Qualified (re-score); plus every open lead (New, Researching, Qualified) in any town with rubricVersion missing or below 2 (one-time v2 re-score, facts on file only) | out_dir |

## Process
1. Crew doc working: "Scoring <n> leads".
2. For each lead: compute the score from the rubric, one why-line per scoring signal with its
   source URL. Status by references/scoring.md (two doors to Qualified; Researching when the Google
   facts are unknown and door 2 does not apply; Not a fit only with known facts). Set scoredAt,
   rubricVersion 2, buySignals, tier (Hot / Warm / Cold) and, on Qualified leads, whyNow
   (references/scoring.md "Tier" and "whyNow").
3. AI check (shared/gateway.md): one job for today's town with one query per trade, unless a
   job for that town+trade is under 7 days old (reuse it). Apply the answers to every lead of
   that town and trade: aiCheck.chatgpt / gemini named / not named / unknown, competitors,
   answers, by "gateway". Re-score: a gateway answer that names local competitors and not this
   business is the v2 "Competitor named" trigger (+15). Never fill a result the gateway did not return.
3b. WHO'S ON TOP (Grayson, Oct 26, 2026: "so when a lead asks 'who's popping up?' I can answer right
   away"). For every niche + town that has call-ready leads (Scout's stock table) and no
   markets/<niche>-<town>-<st> doc under 14 days old: put one query per pair in the SAME gateway job
   as step 3 (max 6 queries a job; the trade phrase is the kit niche's `plural`, e.g. "Who are the
   best HVAC companies in Owasso, OK?"). Write markets/<niche>-<town>-<st> = {niche, town, state,
   question, chatgpt:[up to 5 names, in the order the ChatGPT text gives them], gemini:[up to 5, same],
   google:[the top 5 businesses a search for "<niche word> <town> <st>" shows: the local pack's 3,
   then the next businesses in the results, in order; one WebSearch now if Scout's check has fewer], googleFrom ("local pack" or "directory <name>"), jobId, sources, at}. Then apply
   the same answer to every lead of that niche + town (aiCheck named / not named / competitors),
   exactly as step 3. Names only from the gateway text or the search result; a failed tool stays
   empty, never filled from memory. Gateway down = markets doc not written, the page says "not
   checked yet", and a NEEDS YOU line. The page merges the three lists into "Top 5 in <town>"
   (Grayson, Oct 26, 2026: "show the top 5 in the area so I can include that in the pitch"), so
   5 real names per list matter more than anything else in this step.
3c. weakSpots: on every lead you score, write 2 to 4 short true lines from its facts and the AI
   result (shared shape in references/database-fields.md), most painful first ("ChatGPT and
   Gemini don't recommend them", "Only 7 Google reviews", "No website"). The page shows them on
   the pitch card.
4. Call list: every Qualified lead with a published phone gets callRank (1 = first), Hot
   before Warm, then by the call-script ranking rules, and callWindow ("7:00-8:15 AM" or "4:00-6:00 PM" Central).
5. Crew doc idle: "<q> qualified of <n>; top: <business> <score>".

## Audit
Every scored lead has scoreWhy lines that add up to the score, a tier and rubricVersion 2;
every Qualified lead has a whyNow whose facts are in its sources or aiCheck. No Qualified lead without a
score. No Not-a-fit lead without a reason line. Suppressed and Contacted leads untouched.

## Outputs
| Where | What |
|---|---|
| markets/<niche>-<town>-<st> | Who's On Top per niche + town (step 3b) |
| leads/<id> | weakSpots, score, scoreWhy, scoredAt, status, tier, buySignals, whyNow, rubricVersion, aiCheck.questions, callRank, callWindow |
| events/<day> | "Quinn: <q> qualified of <n> in <town>" |
| output/<day>-run.md | `## Quinn`: counts (Hot / Warm / Cold), the top 5 with score and whyNow, call list size, v2 re-scored count |
