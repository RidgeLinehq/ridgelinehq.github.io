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

If they ask what it costs: "The check is free. If you want help after, plans start at $75 a
month, month to month. Most people pick Growth at $125: we fix your Google profile, get you
reviews from your real customers, and send you leads. And if your first month brings zero leads
and no improvement, your second month is free. But first let me send you the check so you can
see it for yourself."

If they ask what we do in one line: "We get your business found on Google and recommended by AI
like ChatGPT and Gemini, and we send you leads."

If they ask how you found them: "Your Google listing. I work with local businesses, and I check
how AI answers for each kind of business in a town."

If they say don't call again: "Understood, I won't. Have a good one." Then log Do not call. The
office suppresses them the same day.

## Voicemail (10 seconds, leave the email)
"Hi, this is Grayson with Ridgeline Local. I'm running a free check on what ChatGPT says when
someone asks for a <trade> in <town>. I'll email it to the address on your website. If you'd
rather I didn't, no problem. Thanks."
(Then the office drafts the email to the published address as touch 1, marked "after voicemail".)

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
