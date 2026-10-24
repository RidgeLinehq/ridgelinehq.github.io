# 02 Quinn: score every New lead and rank the call list

## Inputs
| File | Section |
|---|---|
| references/scoring.md | all |
| skills/quinn/SKILL.md | all |
| specs/call-script.md | Ranking the call list |
| office/call_kit/call_kit.py | --rank (the ranking is code, not prose) |
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
4. Call list (V8, Oct 24, 2026): `python3 office/call_kit/call_kit.py --rank <the leads out_dir>`
   prints one row per eligible lead (a published phone, status New / Researching / Qualified /
   Contacted more than 2 days ago; never Suppressed, Not a fit, Client, Meeting, Replied) with
   callRank (not named by the AI check first, then score), callWindow (job-site trades early or
   late, others mid-morning or mid-afternoon) and aiResultLine. Write those three fields on each
   lead (batch, if_version). The Office page's Calls screen ranks the same way on its own, so
   this step only keeps the database and the page in agreement; it never blocks the run.
5. Crew doc idle: "<q> qualified of <n>; top: <business> <score>".

## Audit
Every scored lead has scoreWhy lines that add up to the score. No Qualified lead without a
score. No Not-a-fit lead without a reason line. Suppressed and Contacted leads untouched.

## Outputs
| Where | What |
|---|---|
| leads/<id> | score, scoreWhy, scoredAt, status, aiCheck.questions, callRank, callWindow, aiResultLine |
| events/<day> | "Quinn: <q> qualified of <n> in <town>" |
| output/<day>-run.md | `## Quinn`: counts, the top 5 with score and the first why line, call list size |
