# 02 Quinn: score every New lead and rank the call list

## Inputs
| File | Section |
|---|---|
| references/scoring.md | all |
| skills/quinn/SKILL.md | all |
| specs/call-script.md | Ranking the call list |
| shared/gateway.md | all |
| database: leads where status in (New, Researching) in today's town; plus any lead with scoredAt older than 30 days and status Qualified (re-score) | out_dir |

## Process
1. Crew doc working: "Scoring <n> leads".
2. For each lead: compute the score from the rubric, one why-line per scoring signal with its
   source URL. Status by references/scoring.md (two doors to Qualified; Researching when the Google
   facts are unknown and door 2 does not apply; Not a fit only with known facts). Set scoredAt.
3. AI check (shared/gateway.md): one job for today's town with one query per trade, unless a
   job for that town+trade is under 7 days old (reuse it). Apply the answers to every lead of
   that town and trade: aiCheck.chatgpt / gemini named / not named / unknown, competitors,
   answers, by "gateway". Re-score: "not named by ChatGPT" counts as the search-check signal
   (+15) when the search check is missing. Never fill a result the gateway did not return.
4. Call list: every Qualified lead with a published phone gets callRank (1 = first) by the
   call-script ranking rules, and callWindow ("7:00-8:15 AM" or "4:00-6:00 PM" Central).
5. Crew doc idle: "<q> qualified of <n>; top: <business> <score>".

## Audit
Every scored lead has scoreWhy lines that add up to the score. No Qualified lead without a
score. No Not-a-fit lead without a reason line. Suppressed and Contacted leads untouched.

## Outputs
| Where | What |
|---|---|
| leads/<id> | score, scoreWhy, scoredAt, status, aiCheck.questions, callRank, callWindow |
| events/<day> | "Quinn: <q> qualified of <n> in <town>" |
| output/<day>-run.md | `## Quinn`: counts, the top 5 with score and the first why line, call list size |
