# Client happiness: they feel the value, say thanks, and stay another month

Grayson's standing order (Oct 28, 2026): "Make sure when people buy they're actually getting a
good product. I want people who buy to actually be thankful for my service and want to do
another month." Read with specs/client-delivery.md and specs/quality.md.

Why clients cancel a $40-$125/mo service: they forget what you did, they don't see a result, or
something confused them and nobody noticed. Every rule below fights one of those three.

## 1. Touchpoints (the client hears from us at the moments that matter)
| When | What (one short email, designed note, from the client's thread) | Owner |
|---|---|---|
| Within the hour of onboarding | Welcome Pack (already in specs/quality.md "Speed") | reply desk, Lane C |
| Day 3 | Check-in, ONE question: "Quick check: did the profile fixes make sense? Reply with anything confusing and I'll make it simpler." Skip if they already replied since the pack. | Day Shift 09 drafts (kind "checkin"), desk sends |
| The run it happens | **Win email** (see §2) | Day Shift 09 drafts (kind "win"), desk sends same run |
| Day 21 | "What we did so far": 3 to 5 bullets of real work done (each backed by a Gmail id, commit or row), the one number that moved (or "still moving, here's what's next"), what happens in week 4. Under 80 words. This lands BEFORE the renewal charge so they renew knowing what they paid for. | Day Shift 09 drafts (kind "update"), desk sends |
| Monthly | Results report PDF (specs/lead-tracking.md, specs/quality.md "report") | as now |

Never more than 2 emails a week to a client outside replies and leads. No fluff emails ("just
checking in!"): every email has a real number, a finished piece of work, or one question.

## 2. Win emails (the "thank you" moment)
Send a short win email the run the crew sees any of these, proven by data:
- ChatGPT or Gemini names them for a question where they weren't named at baseline (quote the
  answer's sentence word for word, the question, the date).
- A new Google review since the last check (count before → now; never quote a review unless it
  is public and quoted exactly with the reviewer's first name only).
- A profile fix we sent is now live on Google (the field and what it says now).
- Pro: a counted lead (already sent as a lead; the win line goes in the next update instead).
One win per email, 2 to 4 lines, the proof, then "Next we're working on <x>." No exaggeration:
"ChatGPT named you #3 today" not "you're blowing up."

## 3. Results must be real, not noise
Gemini on the free key answers without a web search, so its answers change run to run and
sometimes name businesses that don't exist. ChatGPT (web search) is steadier.
- A score change counts (in a win email, report or guarantee) only when it holds in 2 checks in a
  row. One check up = "early sign", never a headline. One check down = say nothing until the
  next check confirms it; then report it honestly with what we're doing about it.
- In reports, lead with ChatGPT's result; show Gemini as a second line labeled "Gemini (no web
  search)". Never list a Gemini-named competitor as a real business unless a WebSearch finds it.

## 4. Catch confusion fast
- Any client reply with a question, "I don't get it", "how do I", or no action 7 days after a
  deliverable → the next draft for that client is the ONE step that matters, rewritten simpler
  (shorter, a screenshot-style numbered path, "takes 2 minutes"). Log the lesson (§6).
- A client reply that is upset, mentions money, or says "not working" → alert Grayson the same
  run (shared/alerts.md) with a suggested reply, and the crew's best fix already drafted.

## 5. Cancel = learn
When a client says cancel: process it kindly (client-delivery.md "Cancel or pause"), and in the
same confirmation ask ONE optional question: "If you have 5 seconds: what would have made it
worth keeping?" Store client.cancelReason (their words, or "no answer"). Every cancel reason is
a line in skills/echo/SKILL.md "What I've learned" and is read by Sage on Sunday.

## 6. Learn from every client (feeds the crew's lessons)
After each client touchpoint with a response (reply, fix pasted, review gained, nothing), one
line in skills/echo/SKILL.md "What I've learned": what we sent → what they did → change for
next time. Sage's Sunday review turns repeated lines into a rule in specs/quality.md or this
file (with the date and the evidence count).

## 7. Measure it (the numbers Grayson sees)
Database clients/<id> gets: checkins[], wins[] {at, kind, proof}, lastUpdateAt, cancelReason.
The morning report carries one line when clients exist: "Clients: <n> active · <w> wins this
week · <c> confused/unanswered · renewals next 7 days: <names>". A client with renewal in 3
days and zero wins this month → this run drafts the strongest honest update we can and the flat
ladder (client-delivery.md) runs today, not on day 14.
