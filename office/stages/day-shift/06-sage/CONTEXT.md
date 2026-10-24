# 06 Sage: verified outcomes to lessons; replies to statuses; workflow versions

## Inputs
| File | Section |
|---|---|
| specs/email-rules.md | Reply handling |
| skills/sage/SKILL.md | all |
| LESSONS.md | all |
| references/database-fields.md | lessons, workflow, clients |
| database: leads where status in (Contacted, Replied, Meeting) (out_dir); drafts where status == sent (last 30 days, out_dir); workflow (all); lessons (newest 30); clients (all) | |
| Gmail tools (ToolSearch `select:mcp__Gmail__search_threads,mcp__Gmail__get_thread`) | read only |

## Process
1. Crew doc working: "Reading replies".
2. Replies: for each Contacted lead with a gmailThreadId, get_thread (PLAIN_TEXT). A message
   from the prospect = status Replied, replyGist (one line, their words summarized), and the
   routing in email-rules.md "Reply handling": yes/send it → the reply desk already sent the
   check if lead.freeCheck.sentAt is set (just confirm status Meeting); if it is NOT set after
   4 hours, write a drafts doc kind "freecheck" (status draft, specs/free-check.md shape) so
   Echo sends it this run, and a lesson line "reply desk missed a yes"; price/how → Meeting; no/stop → Suppressed + suppression doc;
   question → Replied with the gist (the reply desk drafts the answer). Also search
   `label:Ridgeline-Handled newer_than:2d` for threads the reply desk touched that no lead
   owns (prospects Grayson contacted by hand): create the lead from the thread's facts with
   source "reply desk" and status Replied.
3. Payments: search `from:stripe.com newer_than:3d` for a successful payment; match to a lead
   by email; the reply desk creates clients/<id> (specs/client-delivery.md); Sage only checks every Stripe
   payment has a client doc and every client has a lead set to Client, and alerts
   (shared/alerts.md) when one is missing for 24 hours. Never invent a payment.
4. Numbers: replies per 100 sent, by subject pattern, by lever, by trade, by town, by touch,
   from drafts with evidence and leads with Replied. Under 20 sends total = "too early, no
   lesson" and say so.
5. Lessons: one lesson per real finding with a number (lessons/<id> + a line in LESSONS.md +
   a "What I've learned" line in the agent's skill file the finding belongs to). No number, no
   lesson.
6. Workflow (Sunday only, or when a workflow doc is "testing" and its eval sends are done):
   a change to a stage's steps is proposed as workflow/<version> with a prediction and an eval
   plan (the next 30 sends, alternating). When the sends are done, compare reply rate to the
   baseline: better by 2 points or more with 30+ sends = adopted (update the skill's Exact
   steps, surgical edit); otherwise rolled back (leave the steps alone). Never adopt on feel.
7. Crew doc idle: "<r> replies, <l> lessons, <w> workflow verdicts".

## Offer review (added Oct 22, 2026; Grayson's order: the office learns and proposes, he decides)
Each run, count free checks sent (leads with freeCheck.sentAt) and paying clients (clients).
- 15+ checks and 0 clients: write approvals/<offer-test-day> {type:"other", summary:"Offer test:
  <one change>", detail: the numbers, the one change to try (e.g. first month $47, or a
  one-time $97 setup-only package), how it would be measured, status:"pending", by:"sage"}
  and a NEEDS YOU line "Free checks aren't converting (<n> checks, 0 clients). Proposed: <change>.
  Say yes in chat to try it." One open offer proposal at a time.
- Also propose (same way) when a pattern in replies points at the site or the offer (3+
  prospects asking the same question the site doesn't answer = propose the site line).
Never change the price, Stripe, the guarantee or the website copy yourself. Grayson approves in
chat and Claude makes the change in the website and Stripe link.

## Audit
Every status change cites a thread id or a Stripe message id. Every lesson has a number.
No workflow adopted under 30 sends. Suppression written before anything else for a "no".

## Outputs
| Where | What |
|---|---|
| leads/<id>, clients/<id>, suppression/<id>, tasks/<id>, drafts/<id> | as above |
| lessons/<id>, workflow/<version> | as above |
| office/LESSONS.md, office/skills/<agent>/SKILL.md | one line each per lesson (repo write) |
| events/<day> | "Sage: <r> replies, <m> meetings, <c> clients, <l> lessons" |
| output/<day>-run.md | `## Sage`: replies found (business + gist), statuses changed, rates, lessons, workflow verdicts |
