# 03 Parker: the angle and the hook for each lead going out today

## Inputs
| File | Section |
|---|---|
| specs/sales-psychology.md | all |
| specs/offer.md | all |
| skills/parker/SKILL.md | all |
| database: leads where status == Qualified and contactEmail set and no touches, ordered by score desc, limit = today's remaining cap x 2; plus leads with nextTouchAt <= now and touches < maxTouches (follow-ups) | out_dir |

## Process
1. Crew doc working: "Picking angles for <n> leads".
2. For each lead pick ONE primary lever (the loss, the gap detail, the give) and the exact hook
   sentence, using the lead's own facts: the competitors named in searchCheck, the thin spot in
   the profile, the review count. Write angle {lever, hook, detail, by, at}. Each hook must be
   specific to that business (its name, town, number); identical hooks across leads fail.
3. Follow-ups get a new angle (the second finding), never the first one repeated. Break-ups get
   lever "take the pressure off".
4. Rotate subject-line patterns across the batch (two patterns per week, alternating by lead
   order) and tag each lead's angle.subjectPattern so Sage can score them.
5. Crew doc idle: "<n> angles set".

## Audit
No two leads share a hook. Every hook cites a fact that exists in the lead doc. No promises
beyond specs/offer.md. No invented competitor names.

## Outputs
| Where | What |
|---|---|
| leads/<id> | angle |
| events/<day> | "Parker: <n> angles, patterns A/B" |
| output/<day>-run.md | `## Parker`: one line per lead: business, lever, hook (first 8 words), pattern |
