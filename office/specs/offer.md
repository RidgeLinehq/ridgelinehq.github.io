# The offer (facts the crew may use, nothing else)

Grayson's standing orders (v3, Oct 24, 2026). The website (index.html, guarantee.html) and this
file must agree; if they differ, tell Grayson (NEEDS YOU) and use the website's wording until he
decides.

## What Ridgeline Local does (the promise, word for word)
"We get your business found on Google AND recommended by AI like ChatGPT and Gemini, and we send
you leads." For ANY local business, anywhere: restaurants, salons, barbers, gyms, dentists,
contractors, cleaners, auto shops, and more. Never describe it as a roofing or tree-service
product.

## The plans (index.html "Pricing")
| Plan | Price | What's in it |
|---|---|---|
| Free AI Check | $0, always, no card | What ChatGPT and Gemini answer for their kind of business in their town (exact words, from the gateway), them vs the competitors named, the 3 fixes we'd make first. The main call to action everywhere. |
| Starter | $75/month | Google Business Profile cleanup + optimization (we audit and write every fix ready to paste, then check it went live); monthly AI visibility report (weekly re-checks behind it); review request system (we email the client's real customers a review request; ready text + QR card for the owner to send). |
| Growth (MOST POPULAR) | $125/month | Everything in Starter + AI Lead Finder (leads sent to them, specs/lead-tracking.md) + lead tracking (every lead logged; monthly "did it turn into a job?") + the Second Month Free Guarantee. |
| Pro | $199/month | Everything in Growth + priority lead alerts (lead page form leads go to the owner instantly; Lead Finder leads emailed the same run they are found) + a simple lead-capture page (p/<slug>/) with a tracking link + a short promo video every month + competitor tracking (the businesses ChatGPT and Gemini name instead of them, week by week). |

Deals:
- Founding Client Deal: the first 20 clients lock their price for life (as long as they stay
  subscribed). The live count is `data/founding.json` spotsLeft (Grayson can edit it; the reply
  desk lowers it by 1 per new paying client). Say "N founding spots left" only with that number.
  Never invent a deadline.
- Pay yearly, get 2 months free: Starter $750/yr, Growth $1,250/yr, Pro $1,990/yr.
- The Free AI Check is always free with no card required.
- Month to month. Cancel anytime by replying "cancel" to any email.

## Links (send these, nothing else)
- Pricing and checkout: https://ridgelinehq.github.io/#pricing (each plan button goes to
  start.html, which opens the right Stripe checkout from data/stripe-links.json).
- Direct checkout link for one plan: read `data/stripe-links.json` → links.<plan>.<monthly|yearly>.
  If it is empty, checkout is not live yet: send https://ridgelinehq.github.io/start.html?plan=<plan>
  and say we'll email the secure link as soon as it's ready (and alert Grayson, shared/alerts.md).
- Guarantee terms: https://ridgelinehq.github.io/guarantee.html
- Onboarding form (sent in the welcome): https://ridgelinehq.github.io/welcome.html?plan=<plan>
- RETIRED, never send again: the $147 link https://buy.stripe.com/dRm00jgNddCI53cbOlaEE00 and the
  "$147 then $197", "setup fee waived" and "15 reviews in 60 days" wording. (Anyone who already
  paid $147 keeps what they bought: the old review-growth guarantee, noted at the foot of
  guarantee.html.)

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
