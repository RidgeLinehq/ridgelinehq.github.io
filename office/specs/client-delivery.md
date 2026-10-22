# Client delivery: what happens after someone pays

Grayson's standing order (Oct 22, 2026): when a business pays through the website, the office
must carry them through the whole service with as little of Grayson's time as possible. This
is the checklist the crew works from. Every item is either done by the crew, or is one tap for
Grayson, or is one tap for the client; nothing else exists.

## The money path (already live)
1. The site's pricing card → the Stripe payment link ($147/month recurring, founding rate).
   Stripe account activated Oct 22, 2026 ("You can now accept payments"). Payouts go to the
   bank Grayson connected in Stripe.
2. Stripe emails ridgelinemarketinghq@gmail.com on every payment. The reply desk task (every
   2 hours) drafts the welcome email; Sage (06) creates clients/<id> from the same Stripe email
   and sets the lead to Client. If the payer's email matches no lead, Sage creates the lead
   from the Stripe email with source "stripe".

## Day 0 (the welcome, drafted by the reply desk; Grayson taps send)
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
| Review request kit | Echo | the text message (under 300 chars, their name, the review link), the QR card (the page renders it from the review link; Grayson screenshots or AirDrops it), a 3-line "how to ask" script for the crew |
| Listing consistency | Scout | name/address/phone as it should read everywhere; a list of the directories to fix (Yelp, Facebook, BBB, Angi, Nextdoor) with what is wrong on each |
| Yelp claim | Grayson or client | one-tap instructions; status on the checklist |
| Apply the build-out | Grayson (Google Business app, 10 minutes) until the client's profile is connected to the office | checklist item ticked on the page |

## Every week (crew)
- Monday: one Google post draft (under 1,500 chars, one photo ask, a plain CTA) + reply drafts
  for any new reviews (3 lines, specific, thank by first name, no templates). Grayson posts
  from the Google Business app, or the client does. Status ticked on the client card.

## Day 30, 60, 90 (crew + Grayson)
- Report: reviews at start vs now (Grayson types the count), the two AI screenshots (Grayson,
  2 minutes), the work done list, next month's plan. Echo drafts it; the reply desk or Grayson
  sends it. At day 60 Sage checks the guarantee (15 genuine reviews or month 3 free) and writes
  the result on the client; Grayson applies the credit in Stripe if owed.

## Cancel or pause
- A reply with "cancel" → Sage sets client status cancelled, suppression for marketing only
  (not for service emails), and a NEEDS YOU: "Cancel <business> in Stripe (Customers → cancel
  subscription)". The crew never touches Stripe.

## Honesty
No work is marked done unless the tick on the page or the thread id proves it. The report says
what was done and what the numbers are; it never promises rankings.
