# Alerts: nothing fails silently

Canonical home. Grayson's standing order (Oct 24, 2026): "If anything breaks, stops, errors, or
needs me, email ridgelinemarketinghq@gmail.com IMMEDIATELY with what broke and what to tap to fix
it." He has no computer: every fix line is something he can do from a phone browser or the
Claude app.

## Who sends what
| Breaks | Who notices | How fast |
|---|---|---|
| A GitHub Action (AI check, Stripe, lead finder, review cards) | the "Ridgeline alerts" Action opens a GitHub issue (GitHub emails the account owner) and writes office/alerts/<run id>.json | at once |
| office/alerts/*.json with emailed:false | the reply desk (every run, first thing after the gates) emails it, then sets emailed:true and commits | within 2 hours |
| Anything inside a crew run (gateway failed 3 times, a Stripe job ok:false, Gmail error, a send failed, a client with no onboarding after 72 h, checkout links empty while someone wants to pay, a website promise we can't deliver) | the crew member who hit it, in the same run | at once |
| A scheduled task that failed, stopped, or never ran; the reply desk silent 3+ hours | the Emergency Watch (every 4 hours) | within 4 hours |

## The email (Gmail send_message, to ridgelinemarketinghq@gmail.com)
```
Subject: 🚨 Ridgeline: <what broke, under 8 words>

What broke: <one plain line, with the time>
What it affects: <one line: e.g. "free checks are not going out", "Joe's Barber's guarantee credit wasn't applied">
Tap to fix: <one exact step, phone-friendly, with the link>
(or) Nothing to tap: <what the crew is doing about it and when it retries>
```
At most 6 lines. No jargon. No secrets or keys ever in an email.

## Dedupe (never spam him)
Database collection `alerts`, doc `<key>` = {key, what, firstAt, lastAt, count, emailedAt,
resolvedAt}. Key = short slug of the problem + day key (e.g. `gateway-failed-2026-10-24`,
`stripe-job-g-c-joes-barber-2026-11-21`). Same key the same day = no second email (count +1).
When the thing works again, set resolvedAt and send one line: "✅ Fixed: <what>" (subject
"✅ Ridgeline fixed: <what>").

## Also tell him in the app
Every alert email is also one SendUserMessage line (and PushNotification when the run has it), so
it reaches the phone app as well as the inbox.

## Common fixes (copy the matching line)
- Stripe key missing/invalid: "GitHub (github.com/RidgeLinehq/ridgelinehq.github.io) → Settings → Secrets and variables → Actions → STRIPE_SECRET_KEY → paste your Stripe secret key (Stripe app or dashboard.stripe.com → Developers → API keys)."
- OpenAI credit out: "platform.openai.com → Settings → Billing → Add credit."
- Gemini key: "aistudio.google.com → Get API key → copy → GitHub secret GEMINI_API_KEY."
- Gmail disconnected: "Claude app → Settings → Connectors → Gmail → Reconnect."
- FormSubmit not activated: "Open the Ridgeline Gmail, find the email from FormSubmit, tap Activate Form."
- Reddit keys: "GitHub → Settings → Secrets → Actions → REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET."
- A failed Action: "Open <link> → tap the red step to see why, or open the Claude app and say: fix <name>."
