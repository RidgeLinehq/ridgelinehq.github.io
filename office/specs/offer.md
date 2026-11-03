# The offer (facts the crew may use, nothing else)

Grayson's standing orders (v4, Nov 3, 2026; replaces v3 of Oct 24). The website (index.html,
guarantee.html) and this file must agree; if they differ, tell Grayson (NEEDS YOU) and use the
website's wording until he decides.

## What Ridgeline Local does (the promise, word for word)
"We get local businesses new customers who asked to hear from them, grow their Google reviews,
and (Growth/Pro) get them recommended by ChatGPT and Google AI." For ANY local business,
anywhere: insurance agents, roofers, home services, salons, restaurants, barbers, gyms, dentists,
contractors, cleaners, auto shops, and more. Never describe it as a roofing or tree-service
product.

## The plans (index.html "Pricing")
| Plan | Price | What's in it |
|---|---|---|
| Free AI Check | $0, always, no card | What ChatGPT and Gemini answer for their kind of business in their town (exact words, from the gateway), them vs the competitors named, the 3 fixes we'd make first. The main call to action everywhere. |
| Starter "Leads + Reviews" | $39.99/month (same Stripe price and link as the old Starter) | LEAD GENERATION: their own quote-request page with tracking links (office/tools/make_landing.py; now for EVERY plan, not a Pro bonus); Google Business Profile optimization done for them as Manager (Grayson applies the crew's fields from the Google Maps app, usually within 2 business days, and we confirm it is live; without access it is written out ready to paste and we check it went live); the lead-capture form. Every lead reaches them by email and, when they asked for it, by text to their own cell (carrier email-to-text address in the form's _cc) within minutes: the person's name, contact, what they want and when, plus a follow-up tip. REVIEW GROWTH: review requests emailed to their real customers after each job/sale, their Google review link + the QR card for the counter, and we draft their replies to reviews. Lead log with the monthly "did it turn into a customer?" question. A private results page (numbers only, updated monthly). Monthly check-in email (wins + the next step). Monthly report (leads, new reviews, star-rating change). The Second Month Free Guarantee. |
| Growth (RECOMMENDED) | $75/month | Everything in Starter + AI search visibility (weekly ChatGPT and Gemini checks, who they name, the AI score on the results page and in the report) + monthly profile updates and Google posts done for them. |
| Pro | $125/month | Everything in Growth + the AI Lead Finder (public posts where people nearby ask for their kind of business, sent to them as they are found; specs/lead-tracking.md) + competitor tracking (who AI names instead of them, week by week). |

Every plan: same-day setup from the onboarding form (the fields are in "After paying"); the
industry playbook in office/playbooks/<industry>.md (insurance-agents, roofers, home-services,
salons, other) sets the first fixes, the review-request wording and the quote page's questions;
the first run of each month reviews what worked across all clients and applies adopted ideas to
every account.

The website sells exactly this and nothing more. Since Nov 3, 2026 the quote-request page and
the lead log are part of every plan and competitor tracking is part of Pro, so they ARE promises
now. Promo videos are still not on the site: if a client gets one it is a bonus, never a promise.

Deals (Grayson, Nov 3, 2026):
- The Free AI Check is always free with no card required.
- No contract. Cancel anytime by replying "cancel" to any email.
- ALL plans (Starter, Growth, Pro): the Second Month Free Guarantee (below). The condition
  changed on Nov 3, 2026: zero new leads AND zero new reviews. The AI score no longer gates it.
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
- The client's quote-request page (every plan): https://ridgelinehq.github.io/p/<slug>/ (built
  by office/tools/make_landing.py on signup day; tracking links are `?src=gbp`, `?src=facebook`,
  `?src=card`, `?src=ridgeline`). Sent to the client in their own thread, used on their Google
  profile, cards and posts. Never send one client's page to anyone else.
- The client's private results page (every plan): https://ridgelinehq.github.io/results.html?c=<token>
  (reads data/results/<token>.json: numbers only, never a name, email, phone or lead detail;
  updated monthly by the first run of the month). The token is the client's own: send it only to
  the client, in their thread, never in outreach, never to another client, never in any public
  file other than the JSON it points to. Never link a results page as a "case study".
- RETIRED, never send again: the $147 link https://buy.stripe.com/dRm00jgNddCI53cbOlaEE00, the
  old $75 / $125 / $199 prices, the yearly prices, the founding deal, and the "$147 then $197",
  "setup fee waived" and "15 reviews in 60 days" wording. Also retired Nov 3, 2026: the old
  guarantee wording ("zero tracked leads AND no improvement in your AI visibility") and
  "Growth and Pro only".

## The guarantee (ALL plans; the only promise the crew may repeat, word for word)
"If your first month brings you zero new leads AND zero new reviews, your second month is free.
No arguing." How it is measured and paid: specs/guarantee.md. Always link the terms, never reword
them. The AI score no longer gates the guarantee (Nov 3, 2026); the baseline AI check still runs
for every client because the monthly report and the results page use it.

## Promises the crew may NOT make
(Never bring these up unprompted: lead with what we do and the guarantee. If a prospect asks
"can you get me #1?", answer with what we do and the guarantee, positively.)
Never rankings, never "#1", never a number of leads, jobs, customers or reviews ("10 leads a
month" and "20 reviews" are out; "every person who asks reaches you within minutes" is in),
never "guaranteed" anything (guaranteed leads, sales, rankings or results): the only guarantee is
the one above, word for word. Never "we post for you on Google" to a client WITHOUT Manager
access (then we write it, the owner pastes it; with Manager access we do apply changes and posts
ourselves, Oct 28, 2026). Texting (Nov 3, 2026): the crew never texts strangers and never texts
the client's customers (we email them; the owner can text the ready message). The ONLY text the
crew sends is a lead alert to the client's own cell from the onboarding form (lead_cell +
lead_carrier, when lead_alerts is "text and email"); never any other number. Reviews, word for
word: "We only collect genuine reviews from your real customers." Never bought, written,
incentivized or asked of anyone who was not a customer. Leads, word for word: "Every lead is
someone who asked to hear from you." A client's leads are never sold, never shared with anyone
else and never contacted by us: the client is the only one who hears from them. If the work
can't deliver a line on the website, NEEDS YOU: "Website promises <x>, we can't deliver it yet"
so Grayson can change the wording; the crew does not quietly under-deliver.

## After paying (specs/client-delivery.md is the whole flow)
Stripe checkout → welcome.html onboarding form (business name, Google profile link, phone,
services, city, email, manager_access, and since Nov 3, 2026: lead_cell, lead_carrier,
lead_alerts (text and email | email only), industry (insurance-agents | roofers | home-services |
salons | other), service_area, hours, review_link, customers, notes) → the reply desk's welcome
email + baseline AI check + reviewsAtStart (specs/guarantee.md §1) → work begins THE SAME DAY:
the quote-request page is built (make_landing.py) and its link sent; the lead-capture form is
wired to their email and, when lead_alerts is "text and email", to their carrier email-to-text
address in _cc (email always, text only when asked); the Google Business Profile optimization is
applied as Manager or sent ready to paste; the review link + QR card go out and the first review
requests go to the customers they listed; the results page token is created
(data/results/<token>.json) and the industry playbook is opened. The form asks them to add
ridgelinemarketinghq@gmail.com as a Manager on their Google Business Profile (manager_access:
invited | later | no-access; Oct 28, 2026, Grayson: "we do this for them"). With it we do the
Google work for them: Grayson applies the crew's fields as Manager from the Google Maps app (the
page's "Apply on Google" task), usually within 2 business days, and we receive Google's
message/call notices (tracked leads). Without it, every change is written out ready to paste.
Never a password.

## Targets for cold outreach (settings.targets is the live list)
Any local business type. The Day Shift rotates one town per run and the trades listed for it in
settings.targets (Oct 24, 2026 default: Owasso OK: barber, dentist, auto repair, house cleaning;
Cabot AR: salon, gym, restaurant, plumber; Foley AL: med spa, pet grooming, HVAC, landscaping).
Anyone who asks (website form, email, Grayson's own leads) gets the same check and offer. The crew
never names Grayson's town in outreach.
