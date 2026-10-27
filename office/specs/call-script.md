# Cold-call script and call list (Grayson calls; the office prepares)

The office never dials. It builds the call list (Lead Desk → Call list) from leads with a
published business phone, ranks them, picks the time window, and gives Grayson these words.
Grayson logs every call on the page (answered, voicemail, interested, not interested, do not
call) and the office learns from it (Sage: answer rate by time window, interest rate by trade).

## Best times (prospects are Central time)
- 7:00 to 8:15 AM: before they leave for the job. Best answer rate for owner-operators.
- 4:00 to 6:00 PM: back in the truck, phone in hand.
- Tuesday, Wednesday, Thursday. Monday is scheduling chaos; Friday they are gone early.
- Match the business: shops, salons and barbers answer best mid-morning (9:30 to 11) and
  mid-afternoon (2 to 4); restaurants 2:30 to 4:30 (between lunch and dinner, never at a meal
  rush); trades and contractors 7 to 8:15 AM or 4 to 6 PM; dentists and clinics at opening or
  just after lunch. Never after 8 PM (and the law says so).
- Rain day in their town = everyone answers. Scout notes the forecast on the call list.

## The only goal
Get the email address and a "yes, send the free check". Not a sale, not a meeting, not the
price. If they ask the price, answer it straight and ask for the start (specs/sales-psychology.md).

## The script (say it like a person; 20 seconds to the ask)
"Hey, is this the owner? [wait] This is Grayson with Ridgeline Local. Real quick: when someone
asks ChatGPT for the best <barber / dentist / plumber> in <town>, it names a few businesses, and
I wanted to see if you're one of them. I run a free check: I'll email you exactly what ChatGPT and
Gemini say about your business versus your competitors, and the three things I'd fix. Free, no
card, no catch. What's the best email for that?"
(Only say "it named <competitor> and you didn't come up" when a real check for their town and
trade in office/gw/out says so.)

If they hesitate: "It takes me two minutes and it's yours to keep either way. Where should I
send it?"

If they ask what it costs: "The check is free. If you want help after, plans start at $39.99 a
month, no contract. Most people pick Growth at $75: we fix your Google profile, get you
reviews from your real customers, and keep it moving every month. Pro at $125 adds leads we find
and send you. And on Growth and Pro, if your first month brings zero leads and no improvement,
your second month is free. But first let me send you the check so you can see it for yourself."

If they ask what we do in one line: "We get your business found on Google and recommended by AI
like ChatGPT and Gemini, and we make it easy for your happy customers to leave reviews."

If they ask how you found them: "Your Google listing. I work with local businesses, and I check
how AI answers for each kind of business in a town."

If they say don't call again: "Understood, I won't. Have a good one." Then log Do not call. The
office suppresses them the same day.

## Voicemail (10 seconds, leave the email)
"Hi, this is Grayson with Ridgeline Local. I'm running a free check on what ChatGPT says when
someone asks for a <trade> in <town>. I'll email it to the address on your website. If you'd
rather I didn't, no problem. Thanks."
(Then the office drafts the email to the published address as touch 1, marked "after voicemail".)

## Cold call sessions (Grayson, Oct 26, 2026; the page's Calls tab)
- "Start cold call session" picks the Niche of the Day (rotation over the kit's `niches`, ordered by
  callstats/main.nicheOrder once Sage has numbers; until Scout has stocked every niche, the niche
  with the most call-ready leads) and the city with the most call-ready leads in it. Grayson can
  pick another niche or city. One niche + one city per session, so the pitch stays the same.
- Callbacks due today come first, whatever their niche. Then that niche + city, best first
  (Ranking below). A lead is call-ready with a published business phone; office/tools/call_desk.py
  uses the same rules for Scout's stock (25+ per niche).
- At the top: "Who's On Top" (markets/<niche>-<town>-<st> from Quinn: who ChatGPT, Gemini and Google
  name), merged into one numbered "Top 5 in <town>" that Grayson can read out; the pitch card has
  it as a ready sentence, and the "Top 5 in town" opener uses it. Say "<business> doesn't come up"
  only when the lead's own AI check says not named. A one-tap pitch card: the opener (one of the kit's `pitch_lines`; the session mostly uses
  the best line by Interested/Sold rate and keeps testing the others), the lead's weakSpots, the
  value line, and quick answers to the kit's `quick_objections` (price, "I get enough work", "is
  this a scam", "send me info").
- One lead at a time: tap to call, then one outcome tap logs it and moves on: No answer, Voicemail,
  Callback (time picker), Interested (their email → the reply desk sends the free check within the
  hour, Lane I), Sold (plan + email → check + that plan's checkout link), Not interested. Do not
  contact sits apart (two taps). Voicemail with a published email → Echo's short follow-up with the
  AI check the next weekday morning, inside the email gates.
- End → summary: calls made, outcomes, callbacks scheduled, follow-up emails queued. Every call
  carries niche, town, pitchLine and sessionId so Sage can learn (06 step 5b).
- callStatus (New, Called, Voicemail, Callback, Interested, Sold, Not interested, Do not contact)
  is Grayson's word and lives beside the pipeline status; the page keeps both in step.

## Call log fields (the page's Log call buttons)
answered · voicemail · no answer · interested (email given) · not interested · do not call ·
wrong number. Each log line: {t, who:"Grayson", outcome, note, nextAt}. "Interested" sets the
lead to Replied and queues the free-check task. "Do not call" sets Suppressed and writes a
suppression doc with reason "asked on call".

## Ranking the call list (Quinn)
Tier first (Hot, then Warm; scoring.md v2), then score, then: has a published phone on their own site (+), owner's first name known (+),
low review count under 20 (+), unclaimed or thin Google profile (+), no website at all (++,
they need everything), recently reviewed (active business) (+). Skip anyone contacted by email
in the last 2 days (let the email land first).
