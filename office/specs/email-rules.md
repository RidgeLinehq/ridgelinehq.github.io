# Email rules (format, gates, sending)

Grayson's standing orders for every email the office writes or sends. shared/outreach-law.md
is the law; this is the house style and the mechanics.

## Shape of a first email (under 120 words)
```
Subject: <specific, lowercase ok, no tricks>

<First name or "Hi there" if no name is published>,

<Line 1: their loss, with the real competitors AI/Google names in their town and "not you">
<Line 2: one verified detail about their profile that explains why>

<Line 3: the free check: what they get, that it's free and theirs to keep>

<The one ask: "Want me to send it?" / "Best email for the screenshots?">

<signature from settings.signature>
<settings.optOutLine>
<settings.mailingAddress>
```
Follow-ups reply in the same Gmail thread (replyToMessageId = the first message's id).

## The QA gate (Echo runs it on every draft; a fail = rewrite, not send)
1. Facts: every number and name in the body exists in the lead doc with a source URL.
2. Specific: the body names the business, the town and one verified detail. A body that would
   fit another business fails.
3. Length: first email under 120 words, follow-up under 80, break-up under 60 (before footer).
4. Ask: exactly one ask, phrased as a one-tap reply.
5. Law: true From, honest subject, opt-out line present, mailing address present (empty
   address = no send, NEEDS YOU), identifies itself as a service offer.
6. Words: none from the banned list in shared/rules.md; no emoji; no ALL CAPS; at most one link.
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
Then: send with the Gmail tool (send_message, plain text, to the lead's contactEmail, from the
connected Ridgeline account), record {gmailMessageId, threadId, sentAt} on the draft and on
the lead's touches, set the lead's status to Contacted (first email) and nextTouchAt =
sentAt + followUpDays, delete the matching Gmail draft if one was created earlier, append an
events line, bump stats/<day>.sent. Pause 3 to 8 seconds between sends.
A send that fails is recorded as failed with the error; never retried the same run; the lead
keeps its status.

## When autoSend is false (the default)
Echo creates the email as a Gmail DRAFT in the Ridgeline account (create_draft; to, subject,
body) AND writes drafts/<id> with status "ready", gmailDraftId and the draft's viewUrl. Grayson
either taps Send inside Gmail (the office detects the sent message next run by searching
`in:sent to:<address>` and records it) or taps Approve on the page (the office sends it on the
next run and deletes the Gmail draft). Reject on the page = status rejected, lead stays
Qualified with a note.

## Reply handling
The reply desk task answers replies and labels threads "Ridgeline-Handled". Sage reads those
threads each run: reply → lead status Replied (with the thread id and one-line gist); "yes" or
"send it" → Meeting-stage work: create a task for Grayson on the page ("Take the ChatGPT +
Gemini screenshots for <business>", with the exact two questions to ask) and a draft of the
free-check email for Echo to finish once screenshots are attached; payment → Client; no/stop →
Suppressed + suppression doc.
