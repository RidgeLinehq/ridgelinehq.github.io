# The free AI check (the product's front door)

Grayson's standing order (Oct 22, 2026): anyone who asks gets a real check fast, any day,
with no tap from him. The reply desk does it inside one run (request → gateway → email) so a
request made at 6 PM Saturday is answered by 8 PM Saturday, not Monday.

## Who gets one
- A prospect who replies yes / send it / sure to an outreach email.
- Anyone who emails the Ridgeline Gmail through the website form (subject starts
  "Free AI check request —") or writes in asking for the check.
- Grayson's own leads (people who message him on Facebook, Instagram or in person): he emails
  the Ridgeline Gmail from his personal address with the subject
  `check: <Business>, <Town ST>, <what they do>[, <their email>]`. The desk runs the check and
  replies to HIM with a paste-ready message; if an email was given it also sends the full
  check to the prospect.
- Never: anyone on the suppression list, or a second check for the same business inside 30 days
  (send the previous one again instead).

## How the check is run (shared/gateway.md is the protocol)
1. Trade phrase: the plural people would type. roofing → "roofers"; tree service → "tree
   services"; barber → "barbers"; HVAC → "HVAC companies"; restaurant → "restaurants"; a trade
   you don't recognize → "<their words> businesses". Town and state from the request.
2. One job, one query: `{"key":"<town>-<st>-<slug>", "question":"Who are the best <trade
   phrase> in <Town>, <ST>?", "city":"<Town>", "region":"<State name>"}`. Reuse an out file for
   the same town + trade phrase under 7 days old.
3. named = the business name (or its distinctive first two words) appears in the answer text,
   case-insensitive. Record aiCheck on the lead exactly as gateway.md says.
4. If the gateway returns nothing in 6 minutes or both tools error: do NOT send a check. Set
   lead.freeCheck.status "gateway failed", write a NEEDS YOU line, tell Grayson once, and try
   again next run (max 3 tries, then tell him it needs a look).

## The three fixes (pick the three that apply, in this order, from facts you actually have)
| If | Fix (one plain sentence each, in the email) |
|---|---|
| not named by either tool | Your Google Business Profile needs the exact services and a description that says what you do and the towns you serve; both tools lean on it. |
| reviews unknown or under 30 | Ask every finished customer for a Google review with a text and a QR card; both tools quote review counts and recent reviews. |
| named by one tool, not the other | The tool that missed you is reading a thin or inconsistent profile; same name, address and phone on Google, Yelp and Facebook fixes most of that. |
| no website | A one-page website with your town and services gives the tools something to cite. |
| Yelp unclaimed or missing | Claim your Yelp page (ten minutes) so the tools stop seeing an empty listing. |
| photos under 10 or hours missing | Add real job photos and your hours; the tools treat an incomplete profile as a weaker business. |
| nothing else known | Reply to every review by first name within a week; recent replies are a signal both tools read. |
Never invent a fact to justify a fix. "I couldn't see your review count from here" is allowed.

## The email (under 230 words before the footer; plain text; one link besides the guarantee)
```
Subject: Your free AI check: <Business> in <Town>

<First name or Hi there>,

Here's your check. Today I asked two AI tools the same question: "Who are the best <trade
phrase> in <Town>, <ST>?"

ChatGPT (<model>, live web search <on|off>) named: <1>, <2>, <3>[, <4>, <5>].
<Business>: <named|not named>.

Gemini (<model>[, no live search]) named: <1>, <2>, <3>.
<Business>: <named|not named>.

Three fixes I'd make first:
1. <fix>
2. <fix>
3. <fix>

If you'd rather have it done for you: plans start at $75 a month, month to month. Most
businesses pick Growth ($125): we fix all of the above and send you leads, and if your first
month brings zero tracked leads and no improvement in your AI visibility, your second month is
free (terms: https://ridgelinehq.github.io/guarantee.html). [Only if data/founding.json
spotsLeft > 0: "<N> founding spots left: the first 20 clients keep their price for life."]
See the plans: https://ridgelinehq.github.io/#pricing

Or just reply with any question.

<settings.signature>
<settings.optOutLine>
<settings.mailingAddress>
```
Rules: the names come from the gateway text only; never label a Claude guess as ChatGPT or
Gemini; never say "ranked", "#1" or "will"; if a tool errored, say "Gemini didn't answer today"
and give ChatGPT's list alone. Send as a reply in the prospect's thread when one exists,
otherwise a new message. Replies have no send window and no daily cap (email-rules.md); the
suppression list always applies.

## The paste-ready version for Grayson (his own leads; under 110 words, no footer)
```
Ran your check. I asked ChatGPT and Gemini "Who are the best <trade phrase> in <Town>?"
ChatGPT named <1>, <2>, <3>. Gemini named <1>, <2>, <3>. <Business> was <named by
both|named by ChatGPT only|named by Gemini only|not named by either>.
Three things I'd fix first: <fix 1 short>; <fix 2 short>; <fix 3 short>.
I can fix all of it from $75/mo, month to month. Growth ($125/mo) also sends you leads, and if
the first month brings zero tracked leads and no AI improvement, month 2 is free. Plans:
ridgelinehq.github.io/#pricing. Want me to start?
```

## Record (the page reads these)
- lead.freeCheck = {requestedAt, sentAt, gmailMessageId, threadId, jobId, status:
  "sent"|"gateway failed"|"suppressed", fixes:[3 strings], by:"reply desk"}
- lead.status = Meeting (a check was sent; the offer is in their hands), aiCheck as gateway.md.
- drafts/<id> kind "freecheck", status sent, evidence, body (so the page can show it).
- events/<day> line; stats/<day>.freeChecks += 1.
