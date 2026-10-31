# Email rules (format, gates, sending)

Grayson's standing orders for every email the office writes or sends. shared/outreach-law.md
is the law; this is the house style and the mechanics.

## Shape of a first email (under 90 words before the footer; Grayson, Oct 31, 2026: "not 13,000 paragraphs")
Three short paragraphs, each 1 to 2 sentences, then the ask, then the card. Built ONLY with
`python3 office/tools/cold_email.py build <spec.json>` (it checks the shape, the words, the law
lines and prints the plain `body` and the `htmlBody`; a build that is not ok = rewrite, never a
hand-made body). Target 60 to 80 words; the tool refuses 90 or more.
```
Subject: <specific, lowercase ok, no tricks, under 60 characters>

<First name or "Hi there" if no name is published>,

<P1, their loss, 1 to 2 sentences: "When someone in <Town> asks ChatGPT for a <trade>, it names
<A> and <B>. Not <Business>." Only names a real check returned; no check = the one verified gap
on their profile ("Your Google profile shows 4 photos and no services.")>

<P2, the give, 1 sentence: "I ran a free AI check on <Business>: what ChatGPT and Gemini say,
who they name instead, and the 3 fixes. It's free and yours to keep.">

<The one ask, one line: "Want me to send it? Just reply yes.">

<signature from settings.signature>

[the card: one small picture, see "The HTML version"]

<settings.optOutLine>
<settings.mailingAddress>
```
Follow-up (under 60 words): one new specific finding + the ask. Break-up (under 45 words): "I'll
stop here. The check is still free if you want it; just reply 'send it'." Follow-ups reply in the
same Gmail thread (replyToMessageId = the first message's id).

## The HTML version (every cold email, follow-up and break-up; Grayson, Oct 31, 2026: "a little picture")
- Send with mcp__Gmail__send_message using BOTH fields the tool printed: `body` (the plain text,
  the alternative every mail client can read) and `htmlBody` (the same words in a plain note).
- The note is one column, system font, dark text on white, the paragraphs as they are, the
  signature, then ONE picture: the Ridgeline card
  https://ridgelinehq.github.io/assets/email/free-ai-check.png (free AI check, then $39.99 a
  month, the site address), linked to https://ridgelinehq.github.io/, with alt text. Then the
  footer in small grey type.
- The card is the email's ONE link (QA gate 6). The plain text carries the same address on its
  own line under the signature. No other link, no tracking pixel, no other image, no attachment,
  no background image, no button, no template.
- The tool checks the card URL answers 200 before each build. If it does not, the email goes out
  without the card (the tool says "card offline"), the run doc says so, and Patch alerts.
- A draft Grayson sends himself from Gmail goes out as he sends it; the office never edits it.

## The QA gate (Echo runs it on every draft; a fail = rewrite, not send)
1. Facts: every number and name in the body exists in the lead doc with a source URL.
2. Specific: the body names the business, the town and one verified detail. A body that would
   fit another business fails.
3. Length and shape: first email under 90 words, follow-up under 60, break-up under 45 (before
   the footer and the card); at most three short paragraphs plus the ask, no paragraph over 2
   sentences, no bullets. `office/tools/cold_email.py build` checks this; not ok = rewrite.
4. Ask: exactly one ask, phrased as a one-tap reply.
5. Law: true From, honest subject, opt-out line present, mailing address complete (street,
   city, state and a 5-digit ZIP; anything less counts as empty = no draft created, no send,
   NEEDS YOU), identifies itself as a service offer.
6. Words: none from the banned list in shared/rules.md; no emoji; no ALL CAPS; at most one link
   (the card is that link; no URL in the paragraphs or the ask).
7. Promises: no rankings, no "#1", no lead counts, no invented results, no fake limits.
8. Levers: at least three of the ten in specs/sales-psychology.md, named in the draft's qa
   field (so Sage can score which levers get replies).
Score the draft 0 to 100 on specificity, clarity and pull; record it in drafts.qa.score. Under
80 = rewrite once; still under 80 = status draft with qa.flags, not ready.

## Sending gates (every one must pass, in this order)
1. settings.paused is false and settings.dryRun is false.
2. The lead's status is Qualified (first email) or Contacted with a due follow-up, and the
   lead is not Suppressed, not on the suppression list (address, domain or business name), and
   has not bounced.
3. Weekday, Central time inside the send window (7:00 to 9:30 AM).
4. Today's sent count (stats/<day>.sent) is below settings.dailyEmailCap, and the cap is within
   the ramp in shared/rules.md.
5. The draft's status is "approved" (Grayson tapped Approve on the page) OR settings.autoSend is
   true and the draft passed the QA gate at 80 or more.
6. The draft has a subject, a body, a lead id, and the lead has a contactEmail with a source.
7. EMAIL CHECK (Oct 27, 2026: 4+ sends bounced in two days, and bounces hurt the Gmail's
   reputation): `python3 office/tools/email_check.py check <contactEmail>` returns ok true. Once per
   run, before the first send, write one job with every address you plan to email
   (`email_check.py job ...`; it stores DOMAINS only), commit, push, and wait up to 2 minutes for
   office/emailcheck/out/<id>.json; if it has not landed, send on the local check alone. ok false =
   do not send; set lead.emailStatus "bad" with the reason and fix, keep the lead's status, and add
   it to the run's needsYou as one line ("<business>: <fix>") on that run only; it is never listed
   again (Grayson, Oct 31, 2026). The lead stays on the call list; nobody chases the address.
Then: send with the Gmail tool (send_message with BOTH `body` and `htmlBody` exactly as
`office/tools/cold_email.py build` printed them, to the lead's contactEmail, from the
connected Ridgeline account), record {gmailMessageId, threadId, sentAt} on the draft and on
the lead's touches, set the lead's status to Contacted (first email) and nextTouchAt =
sentAt + followUpDays, delete the matching Gmail draft if one was created earlier, append an
events line, bump stats/<day>.sent. Pause 3 to 8 seconds between sends.
A send that fails is recorded as failed with the error; never retried the same run; the lead
keeps its status.

## When autoSend is false (the default)
Echo creates the email as a Gmail DRAFT in the Ridgeline account (create_draft; to, subject,
body AND htmlBody exactly as cold_email.py printed them, so the card goes when he taps Send) AND
writes drafts/<id> with status "ready", gmailDraftId and the draft's viewUrl. Grayson
either taps Send inside Gmail (the office detects the sent message next run by searching
`in:sent to:<address>` and records it) or taps Approve on the page (the office sends it on the
next run and deletes the Gmail draft). Reject on the page = status rejected, lead stays
Qualified with a note.

## Reply handling
The reply desk task (every 2 hours) SENDS the answers itself since Oct 22, 2026 (Grayson: no
approvals), welcomes paying clients, and labels threads "Ridgeline-Handled". It only escalates
what it cannot answer from the offer. Sage reads those
threads each run: reply → lead status Replied (with the thread id and one-line gist); "yes" or
"send it" → status Meeting and a "freecheck" draft for Echo: the exact ChatGPT and Gemini
answers for their town (gateway, under 7 days old; run a new job if older), whether they were
named, the 3 fixes from their profile facts, then the offer in 2 lines (plans from $39.99, Growth $75 most popular, the guarantee link) and one ask. A
free check is a reply to someone who asked for it: with autoSend on it goes out on the next run
after the QA gate (no send window or cap applies to replies, the suppression list always does),
otherwise it waits as "ready"; payment → Client; no/stop →
Suppressed + suppression doc.
