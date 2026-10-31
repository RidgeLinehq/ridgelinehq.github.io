# 04 Echo: write the emails, pass the QA gate, send only through the gates

## Inputs
| File | Section |
|---|---|
| specs/email-rules.md | all |
| specs/sales-psychology.md | Follow-up cadence, Subject lines, Voice, Objection flips |
| shared/outreach-law.md | all |
| skills/echo/SKILL.md | all |
| LESSONS.md | all |
| references/database-fields.md | drafts, suppression, stats |
| database: leads with an angle set this run (Parker's list); leads with followUp.kind "voicemail_email" (list all leads with out_dir, filter locally: nested where-filters are refused); suppression (all, out_dir); drafts where status in (approved, ready); stats/<day>; settings/main | |
| Gmail tools (ToolSearch `select:mcp__Gmail__create_draft,mcp__Gmail__send_message,mcp__Gmail__search_threads,mcp__Gmail__delete_draft`) | only in this stage |

## Process
A. Already-approved drafts first. For each drafts doc with status "approved": run the sending
   gates in email-rules.md in order. Pass = send (body + htmlBody from `office/tools/cold_email.py
   build`, email-rules.md "The HTML version"), record evidence on the draft
   (status sent) and the lead (touches, status Contacted or touch n, nextTouchAt), delete its
   Gmail draft if gmailDraftId is set, bump stats/<day>.sent, events line. Fail = leave it
   approved with error noted (cap, window, suppression) unless the error is permanent
   (suppressed, bounced): then status rejected with the reason.
B. "Ready" drafts Grayson sent himself from Gmail: for each drafts doc with status ready, search
   Gmail `in:sent to:<contactEmail> newer_than:7d`; a hit = record it as sent with that
   message id (evidence), update the lead the same way.
C. New drafts. A lead that already has a draft with status "draft" from a dry run or a failed
   QA: re-run the QA gate on that draft (refresh the footer from settings) and promote it
   (ready / sent / draft, same rules as below) instead of writing a new one. Then, for each
   lead with a fresh angle (up to today's remaining cap, plus follow-ups
   due): build subject + body + htmlBody with `office/tools/cold_email.py build` per the shape in
   email-rules.md (under 90 words, three paragraphs, the card), using the angle and the lead's
   verified facts; store body, htmlBody and the tool's words/flags on the draft. Run the QA gate; record qa {score, levers, flags}. Under 80 = rewrite once.
   Passing drafts:
   - autoSend true and all sending gates pass: send as in A (status sent).
   - otherwise: create a Gmail draft (create_draft: to, subject, body with footer) and write
     drafts/<id> status "ready" with gmailDraftId and gmailDraftUrl. If the Gmail draft call
     fails, status ready without the ids (the page shows Copy).
   dryRun true: write drafts with status "draft" and qa only; create no Gmail draft, send nothing.
C2. VOICEMAIL FOLLOW-UPS (Grayson, Oct 26, 2026: "after Voicemail, the crew drafts and sends a short
   follow-up email with their free AI check"). Before new drafts: every lead with followUp.kind
   "voicemail_email" and status "pending" (an email is on file; "waiting-email" leads wait for
   Scout's enrichment pass and become pending when it finds one). Write ONE short email (under 90
   words before the footer): subject "Sorry I missed you, <first name or business>"; line 1 "I
   just left you a voicemail about <business>."; line 2 the AI check line from lead.aiCheck
   exactly as gateway.md allows ("When I asked ChatGPT 'Who are the best <plural> in <Town>, <ST>?'
   it named X and Y, not <business>."; aiCheck unknown = say you ran a free check and offer to send
   it, never invent a result); one ask ("Want the full one-page check? Just reply yes."). It is a
   cold touch: QA gate, every sending gate (window, cap, suppression, footer, autoSend or
   approval, dryRun) applies exactly as in A to C. Sent = followUp {status "sent", sentAt,
   gmailMessageId}, lead.touches + {channel:"email", note:"after voicemail"}, status Contacted if it
   was New/Researching/Qualified. Not sendable today (cap, window, weekend) = leave pending. A
   Gmail error or a refusal = followUp {status "failed", error, tries+1} and an ALERT at once
   (shared/alerts.md, key `vm-email-<lead id>-<day>`); tries 3 = stop and say so in the alert.
   These go before new first emails inside the cap: the person already heard Grayson's voice.
D. Suppression: any lead whose replyGist or notes say no/stop/unsubscribe, or whose address
   bounced (search `from:mailer-daemon newer_than:7d`), gets status Suppressed and a
   suppression doc, before anything else is written.
E. Crew doc idle: "<r> ready, <s> sent, <d> drafts".

## Audit
- Mailing address and opt-out line present in every ready/sent body; empty mailingAddress =
  nothing created or sent and a NEEDS YOU line.
- Every "sent" has a gmailMessageId. Sent count today <= dailyEmailCap. No send outside the
  window or on a weekend. No send to a suppressed address or domain.
- No two drafts share a body. Every body names the business and town.

## Outputs
| Where | What |
|---|---|
| drafts/<id> | created/updated with status, qa, evidence (voicemail follow-ups: kind "followup", note "after voicemail") |
| leads/<id> followUp | voicemail follow-ups: sent with gmailMessageId, or failed with error (+ alert) |
| leads/<id> | touches, status, nextTouchAt, gmailThreadId |
| suppression/<id> | new entries |
| stats/<day> | sent, ready, drafts counts |
| events/<day> | "Echo: <r> ready, <s> sent (cap <c>), <d> drafts" |
| output/<day>-run.md | `## Echo`: per draft one line: business, touch, qa score, status, gmail id or blocker |
