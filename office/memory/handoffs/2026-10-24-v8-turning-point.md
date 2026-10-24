# Handoff: V8 "The Turning Point", Ridgeline side (Oct 24, 2026, branch claude/new-session-mhoaoj)

## Built
- Cold Call Kit: `office/call_kit/call_kit.py` (script, objections, outcomes, best call time, ranking) and `kit.json`; the Office "Calls" screen (version 9) with 15 real businesses and real AI-check results; one-tap outcomes write the lead and queue the follow-up for the reply desk (Lane G).
- Automatic messages: `stages/reply-desk/CONTEXT.md` Lane G (call follow-ups, free-check deliveries, normal questions sent by the desk itself) and Lane H (Medic tickets); Quinn ranks leads with the kit.
- The Medic: `office/medic/medic.py` (copy of the GM engine), `lanes.json`, `schema.sql`, `.github/workflows/medic.yml`; verified with selftest, dry run and a real pass on a fresh clone of main.
- The Ridgeline Local look: `office/page/ridgeline-office.html` (version 10 live): Today with the Next card, rows Leads & calls, AI checks, Client updates, Messages, Reports, Website; Work; Agents (the floor, the Medic board, the task queue); More (calls, leads, outreach, studio, learning, analytics, settings).
- The website: `index.html` in the V8 green, "any local business, anywhere", lazy below-the-fold image; `specs/offer.md` wording updated; `shared/rules.md` weekly grading rule.
- Every skill file carries the agent header ("My job is to make Grayson money...").

## Verified
- Office page: Playwright at 390 px, light and dark, every tab; stub database writes checked.
- Website: three widths, no errors, CTA in the first screen at 390 px.
- Medic: selftest and dry runs; the website http check from the sandbox returns code 0 (proxy), handled as unknown.

## Open (Grayson)
- Merge the branch; then the Medic Action, Lane G sends and the new website go live.
- The Medic's needs-you texts include the OpenAI billing line; only he can top up.
