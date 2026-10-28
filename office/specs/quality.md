# Client work quality: make it amazing, deliver it automatically

Grayson's standing order (Oct 24, 2026): "Make sure my office makes their products amazing and
gives it to them automatically." Every piece of client work passes this gate before it is
marked ready, and every ready piece is emailed to the client by the reply desk (Lane D) without
anyone approving it.

## The bar: a busy owner opens it on a phone and thinks "that's exactly my business, and I can do this in 2 minutes"
Score each deliverable 0 to 100 on these six (write the score and the weakest line on the draft as
`qa: {score, weakest, rewrites}`). Ship at 85+. Below 85: rewrite the weakest part and score
again (up to 2 rewrites). Still under 85 after 2 rewrites: ship the best version only if it is
75+, and alert Grayson (shared/alerts.md) with what was missing; under 75 do not ship, alert.

| Check (points) | What full marks looks like |
|---|---|
| Specific (25) | Their business name, town, real services, real competitors from the gateway text, their real review count. Nothing that could be sent to another business unchanged. |
| Ready to use (20) | Paste-ready text in its own block, exact field names in Google ("Edit profile → Business information → Description"), links that work. Zero homework beyond paste/tap. |
| Clear next step (15) | One action, first line, with how long it takes ("2 minutes"). |
| Proof (15) | Shows what changed with numbers: score then vs now, reviews then vs now, leads this month, what ChatGPT/Gemini said word for word, dated. Zeros shown honestly with what we're doing next. |
| Looks good on a phone (15) | Short paragraphs, numbered steps, no walls of text, no jargon, under the length limit for the kind. |
| True (10) | Every fact traceable to the client, the lead log, the gateway text or a source URL. One invented fact = score 0. |

## Who grades (Oct 28, 2026: the writer never grades its own work)
A worker that wrote a deliverable always thinks it's good. So the qa score comes from a FRESH
grader: launch a separate worker (Agent tool) that gets only (a) the finished deliverable (the
PDF rendered to page images, or the email text), (b) this file, (c) the client's facts and the
source URLs, and none of the drafting conversation. Its job: "You are the busy owner of
<business>, reading this on your phone between jobs. Score it on the six checks. Find every
fact you can't trace to a source. List the 3 weakest lines, worst first." The writer fixes those
and the grader scores again (counts as a rewrite). Record qa.by = "grader". A draft scored only
by its writer is not ready. If the Agent tool is missing in a run, score it yourself, record
qa.by = "self" and the desk re-grades it before sending.

## Rules from the first test buy (Oct 28, 2026: fresh grader scored 71, then 88 after fixes)
- A review count is labeled with the site that shows it. A third-party site's own review count is
  never called "Google reviews". When copies disagree, show the range and both sources.
- Lead the proof with the client's strength when it's real ("your 4.9 matches ChatGPT's #1 pick:
  you're losing on visibility, not quality"). It's truer and it's what makes them stay.
- Never tell a trade to mark nights or weekends Closed without the emergency branch (a plumber,
  HVAC, tow or locksmith can lose calls). Google "More hours" takes time slots only, not text.
- No blanks to fill. Write the most likely answer with "[delete if not]" instead of
  "[your answer]". The only allowed blank is the review link, with the Manager-access shortcut.
- We usually can't open the Google listing itself (it blocks fetches). Say so in one line, use
  the onboarding facts first, and label every fact from a copy site with its source. Ask for
  Manager access in the Welcome Pack: it unlocks the real listing for every later check.
- Never claim a Google category, setting or menu exists unless you saw it; hedge with "if it
  shows up when you type it".
- Facts from a search-result title only (not an opened page) are "may", never stated as found.
- Every pack ends with a sources block (make_pack.js "sources").

## Learn from the best one (golden example)
Before drafting a Welcome Pack or a monthly report, read office/examples/ (the best graded
example of that kind, fictional business, 90+). Match or beat it; never copy its facts. When a
real deliverable grades higher than the example, Sage replaces the example on Sunday with a
fictionalized copy (new business name, town, numbers; same structure and quality).

## The standard for each kind
- **Profile fixes ("plan")**: every field Google lets them fill, written for them: primary and
  secondary categories (Google's exact category names), 750-character description that names
  the town, nearby towns and top services in plain words, services list with one-line
  descriptions, hours check, 5 Q&A pairs customers really ask, 10 photo ideas specific to their
  business ("your chair setup with the shop sign behind it"), and the 3 changes that matter most
  marked "do these first".
- **Review kit ("kit")**: a text message in their voice (under 300 chars, their review link),
  the QR card image link, a 1-line script for staff ("If you enjoyed today, would you leave us a
  quick Google review? Here's the link."), and the "send us 10 customer emails and we'll ask for
  you" offer.
- **Review request ("reviewreq")**: warm, short, from "<business>", their first name if known,
  one link, no pressure, no incentive.
- **Leads ("leads")**: each lead with what they asked in their own words, when, where, a link or
  contact, and a suggested reply the owner can copy (2 sentences, friendly, with their booking
  link or phone).
- **Google post ("post")**: timely (season, local event, real offer the client gave us), a photo
  idea, under 1,500 characters, one call to action.
- **Monthly report ("report")**: starts with the best real number of the month in one line
  ("You got 4 leads and ChatGPT now names you for 'best barber in Tulsa'"), then leads, jobs,
  AI score trend, reviews, work done, next month's plan in 3 bullets.
- **Lead page (Pro)**: their real services, their phone as the big button, fast on a phone,
  checked by opening it after the push (curl or WebFetch) before the link is sent.
- **Promo video (Pro)**: office/studio quality gate; their real photos and facts; captions
  readable on mute; 20 to 35 seconds; their phone or lead page at the end.

## Format: real, branded files (Grayson, Oct 24, 2026: "are they going to get sent a file?")
Clients get designed deliverables, not walls of instructions:
- Build every client deliverable as a branded PDF with `node office/tools/make_pack.js <spec.json> <out.pdf>`
  (blocks: score gauge, AI answers table, competitors, paste-ready copy boxes, lists, stats, 30-day
  steps; example spec: office/tools/pack-example.json). Specs live in the session scratchpad,
  never in the repo (client facts are private).
- Send it with mcp__Gmail__send_message: `attachments: [{filename: "<Business> - <Title>.pdf",
  mimeType: "application/pdf", content: <base64 -w0 of the PDF>}]`, `htmlBody` = a SHORT designed
  note (3 to 6 lines: the one best number, the one next step, "everything is in the attached
  PDF"), `body` = the same note in plain text, `replyThreadId` = the client's thread.
- ONE email per moment, not three: the Welcome Pack (starting score + profile fixes + review kit +
  next 30 days) is one email with one PDF. The monthly report is one email with one PDF. The QR
  card PNG (cards/<slug>.png, fetched with curl) rides as a second attachment when it exists.
- If the PDF can't be built (Playwright missing), send the same design as htmlBody (the .html
  file make_pack.js writes next to the PDF) and note it in the run log. Never fall back to plain text.
- Instant (office/instant) sends the first welcome + score within minutes; the Welcome Pack PDF
  follows from the reply desk within the hour and says "your full Welcome Pack".

## Speed (the first impression is the product)
- Instantly: the form sends the buyer a confirmation email (FormSubmit autoresponse). Within the hour of the onboarding form: the baseline score email AND the profile fixes AND the
  review kit (the reply desk builds and sends these in the same run; Day Shift 09 refines later).
- Pro lead page live within 24 hours of onboarding.
- New leads (Pro only): the run they are found.
- Nothing ready sits undelivered more than 2 hours (the reply desk sends every ready item each run; a send that fails is an alert).

## Learn from every client
After each monthly report, one line in skills/echo/SKILL.md "What I've learned" with what the
client replied or did (pasted the fixes in 1 day, asked a question, ignored it) and the change for
next time. A client who doesn't act on a deliverable within 7 days gets a shorter, simpler
version of the one step that matters most.
