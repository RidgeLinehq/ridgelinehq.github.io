# 09 Clients: deliver for every paying client (runs only when clients exist)

## Inputs
| File | Section |
|---|---|
| specs/client-delivery.md | all |
| specs/offer.md | Included, What a client gets each month |
| skills/echo/SKILL.md, skills/parker/SKILL.md | all |
| database: clients where status == active (out_dir); each client's lead doc; drafts where kind in (post, reply, report, kit) for that client (newest 10) | |
| Gmail tools (search_threads, get_thread; read only) for the client's thread and new review notifications if the client forwards them | |

## Process (per active client, in order; skip what the client card shows as done)
1. Crew doc working: "Client work: <business>".
2. Week 1 items not yet done: write each output from client-delivery.md as a drafts doc
   (kind "kit" for the review request kit, "plan" for the build-out plan and listing fixes)
   with status "ready", linked by clientId, and tick work[] on the client with status "drafted".
   The QR card needs client.reviewLink: if empty, a NEEDS YOU "Paste <business>'s Google review
   link on the client card" and skip the kit this run.
3. Weekly (Mondays): one Google post draft (kind "post") and reply drafts for reviews the client
   forwarded or that appear in the thread (kind "reply"), status "ready".
4. Reports (day 30/60/90, from startedAt): one drafts doc kind "report" with reviews at start vs
   now (client.reviewsNow; if null, NEEDS YOU "Type <business>'s current review count"), work
   done, next month's plan; at day 60 the guarantee check written on the client (guarantee:
   {checkedAt, gained, met:bool}).
5. Crew doc idle: "<n> clients: <items drafted>".

## Audit
Every drafted item names the client and uses only facts from the client, the lead or the
client's own thread. No invented review counts. No Stripe actions, ever.

## Outputs
| Where | What |
|---|---|
| drafts/<id> (kinds kit, plan, post, reply, report) | status ready, clientId set |
| clients/<id> | work[], guarantee, reportDue, updatedAt |
| events/<day> | "Clients: <n> active, <m> items drafted" |
| output/<day>-run.md | `## Clients`: per client one line: items drafted, next due, needs you |
