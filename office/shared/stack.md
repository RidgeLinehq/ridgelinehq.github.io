# The free tech stack (Grayson, Oct 28, 2026)

Canonical home for which outside tools the Ridgeline Office may use for the site
(https://ridgelinehq.github.io), the free AI Check, client work and Ridgeline's socials. FREE
TIERS ONLY: no plan upgrades, no cards, no trials that turn paid, no pay-as-you-go.

## Rules
- No account exists until Grayson makes it. A crew never signs up for anything. Until a tool's
  key is in the repo's Actions secrets, the crew skips that tool and keeps working.
- Keys and tokens live only in GitHub Actions secrets or Apps Script properties. Never in a
  file, commit, email or message (`rules.md`).
- The office database (`database.md`) stays the system of record. These tools sit beside it.
- A tool that hits its free limit stops for the month; the run notes it and the alert rule
  (`alerts.md`) tells Grayson if a client is affected.
- Limits below are the vendors' free plans as of Oct 2026. Re-check the pricing page before
  relying on a number.

## Approved (free)

| Tool | Job for Ridgeline | Free plan (Oct 2026) | Watch out |
|------|-------------------|----------------------|-----------|
| GitHub | Version control, Actions, GitHub Pages (the live site) | Free; Actions free on public repos | The site stays on GitHub Pages |
| Stripe | Client checkout (already live, `data/stripe-links.json`) | No monthly fee; 2.9% plus 30 cents only when a client pays | The only cost is on money coming in. Never add paid Stripe products (Billing add-ons, Radar for Fraud Teams, Atlas) |
| Supabase | Optional Postgres for AI Check history and client results over time | 2 projects, 500 MB database, 1 GB files | Pauses after 7 days idle; the hourly crew keeps it awake |
| Vercel | Preview deploys only | Hobby plan, free | Hobby is non-commercial: never host the paid site, checkout or client pages there |
| Cloudflare | Pages hosting for Pro lead pages; DNS if a domain is ever bought | Free, commercial use allowed | The free home for anything client-facing beyond GitHub Pages |
| Resend | Transactional email (AI Check results, welcomes) as a backup to Gmail | 3,000 a month, 100 a day, 1 domain | Needs a domain we own. Parked until one exists; Gmail (`outreach-law.md`) keeps sending |
| Clerk | Sign-in, only if a client portal is ever built | Free plan (monthly-user cap on the pricing page) | Nothing needs sign-in today |
| PostHog | Site and form analytics: which page, channel and plan gets the sign-up | 1M events a month | Tag outreach and social links with `utm_source`; no session recordings on pages with forms |
| Sentry | Errors from the instant server, Actions and office scripts | Developer plan, 5,000 errors a month, 1 user | Alerts still go through `alerts.md` |
| Upstash | Redis for dedupe and rate limits (never email the same lead twice, cap sends per hour) | 500K commands a month, 256 MB | The suppression list in the database still wins |
| Pinecone | Vector search over past AI Checks, replies and playbooks (reuse what worked) | Starter plan, free (one project, small index) | Never index anything a client marked private |

## Not on the free list
- Namecheap domain ($12 a year): paid, so not set up. The site stays on ridgelinehq.github.io
  until Grayson says go. Resend and Cloudflare DNS wait for it.

## Setup Grayson does (once, phone, only when he wants the tool)
Sign up with the Ridgeline Gmail on the free plan, skip any card prompt, create one API key,
and add it at github.com/RidgeLinehq/ridgelinehq.github.io/settings/secrets/actions:
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `POSTHOG_PROJECT_KEY`, `SENTRY_DSN`,
`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PINECONE_API_KEY`.
