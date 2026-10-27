# The offer (facts the crew may use, nothing else)

Grayson's standing orders (v3, Oct 24, 2026). The website (index.html, guarantee.html) and this
file must agree; if they differ, tell Grayson (NEEDS YOU) and use the website's wording until he
decides.

## What Ridgeline Local does (the promise, word for word)
"We help local businesses get recommended by ChatGPT and Google AI, and make it easy for happy
customers to leave reviews." (Pro adds leads we find and send them.) For ANY local business, anywhere: restaurants, salons, barbers, gyms, dentists,
contractors, cleaners, auto shops, and more. Never describe it as a roofing or tree-service
product.

## The plans (index.html "Pricing")
| Plan | Price | What's in it |
|---|---|---|
| Free AI Check | $0, always, no card | What ChatGPT and Gemini answer for their kind of business in their town (exact words, from the gateway), them vs the competitors named, the 3 fixes we'd make first. The main call to action everywhere. |
| Starter | $39.99/month | AI visibility check (the baseline, specs/guarantee.md §1); Google Business Profile cleanup (we audit and write every fix ready to paste, then check it went live); the 10-second review system (their Google review link + the QR card for the counter + a ready text for the owner to send). |
| Growth (MOST POPULAR) | $75/month | Everything in Starter + monthly profile updates (weekly profile check, Google post drafts, fixes re-sent until live) + review growth (we email the client's real customers review requests) + AI visibility tracking (weekly ChatGPT and Gemini re-checks, monthly report) + the Second Month Free Guarantee. |
| Pro | $125/month | Everything in Growth + the AI Lead Finder (leads emailed to them as they are found, specs/lead-tracking.md) + lead tracking (every lead logged; monthly "did it turn into a job?"). |

The website sells exactly this and nothing more. Lead pages, promo videos and competitor tracking
are not on the site: if a Pro client gets one it is a bonus, never a promise.

Deals (Grayson, Oct 27, 2026):
- The Free AI Check is always free with no card required.
- No contract. Cancel anytime by replying "cancel" to any email.
- Growth and Pro: the Second Month Free Guarantee (below).
- There is NO founding deal, NO spot counter, NO yearly plan and NO limited-time offer. Never say
  "spots left", "limited", "just launched", "beta" or "we're new". Never invent a deadline.
- When a prospect leans Starter, one line, word for word: "Most businesses move to Growth after
  month one."

## Links (send these, nothing else)
- Pricing and checkout: https://ridgelinehq.github.io/#pricing (each plan button opens Stripe
  checkout directly).
- Direct checkout link for one plan: read `data/stripe-links.json` → links.<plan>.monthly. To tag
  who sent the client, add `?client_reference_id=<name>` (letters, digits, - and _ only), or send
  https://ridgelinehq.github.io/start.html?plan=<plan>&client_reference_id=<name> (start.html
  forwards it to Stripe). If the file is ever empty, send start.html?plan=<plan> and alert
  Grayson (shared/alerts.md).
- Guarantee terms: https://ridgelinehq.github.io/guarantee.html
- Onboarding form (sent in the welcome): https://ridgelinehq.github.io/welcome.html?plan=<plan>
- RETIRED, never send again: the $147 link https://buy.stripe.com/dRm00jgNddCI53cbOlaEE00, the
  old $75 / $125 / $199 prices, the yearly prices, the founding deal, and the "$147 then $197",
  "setup fee waived" and "15 reviews in 60 days" wording.

## The guarantee (Growth and Pro; the only promise the crew may repeat, word for word)
"If your first month brings you zero tracked leads AND no improvement in your AI visibility, your
second month is free. No arguing." How it is measured and paid: specs/guarantee.md. Always link
the terms, never reword them.

## Promises the crew may NOT make
(Never bring these up unprompted: lead with what we do and the guarantee. If a prospect asks
"can you get me #1?", answer with what we do and the guarantee, positively.)
Never rankings, never "#1", never a number of leads, jobs or reviews, never "guaranteed results",
never "we post for you on Google" (we write it, the owner pastes it), never "we text your
customers" (we email them; the owner can text the ready message). If the work can't deliver a
line on the website, NEEDS YOU: "Website promises <x>, we can't deliver it yet" so Grayson can
change the wording; the crew does not quietly under-deliver.

## After paying (specs/client-delivery.md is the whole flow)
Stripe checkout → welcome.html onboarding form (business name, Google profile link, phone,
services, city, email) → the reply desk's welcome email + baseline AI check → work begins. Adding
ridgelinemarketinghq@gmail.com as a Manager on their Google Business Profile is optional and
helps (we receive Google's message/call notices = tracked leads). Never a password.

## Targets for cold outreach (settings.targets is the live list)
Any local business type. The Day Shift rotates one town per run and the trades listed for it in
settings.targets (Oct 24, 2026 default: Owasso OK: barber, dentist, auto repair, house cleaning;
Cabot AR: salon, gym, restaurant, plumber; Foley AL: med spa, pet grooming, HVAC, landscaping).
Anyone who asks (website form, email, Grayson's own leads) gets the same check and offer. The crew
never names Grayson's town in outreach.
