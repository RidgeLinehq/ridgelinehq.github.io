# Crew memory (read this first; under 60 lines; newest first)
_The Ridgeline Office crew's shared long-term memory. Every run reads it at the start (CLAUDE.md "Memory rule"). Each line has a date; a source where there is one. No personal details of Grayson or of any lead beyond what the database already holds, no secrets, ever: the repo is public._

## Standing truths (Oct 24, 2026)
- V8 "The Turning Point" (Oct 24): the Cold Call Kit (`office/call_kit/`, the Office "Calls" screen), automatic messages (reply desk Lane G sends call follow-ups and free checks itself; price talk and angry replies go to Grayson), the Medic (`office/medic/`, Actions every 30 min after merge), the Ridgeline Local look (Office version 10), the website in the same green. Full record: `memory/handoffs/2026-10-24-v8-turning-point.md`.
- Ridgeline is for any local business, anywhere (Grayson, Oct 22 and Oct 24). The offer, the price ($147 for 3 months, then $197; guarantee page) and the free AI check are in `specs/offer.md`; the website and that file must agree.
- The crews read `main`. The V8 work sits on branch `claude/new-session-mhoaoj` until Grayson merges it; before the merge the Day Shift and reply desk run the older rules and the website shows the older look.
- Money: $0 spent beyond the approved $5 OpenAI credit for AI checks; the AI check gateway (`office/gw/jobs` -> "Ridgeline AI check" Action -> `office/gw/out`, ChatGPT + Gemini) is the free path. "Add $5 at platform.openai.com > Billing" is the one billing fix and it is Grayson's.
- Crews: Day Shift (Mara + crew, weekdays 7:07 AM CT; outreach, leads, checks), reply desk (every 2 h, 7:37 AM to 11:37 PM CT; inbox, drafts, sends, Lanes A to H), Emergency Watch (every 4 h, alert-only). Scout Intel, the Night Shift, Bolt and the rest belong to the GM Agency, not here.
- Lane H (after merge): the reply desk fires the Day Shift once a day for a Medic ticket that asks for it and writes needs-you lines to `health/desk`; it never creates tickets or edits Medic code.
- The Office page reads `office/medic/public/medic_report.json` from main every 10 minutes; before the merge that file does not exist and the Medic board stays empty (expected).
- Calls: 15 real businesses with weak AI visibility (Owasso, Cabot, Foley) with real ChatGPT and Gemini results; outcomes no answer, not interested, call back, send the check, interested, do not call, each with its follow-up in Lane G.
- Honesty: never label a Claude answer as ChatGPT or Gemini; never a sent claim without a Gmail id; "fixed" only after it was checked again.
- Grayson's face may appear in Ridgeline promo videos (V8); the Ridgeline lane gets no new promo work until the shop has 3 sales (foreman-rules), and TikTok is his.

## Gotchas that cost runs before
- Pushes made with GITHUB_TOKEN never trigger other workflows; the Medic uses the Actions API instead.
- The website check from a sandbox can return HTTP code 0 (proxy): the Medic treats 0 as unknown, not down.
- The reply desk's hourly numbers are counted from Gmail ids and the run log, never from drafts.

## Where memory lives
- This file (shared). `facts.md` (dated facts, append-only). `decisions.md` (Grayson's decisions index). `agents/<id>.md` (mara, scout, quinn, parker, echo, nova, sage, patch). `handoffs/` (session handoffs). `skills/<id>/SKILL.md` "What I've learned" (the nightly line).
