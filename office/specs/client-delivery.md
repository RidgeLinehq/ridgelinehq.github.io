# Client delivery: what happens after someone pays

Grayson's standing order (Oct 22, 2026): when a business pays through the website, the office
must carry them through the whole service with as little of Grayson's time as possible. This
is the checklist the crew works from. Every item is either done by the crew, or is one tap for
Grayson, or is one tap for the client; nothing else exists.

## The money path (already live)
1. The site's pricing card → the Stripe payment link ($147/month recurring, founding rate).
   Stripe account activated Oct 22, 2026 ("You can now accept payments"). Payouts go to the
   bank Grayson connected in Stripe.
2. Stripe emails ridgelinemarketinghq@gmail.com on every payment. The reply desk (every 2
   hours, every day; stages/reply-desk/CONTEXT.md) SENDS the welcome email and creates
   clients/<id> in the same run; Sage (06) only reconciles. If the payer's email matches no
   lead, the desk creates the lead from the Stripe email with source "stripe". Stripe's
   after-payment page redirects to https://ridgelinehq.github.io/welcome.html (same two steps).

## Day 0 (the welcome, sent by the reply desk; nobody taps anything)
- Thank them, confirm $147/month founding rate, month to month, cancel by replying.
- One ask: add ridgelinemarketinghq@gmail.com as a Manager on their Google Business Profile
  (Google Maps app → their profile → menu → Business profile settings → Managers → Add → enter
  the email → Manager). Never a password.
- Ask for their Google review link (Maps → their profile → "Get more reviews" → copy link) or
  the crew finds it from the public listing where possible.

## Week 1 (crew, stage 09-clients, every Day Shift until done)
| Item | Who | Output |
|---|---|---|
| Profile audit | Scout + Quinn | audit {categories, services, description, hours, photos, areas, gaps} from public info; stored on the client |
| Google Business Profile build-out plan | Parker | exact text for categories, services list, 750-char description, hours, service areas, 10 photo asks ("truck in front of a finished roof", "crew on a ladder", "before/after") |
| Review request kit | Echo | the text message (under 300 chars, their name, the review link), the QR card (the "Ridgeline review cards" Action builds cards/<slug>.png from office/cards/jobs/<clientId>.json; public URL https://ridgelinehq.github.io/cards/<slug>.png), a 3-line "how to ask" script for the crew |
| Listing consistency | Scout | name/address/phone as it should read everywhere; a list of the directories to fix (Yelp, Facebook, BBB, Angi, Nextdoor) with what is wrong on each |
| Yelp claim | Grayson or client | one-tap instructions; status on the checklist |
| Apply the build-out | the client, from the plan email (exact text to paste, about 10 minutes); automatic once the Make "Google Business Profile" lane exists. Grayson is NEVER the one who applies it (his standing order, Oct 22, 2026) | checklist item ticked on the page |

## How the work reaches the client (added Oct 22, 2026)
Stage 09 writes each item as a drafts doc with status "ready" and clientId. The reply desk's
Lane D emails every ready item to the client within 2 hours, in their thread, with the exact
next step, and ticks the work item. Nothing waits for Grayson. He is told "📬 delivered <item>
to <business>" and can read every email in the Ridgeline Gmail.

## Every week (crew)
- Monday: one Google post draft (under 1,500 chars, one photo ask, a plain CTA) + reply drafts
  for any new reviews (3 lines, specific, thank by first name, no templates). The reply desk
  emails them to the client the same day (Lane D); the client pastes them in (automatic once the
  Make Google Business Profile lane exists; never Grayson). Status ticked on the client card.

## Day 30, 60, 90 (crew + Grayson)
- Report: reviews at start vs now (the client's count from their own reply, or Grayson types
  it), the ChatGPT and Gemini answers (gateway, automatic), the work done list, next month's
  plan. Echo drafts it; the reply desk sends it (Lane D). At day 60 Sage checks the guarantee (15 genuine reviews or month 3 free) and writes
  the result on the client; Grayson applies the credit in Stripe if owed.

## Cancel or pause
- A reply with "cancel" → Sage sets client status cancelled, suppression for marketing only
  (not for service emails), and a NEEDS YOU: "Cancel <business> in Stripe (Customers → cancel
  subscription)". The crew never touches Stripe.

## Honesty
No work is marked done unless the tick on the page or the thread id proves it. The report says
what was done and what the numbers are; it never promises rankings.
