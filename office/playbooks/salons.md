# Salons playbook

Read by the crew when client.industry = "salons". Covers hair salons, barbershops, nail salons, lash and
brow studios, and med spas (lightly; see section 6). The customer is someone in [Town] who asks Google
"best hair salon near me", "barber open now", "nail salon [Town] walk in", and asks ChatGPT "where should
I get balayage in [Town]" or "a barber in [Town] who does a good fade". They choose on photos, reviews and
whether they can get in soon. Never a number of bookings, never rankings, never "#1".

## 1. Google Business Profile setup
**Primary category** (pick the ONE that matches what makes the most money): Hair salon, Barber shop,
Nail salon, Eyelash salon, or Medical spa. **Add as additional** (each one only if it shows when you type it):
- Hair salon: Beauty salon, Hairdresser, Hair extensions service, Waxing hair removal service.
- Barbershop: Hair salon, Men's hair salon, Beauty salon (only if women's services are offered).
- Nail salon: Beauty salon, Waxing hair removal service, Eyelash salon (if lashes are offered).
- Lash or brow studio: Beauty salon, Eyebrow bar, Permanent make-up clinic (only if offered).
- Med spa: Skin care clinic, Facial spa, Laser hair removal service (only what they are licensed for).

**Services** (Edit profile > Services; keep only what they sell; real prices as "starting at"):
1. Women's haircut and style: consultation, cut, wash and blow-dry. Starting at $[X].
2. Men's haircut: clipper or scissor cut with a clean neckline. Starting at $[X].
3. Kids' haircut: ages 12 and under, patient with first-timers. Starting at $[X].
4. Beard trim and lineup: shape, edge and hot towel finish. Starting at $[X].
5. Hot towel shave: straight-razor shave with hot towels. Starting at $[X].
6. Single-process color: root touch-up or all-over color; patch test offered 48 hours before a first color.
7. Highlights and balayage: hand-painted or foiled lightening, toner included. Starting at $[X].
8. Blowout and styling: wash and style for an event. Starting at $[X].
9. Gel manicure: shaping, cuticle care and gel polish. Starting at $[X].
10. Pedicure: soak, exfoliation, massage and polish. Starting at $[X].
11. Lash extensions: classic, hybrid or volume; a patch test is offered for first-time clients.
12. Brow shaping and tint: wax or thread, with optional tint. Starting at $[X].

**Description** (Edit profile > Business information > Description, 750 characters max; the crew counts
it before it ships; swap the service words for the client's real menu):
> [Business] is a [hair salon / barbershop / nail salon / lash studio] on [Street] in [Town], [State].
> We do [women's and men's haircuts, color, highlights and balayage, blowouts, beard trims and kids'
> cuts], with honest "starting at" prices and no surprise add-ons. [Owner] and the team have [N] years
> behind the chair, and first-time color and lash clients can get a patch test before their appointment.
> Walk-ins are welcome when a chair is open, and online booking takes about a minute. We see clients from
> [Town], [Nearby Town 1], [Nearby Town 2] and [Nearby Town 3]. Open [Tue to Sat]. Book online, call
> [Phone], or stop by.

Delete any town they do not draw from, and "Walk-ins are welcome" if they are appointment-only.

**Hours:** the real chair hours, including a Monday "Closed" if that is true (an unset day looks open).
"Last walk-in 30 minutes before close" goes in the description and a Q&A, not in the hours. Mark
holidays in Special hours. If they are appointment-only, tick the "Appointment required" attribute if it
shows, and put the booking link in the Appointment link field.

**Q&A** (post each question from the owner's account, then answer it from the same account):
1. Q: Do you take walk-ins? A: Yes, when a chair is open; the last walk-in is 30 minutes before close.
   Booking online or calling [Phone] holds your spot. [or: We're by appointment; book online.]
2. Q: How do I book? A: Online at [booking link] in about a minute, or call or text [Phone].
3. Q: How much is a haircut? A: Men's cuts start at $[X], women's at $[X], kids' at $[X]. Color and
   highlights are quoted after a quick consultation because length and condition change the price.
4. Q: Do you do kids' haircuts? A: Yes, ages 12 and under start at $[X]. Our quietest time for little
   ones is [weekday mornings].
5. Q: Do I need a patch test before color or lashes? A: We offer one for first-time color and lash
   clients, 48 hours before your appointment. Tell us about any past reactions when you book.

**Photo ideas** (their own photos; no client under 18 without a parent's written consent):
1. The chair setup with the shop sign behind it, lights on, taken from the door.
2. The storefront from the sidewalk, with the hours on the door readable.
3. Each stylist or barber at their station, first name in the caption (with their OK).
4. A finished cut or color from behind, an adult client who said yes.
5. A finished fade or beard lineup, close up, phone-quality is fine.
6. The nail bar or pedicure chairs, clean and lit; or the lash bed with the lamp.
7. The product shelf with the brands they carry.
8. The waiting area with the coffee or water station.
9. The team together in front of the sign.
10. The price board or menu card, readable, so people see "starting at" prices before they call.

**Attributes to tick** (only if true and only if the attribute shows): Appointment required or Accepts
walk-ins, Online appointments (with the booking link), Wheelchair accessible entrance, Restroom, Wi-Fi,
Credit cards and NFC mobile payments, Women-owned, Black-owned, Veteran-owned, LGBTQ+ friendly.

## 2. Quote-request page config
office/landing/[slug].json for make_landing.py. No allergy, skin or medical question on the form; that
conversation happens at booking or in the chair.
```json
{"slug": "[business-town]", "industry": "salons", "business": "[Business]", "town": "[Town]", "state": "[ST]",
 "phone": "[Phone]", "leadEmail": "[owner email]", "leadCc": ["[cell number]@[carrier email-to-text domain]"], "hours": "Tue-Sat 9-6",
 "about": "[Hair salon / barbershop / nail salon] on [Street] in [Town]. Walk-ins when a chair is open, online booking in a minute.",
 "cta": "Book or ask a question",
 "services": ["Women's haircut", "Men's haircut", "Kids' haircut", "Color or highlights", "Beard trim", "Nails", "Lashes or brows"],
 "whenOptions": ["Today or tomorrow", "This week", "Next week or later", "Just asking about prices"],
 "extraQuestion": {"label": "First time with us?", "options": ["Yes", "No, I've been before"]},
 "reviewLine": "4.8 stars on Google from [N] reviews",
 "consentLine": "By sending this form you ask {business} to reply by phone, text or email about your request. Your details go only to {business}."}
```
services: the client's real menu in their words, 10 at most (the tool adds "Something else" itself).
reviewLine: only a true, current number read from their Google profile; leave the key out until it is
checked. consentLine: the tool fills {business} itself. leadEmail and leadCc come from onboarding
(lead_alerts "text and email" = the carrier email-to-text address) and the playbook never changes them.

**Follow-up tip (goes in every lead alert):** reply within 15 minutes during open hours with two time
slots and the price; a "Today or tomorrow" lead is a phone call, not a text, because they are choosing
between three shops right now. "Just asking about prices" gets the starting price and the booking link,
no pressure. The lead asked to be contacted on the form, so the owner may text; the crew never does.

**Call-back script (owner's voice):** "Hi [First name], this is [Owner] at [Business] in [Town]; thanks
for your note about [service]. I have [day] at [time] or [day] at [time] open with [stylist], and a
first visit usually runs about [N] minutes and starts at $[X]. Want me to hold one of those for you?"

## 3. Review growth
**When to ask:** the same day as the appointment, within a couple of hours, while the hair, nails or
lashes still look brand new; for color and lashes never wait until regrowth or fill time. Ask at
checkout with the card, then the email that evening. A client who asked for a redo gets the redo first
and the request after, if they are happy.

**Review request email** (under 90 words, one link, sent by the reply desk to addresses the owner gave us):
> Subject: Loving the new look?
>
> Hi [First name],
>
> Thanks for coming in to [Business] today. If [Stylist] got it just right, would you take 30 seconds
> to say so on Google? A few words about the cut, color or nails help neighbors in [Town] pick a place
> they can trust.
>
> [review link]
>
> Honest reviews only. See you next time.
>
> [Owner], [Business]
> Reply 'stop' and we won't email you again.

**Staff script (1 line):** "If you love it, a quick Google review helps us more than you know; the QR
code is right by the card reader."

**QR card placement:** by the card reader at checkout, a small print at each station mirror, a sticker
on the hand mirror the stylist holds up at the end, the back of the appointment card, the front window.

**Reply to a 5-star review:** "Thank you, [First name]. [Stylist] will be glad to hear the [balayage /
fade] turned out exactly how you pictured it. See you in [6] weeks, and welcome anytime in between for a
bang trim. [Owner], [Business]"

**Reply to a 3-star review:** "Thank you for the honest feedback, [First name]. We want every visit to
feel worth the trip, and I'd like to hear more about yours. Please call me at [Phone] so I can make
your next appointment right. [Owner], [Business]"
Never argue about a price or a result in public, never name what went wrong, never ask for a changed rating.

## 4. Lead sources that fit (Pro Lead Finder)
Search phrases (town + kind of shop, never the client's name; swap [Town] for nearby towns on week 3+):
1. "best barber in [Town]"
2. "who does good balayage in [Town]"
3. "nail salon recommendations [Town]"
4. "lash tech near [Town] recommendations"
5. "walk in haircut [Town] today"
6. "kids haircut [Town] patient with toddlers"
7. "new to [Town] need a hair stylist"
8. "where to get a good fade in [Town]"

**A real lead:** a person asking where to go for a cut, color, nails, lashes or brows for themselves or
their kid, in or near [Town], posted in the last 14 days, with a public way to reply. **Noise (counted
false):** stylists looking for booth rent or jobs, product and course sellers, complaints about another
salon, "how do I fix my own color" DIY questions, duplicates within 30 days, anything older than 14 days.
The crew never messages the poster; the owner replies on the post with the shop name and booking link.

## 5. Monthly Google post ideas
1. Jan: "New year trim and gloss"; photo: the chair with the sign behind it; CTA: Book online.
2. Feb: "Gift cards for Valentine's, any amount"; photo: a gift card on the counter; CTA: Call [Phone].
3. Mar: "Lighter for spring: balayage consultations this month"; photo: a finished balayage from behind; CTA: Book a consult.
4. Apr: "Prom and formal season: book your updo or fade early"; photo: the station with the styling tools; CTA: Book now.
5. May: "Mother's Day: a blowout or pedicure she picks herself"; photo: the pedicure chairs; CTA: Buy a gift card.
6. Jun: "Wedding party? We do trials"; photo: the team in front of the sign; CTA: Call to book the party.
7. Jul: "Pool hair fix: a trim and a treatment"; photo: the product shelf; CTA: Book this week.
8. Aug: "Back-to-school cuts: kids' spots go fast"; photo: the kids' booster seat on the chair; CTA: Book online.
9. Sep: "Meet [Stylist], now taking new clients"; photo: [Stylist] at the station; CTA: Request a time.
10. Oct: "Bold color and Halloween nails"; photo: a set of nail art, close up; CTA: Book by [date].
11. Nov: "Holiday appointments are open"; photo: the booking screen on a phone; CTA: Book before they fill.
12. Dec: "Last appointments before [Dec 24] are [date]"; photo: the shop with the holiday window; CTA: Call [Phone].

## 6. Compliance notes
- No before-and-after photos of anyone under 18 without a parent's written consent; the owner keeps the
  consent, the crew never asks for the photo without it. Adult clients say yes before their photo goes up.
- Honest pricing: "starting at" on every price we publish, and the consultation sets the final price for
  color, extensions and lashes. Never a price the owner has not confirmed.
- Allergies and patch tests: every mention of color, lash adhesive, keratin, relaxers, waxing or peels
  carries "patch test offered for first-time clients" or "tell us about past reactions when you book".
  The form never asks about allergies or skin conditions; that happens at booking or in the chair.
- Med spa (lightly): no promise of a medical result ("erases wrinkles", "permanent", "cures"). Say what
  the service is and who does it ("injectables by [Name], RN, under [Dr. Name]"). Only services they are
  licensed for appear in categories, services and posts. No medical history on the form.
- No review gating: every client gets the same link and the same ask, happy or not. No discount, product,
  entry or free service for a review. Staff never write or post reviews.
- Photos of staff and clients only with their OK; no photos of a client's ID, card or booking screen.

## 7. The 3 fixes we'd make first
1. The right primary category plus the description that names [Town], the nearby towns and the real
   services with "starting at" prices. People and AI tools search by service and town, not by shop name.
2. Photos: 10 real ones (the chair, the storefront, the finished work) replacing the stock images; a shop
   with no recent photos looks closed.
3. The same-day review ask: the QR card by the card reader, the 1-line staff script, and the review
   request email to the last 25 real clients (the owner sends us the emails). Fresh reviews that say the
   service and the town are what Google and ChatGPT quote.

## 8. What a good first month looks like
- Week 1: profile fixes applied as Manager (or pasted) and seen live: category, description with prices,
  services, 5 Q&A, the booking link and the first 10 photos. The booking page is live, opened on a phone,
  and its link is on the profile.
- Week 1 to 2: the QR card is at the register and the stations, staff are saying the line, the first
  review request email went to real clients, the first new review named the stylist and the drafted
  reply was posted.
- Week 2 to 4: lead alerts arrive by email and text with two time slots suggested, and the owner answers
  them inside the open hours (status moves from sent to contacted in the lead log); Pro: Lead Finder posts
  logged, real vs noise marked.
- Every week: the ChatGPT and Gemini check ran and the trend has a dated point; one Google post with a
  real shop photo drafted (or posted as Manager); every profile change logged in profileLog.
- Day 30: the check-in and report went out with the real numbers, zeros included, and next month's 3 steps.
