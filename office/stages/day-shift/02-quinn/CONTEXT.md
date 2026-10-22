# 02 Quinn: score every New lead and rank the call list

## Inputs
| File | Section |
|---|---|
| references/scoring.md | all |
| skills/quinn/SKILL.md | all |
| specs/call-script.md | Ranking the call list |
| database: leads where status in (New, Researching) in today's town; plus any lead with scoredAt older than 30 days and status Qualified (re-score) | out_dir |

## Process
1. Crew doc working: "Scoring <n> leads".
2. For each lead: compute the score from the rubric, one why-line per scoring signal with its
   source URL. Set status Qualified when score >= settings.scoreGate, else Not a fit (with the
   why). Set scoredAt.
3. Prepare the AI check for every Qualified lead: aiCheck.questions = the two exact questions
   Grayson will paste ("Who are the best <trade>s in <town>, <state>?" and "I need a <trade> in
   <town> <state>, who should I call?"), aiCheck.chatgpt and gemini = "unknown" until he taps.
   Never fill them yourself.
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
