# Reply desk (existing scheduled task "Ridgeline · reply desk", every 2 hours 7 AM to 11 PM Central)

Its instructions live in its own task prompt (created Oct 22, 2026, before the office). It
reads the Ridgeline Gmail, drafts replies to prospects (drafts only; Grayson sends), labels
handled threads "Ridgeline-Handled", drafts the welcome email on a Stripe payment, and messages
Grayson in 2 lines when something is new. It does not know about this workspace yet.

## How the office works with it (until it is folded into the Day Shift)
- Sage (06) reads the "Ridgeline-Handled" label and the lead's own thread each morning and
  turns what the reply desk found into lead statuses, clients, suppression and tasks.
- The reply desk's answers are the voice of the business in replies; Echo's emails are the
  first touches. Both use specs/offer.md facts. If they disagree (a price, the guarantee), the
  website wins and Grayson is told.
- Proposed (needs Grayson's go, see stages/day-shift/references/task-prompt.md, "Later"):
  move the reply desk into this workspace as `stages/reply-desk/` with Echo's skill file and
  the sales-psychology levers, so replies are written with the same training as first emails.
  Until then, nothing here changes that task.
