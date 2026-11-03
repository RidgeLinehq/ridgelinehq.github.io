# Playbooks

One file per industry. The crew reads office/playbooks/<client.industry>.md before the profile fixes,
the quote-page config and the review kit, and follows it: the categories, the services, the description
template, the Q&A, the photo list, the make_landing.py keys, the review request wording and the
compliance notes are written there so no two workers invent them twice. An industry marked "other" has
no playbook: use the general rules in specs/ (quality.md, client-delivery.md, lead-tracking.md). A
playbook never overrides a spec; where they differ, the spec wins and the playbook gets fixed.

| File | Industry | One-line promise |
|---|---|---|
| insurance-agents.md | Life and health insurance agents (independent and captive) | Get people in your area requesting life and health insurance quotes, sent right to your phone. |
| roofers.md | Roofing companies (repairs, replacements, storm work) | Get homeowners in your area requesting roof inspections and estimates, sent right to your phone. |
| home-services.md | Plumbers, HVAC, electricians, cleaners, landscapers and other home trades | Get homeowners in your area requesting service calls and quotes, sent right to your phone. |
| salons.md | Hair salons, barbershops, nail salons, lash and brow studios, med spas | Get people in your area booking and asking about your services, sent right to your phone. |

## What worked (monthly review)
On the first run of each month, Sage reads every client's numbers (leads by source, reviews gained,
AI trend, client.fixesTried, what the owner replied) and writes dated lines here, one per idea tried:
`- 2026-12-01: <what we tried> → <evidence: numbers, how many clients> → adopted for everyone / dropped`.
The Clients worker (Day Shift 09) applies every "adopted" line to every active account that month,
logged in client.fixesTried with from:"playbooks/README.md <date>", and the matching playbook is
updated to say so. Nothing goes in this section without evidence: a line with no numbers is not
written. Evidence is numbers (replies per 100, leads by source, clients count), never a client's name
or contact; this file is public. Dropped ideas stay here so they are not tried twice.

