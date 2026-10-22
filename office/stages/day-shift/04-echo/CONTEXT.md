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
| database: leads with an angle set this run (Parker's list); suppression (all, out_dir); drafts where status in (approved, ready); stats/<day>; settings/main | |
| Gmail tools (ToolSearch `select:mcp__Gmail__create_draft,mcp__Gmail__send_message,mcp__Gmail__search_threads,mcp__Gmail__delete_draft`) | only in this stage |

## Process
A. Already-approved drafts first. For each drafts doc with status "approved": run the sending
   gates in email-rules.md in order. Pass = send (plain text), record evidence on the draft
   (status sent) and the lead (touches, status Contacted or touch n, nextTouchAt), delete its
   Gmail draft if gmailDraftId is set, bump stats/<day>.sent, events line. Fail = leave it
   approved with error noted (cap, window, suppression) unless the error is permanent
   (suppressed, bounced): then status rejected with the reason.
B. "Ready" drafts Grayson sent himself from Gmail: for each drafts doc with status ready, search
   Gmail `in:sent to:<contactEmail> newer_than:7d`; a hit = record it as sent with that
   message id (evidence), update the lead the same way.
C. New drafts. For each lead with a fresh angle (up to today's remaining cap, plus follow-ups
   due): write subject + body per the shape in email-rules.md, using the angle and the lead's
   verified facts. Run the QA gate; record qa {score, levers, flags}. Under 80 = rewrite once.
   Passing drafts:
   - autoSend true and all sending gates pass: send as in A (status sent).
   - otherwise: create a Gmail draft (create_draft: to, subject, body with footer) and write
     drafts/<id> status "ready" with gmailDraftId and gmailDraftUrl. If the Gmail draft call
     fails, status ready without the ids (the page shows Copy).
   dryRun true: write drafts with status "draft" and qa only; create no Gmail draft, send nothing.
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
| drafts/<id> | created/updated with status, qa, evidence |
| leads/<id> | touches, status, nextTouchAt, gmailThreadId |
| suppression/<id> | new entries |
| stats/<day> | sent, ready, drafts counts |
| events/<day> | "Echo: <r> ready, <s> sent (cap <c>), <d> drafts" |
| output/<day>-run.md | `## Echo`: per draft one line: business, touch, qa score, status, gmail id or blocker |
