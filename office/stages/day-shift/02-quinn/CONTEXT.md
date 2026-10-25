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
| leads/<id> | score, scoreWhy, scoredAt, status, tier, buySignals, whyNow, rubricVersion, aiCheck.questions, callRank, callWindow |
| events/<day> | "Quinn: <q> qualified of <n> in <town>" |
| output/<day>-run.md | `## Quinn`: counts (Hot / Warm / Cold), the top 5 with score and whyNow, call list size, v2 re-scored count |
