# Cold-call script and call list (Grayson calls; the office prepares)

## V8 "The Turning Point" (Oct 24, 2026): the Calls screen (this section wins over the rest)
The Office page has a **Calls** screen. Every morning it shows today's call list: up to 15 real
local businesses with weak AI visibility, each with name, town, phone (tap to call), the free
AI-check result in one line, and the best time to call. The words and the rules are CODE, one
home: `office/call_kit/call_kit.py` (`kit.json` is generated from it; the page reads it from
https://ridgelinehq.github.io/office/call_kit/kit.json and carries the same text as a fallback).
- Tone: Christian-honest. True, kind, no pressure, no lies, no invented claims. The AI-check line
  on the screen is whatever the gateway returned ("isn't mentioned by ChatGPT or Gemini", or "AI
  check not run yet"); the script never says a business is unseen when the check was not run.
- Who is on the list: a published phone; status New, Researching, Qualified, or Contacted more
  than 2 days ago; never Suppressed, Not a fit, Client, Meeting or Replied. Order: scheduled
  call-backs first, then businesses the AI does not name, then Quinn's rank, then score.
- After each call Grayson taps ONE outcome: No answer · Not interested · Call back · Send the
  free check · Interested (and Do not call). Each tap writes the lead and queues the follow-up:

| Tap | What the office does, with no second tap |
|---|---|
| No answer | logs it; the business comes back on the next call day, up to 3 tries, then email only |
| Not interested | status Not a fit; no more calls or emails |
| Call back | asks when (today 4:30 PM / tomorrow 7:30 AM / pick); sets nextCallAt; back on the list then |
| Send the free check | asks for the email if none is on file; the reply desk (Lane G, within 2 hours) runs the real ChatGPT + Gemini check and emails the one-page report |
| Interested | same, plus the founding offer and payment link in the email; Grayson gets one line when it went out |
| Do not call | Suppressed the same minute, with a suppression doc "asked on call" |

The old long-form script below still applies for voicemail and the objections it covers.


The office never dials. It builds the call list (Lead Desk → Call list) from leads with a
published business phone, ranks them, picks the time window, and gives Grayson these words.
Grayson logs every call on the page (answered, voicemail, interested, not interested, do not
call) and the office learns from it (Sage: answer rate by time window, interest rate by trade).

## Best times (prospects are Central time)
- 7:00 to 8:15 AM: before they leave for the job. Best answer rate for owner-operators.
- 4:00 to 6:00 PM: back in the truck, phone in hand.
- Tuesday, Wednesday, Thursday. Monday is scheduling chaos; Friday they are gone early.
- Never 10 AM to 3 PM (on the roof, in the tree). Never after 8 PM (and the law says so).
- Rain day in their town = everyone answers. Scout notes the forecast on the call list.

## The only goal
Get the email address and a "yes, send the free check". Not a sale, not a meeting, not the
price. If they ask the price, answer it straight and ask for the start (specs/sales-psychology.md).

## The script (say it like a person; 20 seconds to the ask)
"Hey, is this the owner? [wait] This is Grayson with Ridgeline Local. Real quick: I asked
ChatGPT who the best roofer in Cabot is and it named <competitor 1> and <competitor 2>. You
didn't come up. I can email you exactly what it said and the three things I'd fix. Free, no catch.
What's the best email for that?"

If they hesitate: "It takes me two minutes and it's yours to keep either way. Where should I
send it?"

If they ask what it costs: "The check is free. If you want me to actually fix it, it's $147 a
month for the first three months, then $197, month to month, cancel by email. If you don't gain
15 real reviews in 60 days, the third month is free. But first let me send you the check so you
can see it for yourself."

If they ask how you found them: "Your website / your Google listing. I only work with roofers
and tree services in a few towns, and <town> is one of them."

If they say don't call again: "Understood, I won't. Have a good one." Then log Do not call. The
office suppresses them the same day.

## Voicemail (10 seconds, leave the email)
"Hi, this is Grayson with Ridgeline Local. I checked what ChatGPT says when someone asks for a
roofer in Owasso and you're not on it. I'll email what it said to the address on your website.
If you'd rather I didn't, no problem. Thanks."
(Then the office drafts the email to the published address as touch 1, marked "after voicemail".)

## Call log fields (the page's Log call buttons)
answered · voicemail · no answer · interested (email given) · not interested · do not call ·
wrong number. Each log line: {t, who:"Grayson", outcome, note, nextAt}. "Interested" sets the
lead to Replied and queues the free-check task. "Do not call" sets Suppressed and writes a
suppression doc with reason "asked on call".

## Ranking the call list (Quinn)
Score first, then: has a published phone on their own site (+), owner's first name known (+),
low review count under 20 (+), unclaimed or thin Google profile (+), no website at all (++,
they need everything), recently reviewed (active business) (+). Skip anyone contacted by email
in the last 2 days (let the email land first).
