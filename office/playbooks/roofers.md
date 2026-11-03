# Roofers playbook

Read by the crew when client.industry = "roofers". The customer is a homeowner with a leak, storm damage or a roof past its life, who types "roofer near me" or "roof repair [Town]" into Google and asks ChatGPT "who is a good roofer in [Town] for a repair?" They want someone to come look, tell them the truth and put the price in writing.

Site promise (lead page header): "Homeowners asking for a roof inspection or a repair quote, with their address and when they need it."

Rules that never bend here: no "free roof", no promise to waive or cover a deductible, never a number of leads or a ranking promised, reviews only from real customers, every lead opted in (they filled the form or asked in public). Hedge any Google category you have not seen: "if it shows when you type it".

## 1. Google Business Profile setup

**Primary category:** Roofing contractor.

**Secondary (pick 2-4, only for work they actually sell):** Gutter cleaning service (if they clean gutters); Siding contractor; Skylight contractor (if it shows when you type it); Insulation contractor (attic insulation jobs). Never add a category for a service they do not do.

**Services (Edit profile → Services; paste one line each):**

| Service | One-line description |
|---|---|
| Roof repair | Leaks, missing shingles, flashing and pipe-boot repairs, fixed in one visit when we can. |
| Roof replacement | Full tear-off and new asphalt shingle or metal roof with a written warranty. |
| Storm damage inspection | We check for hail and wind damage, photograph it and write it up for you. |
| Emergency tarping | Temporary cover to stop water coming in until the repair is scheduled. |
| Gutter repair and replacement | Reseal, rehang or replace gutters and downspouts so water runs off the roof. |
| Roof inspection | A walk of the roof and attic with photos and a plain written summary. |
| Flashing and chimney repair | Resealing and replacing flashing around chimneys, vents and skylights. |
| Roof maintenance | Yearly check, debris removal and small fixes before they become leaks. |
| Metal roofing | Standing-seam and metal panel roofs for homes and outbuildings. [delete if not] |
| Skylight repair | Reseal or replace leaking skylights. [delete if not] |
| Attic ventilation | Ridge vents and intake vents to cut heat and moisture in the attic. [delete if not] |
| Gutter guards | Guards fitted to existing gutters to keep leaves out. [delete if not] |

**Description (Edit profile → Business information → Description; 750 characters max, fill the brackets and trim):**

> [Business] is a [licensed and insured in [State], license #[number] / insured] residential roofing company in [Town], [State], serving [Nearby Town 1], [Nearby Town 2] and [Nearby Town 3]. We repair leaks, replace worn shingle and metal roofs, inspect storm and hail damage, and repair or replace gutters. Every job starts with a roof inspection and a written estimate, so you know what needs fixing now and what can wait. If you have an insurance claim, we can meet your adjuster and document the damage. [Business] has roofed homes in [Town] since [year], with the same crew on every job. Call [phone] or request an inspection online and we will call you back [the same day].

**Hours:** the real office hours (for example Mon-Fri 7:00-6:00, Sat 8:00-2:00). If they answer leak calls after hours, do not mark evenings Closed: set those days to "Open 24 hours" only if a person actually answers; otherwise keep the real hours and put "24-hour emergency tarping, call [phone]" in the description and in Q&A #4. Google "More hours" takes time slots only, so emergency text goes in the description, not there.

**Q&A (post from the owner's account, then answer):**
1. Q: Do you charge for a roof inspection? A: No. We inspect the roof and attic, take photos and give you a written estimate. You decide what to do next.
2. Q: Do you work with insurance claims? A: Yes. We document the damage, can meet your adjuster on site and do the work the claim approves. Your deductible is between you and your insurer; we do not change it.
3. Q: How long does a roof replacement take? A: Most homes in [Town] take one to two days, weather permitting. We confirm the date in writing and clean up every day.
4. Q: Can you stop a leak today? A: Usually. Call [phone] and we will tarp or patch it first, then schedule the full repair.
5. Q: What roof materials do you install? A: Asphalt shingle and metal [and flat roofing, delete if not], with the manufacturer's material warranty and our own workmanship warranty in writing.

**10 photo ideas:** (1) the crew on a [Town] roof mid-tear-off, (2) a finished roof from the street with the house visible, (3) before-and-after of a repaired valley or flashing, (4) hail damage close-up with a chalk circle, (5) the lettered truck parked at a job, (6) the owner holding the shingle sample board, (7) a tarped roof the day of a storm, (8) new gutters and downspouts from the ground, (9) the attic view of a new ridge vent, (10) the magnet roller sweep of the lawn at clean-up.

**Attributes to tick (only the ones that show and are true):** Online estimates; Onsite services; owner identity attributes (veteran-owned, women-owned) if true. Service area: [Town] plus the nearby towns they drive to, not the whole state.

## 2. Quote-request page config

office/landing/[slug].json for make_landing.py:

```json
{
  "slug": "[slug]",
  "business": "[Business]",
  "town": "[Town]",
  "state": "[ST]",
  "phone": "[phone]",
  "leadEmail": "[owner email]",
  "hours": "Mon-Fri 7-6, Sat 8-2",
  "about": "Roof repairs, replacements and storm inspections in [Town] and nearby. Written estimates, [licensed and insured in [ST] / insured].",
  "cta": "Request a free roof inspection",
  "services": ["Roof repair", "Roof replacement", "Storm damage inspection", "Gutter repair", "Something else"],
  "whenOptions": ["As soon as possible", "This week", "This month", "Just getting prices"],
  "extraQuestion": {"label": "Is this an insurance claim?", "options": ["Not sure", "Yes, I have a claim", "No"]},
  "reviewLine": "Rated [4.8] on Google by [62] [Town] homeowners.",
  "consentLine": "By sending this you are asking [Business] to contact you about your roof by phone, text or email. Nobody else gets your details."
}
```

reviewLine uses only the real rating and count from their Google profile (or the copy site, labeled); leave it out if unknown.

**Follow-up tip (goes in every lead alert):** Call within 15 minutes while the roof is on their mind. No answer: leave a 15-second voicemail with your name and "I can come look at it [tomorrow morning]", then text the same line from your own phone. If they ticked "Yes, I have a claim", ask for the claim number on the call, not at the door.

**Call-back script (owner's voice, 3 sentences):** "Hi [Name], this is [Owner] with [Business], you just sent us a request about [a leak] at [Street]. I can be there [tomorrow at 9] to walk the roof and hand you a written estimate before I leave, does that time work? If water is coming in right now, tell me which room and I will bring a tarp."

## 3. Review growth

**When to ask:** repairs, the same day after the final walkthrough; replacements, the next morning after they have seen the roof in daylight; insurance jobs, after the final payment clears, not while the claim is open. One ask per customer, never a second inside 180 days.

**Review request email (under 90 words, sent by the reply desk on behalf of [Business], one link):**

> Subject: How did [Business] do on your roof?
>
> Hi [First name],
>
> Thanks for trusting [Business] with your [roof repair] on [Street] last week. If the crew did right by you, would you take a minute to leave a Google review? It helps other [Town] homeowners find a roofer they can trust.
>
> [review link]
>
> Thank you,
> [Owner], [Business]
>
> Reply 'stop' and we won't email you again.

**Crew script (truck or door, one line):** "If the roof looks right to you, a quick Google review helps us a lot; the link is on your invoice and on the card on your door."

**Where the QR card goes:** printed on the invoice next to the total; a laminated card in the truck's rear window; the door hanger left at the finished house ("Your new roof, your review", with the QR and the warranty summary).

**Reply to a 5-star review:** "Thank you, [First name]. Glad the [valley repair on [Street]] is holding tight through the rain. Call us any time the roof needs a look."

**Reply to a 3-star review:** "Thank you for the honest feedback, [First name]. We want every [Town] roof we touch to be right, so please call me directly at [phone] and we will go over [the schedule / the clean-up] together."

## 4. Lead sources that fit (Pro Lead Finder)

Search phrases (town + kind of business, never the client's name; one WebSearch each, newest first; Reddit through the official API when set up):
1. "[Town] roofer recommendation"
2. "anyone know a good roofer [Town]"
3. "roof leaking who should I call [County]"
4. "hail damage roof [Town] who did you use"
5. "roof replacement quote [Town] reddit"
6. "gutter repair recommendation [Town]"
7. "roofer for insurance claim [Town]"
8. "small roof repair [Town] recommendation"

**Real lead (counted: true):** a homeowner or landlord, in or within 25 miles of [Town], asking for a roofer or a quote, posted within 14 days, answerable in public on the post itself. The alert quotes their words and suggests a public reply with the business name and the lead page link; the owner replies, the crew never does.

**Noise (counted: false, reason in notes):** other roofers advertising or answering; "roofers to avoid" threads with no ask; "hiring roofers" and job seekers; DIY and material questions ("can I shingle over"); commercial roofing bids; out-of-area posts; anything older than 14 days; storm-chaser canvassing posts and anyone offering to "cover your deductible".

## 5. Monthly Google post ideas

Every post is about a real job, a real season or a real offer the owner gave us; under 1,500 characters, one call to action, no stock photos.

| Month | Post (one line) | Photo | Call to action |
|---|---|---|---|
| Jan | Ice dams: what the icicle line on your gutter means and when to call. | Ice dam on a [Town] eave | Request an inspection |
| Feb | Attic check season: ventilation and insulation before the spring rain. | Ridge vent from inside the attic | Book a roof check |
| Mar | Spring inspection: what winter did to shingles, flashing and gutters. | Crew on a ladder at a gutter | Request a free inspection |
| Apr | After the first storm: how to spot hail damage from the ground, and what not to sign at the door. | Chalk-circled hail hits | Call [phone] |
| May | A finished replacement on [street, with the homeowner's OK]: the materials and how long it took. | Street view of the new roof | Get a written estimate |
| Jun | Heat and your roof: why a dark, unvented attic raises the power bill. | Thermometer in a hot attic | Ask about ventilation |
| Jul | Summer storm season: what happens when you call us with a leak. | Tarped roof after a storm | Save our number |
| Aug | Gutter guards before the leaves come down. | Guards being fitted | Request a gutter quote |
| Sep | Fall maintenance: the 20-minute check that stops winter leaks. | Owner clearing a valley | Book maintenance |
| Oct | Before and after: a flashing repair that ended a years-old chimney leak. | Chimney flashing, before and after | Request a repair quote |
| Nov | Thank-you to [Town]: the year's work and the crew behind it. | Crew at the truck | Leave a review |
| Dec | Winter-ready: what to do if you see a ceiling stain after snow. | Ceiling stain close-up | Call [phone] |

## 6. Compliance notes

- **License and insurance:** where [State] licenses roofers, write "licensed and insured in [State], license #[number]" on the page, in the description and on the invoice; where it does not, write "insured" and nothing more. Never write "licensed" without a number we have seen.
- **Storm work:** never "free roof", "no cost to you" or any promise to waive, absorb, rebate or "help with" a deductible (illegal in many states). Insurance-claim language stays factual: "we can meet your adjuster", "we document the damage", "we do the work the claim approves". Never "we'll get your claim approved".
- **No door-to-door claims on the page or in posts:** no "we're in your neighborhood after the storm", no "your neighbor had damage, you probably do too".
- **Written estimates:** every price in writing before work starts; the page and the description say "written estimate", never a price before an inspection.
- **Warranty wording:** name exactly what they offer ("[10]-year workmanship warranty, manufacturer's [25]-year shingle warranty"); never "lifetime" unless their written warranty says lifetime and defines it.
- **Reviews:** real customers only, one link for everyone, no gift cards, no "5 stars please". A request goes only for a job that is finished and paid.
- **Leads:** the crew sends the lead to the owner; it never replies to the post, never texts a stranger, never looks a person up.

## 7. The 3 fixes we'd make first

1. **Primary category and services.** A roofer listed as "Contractor" or "Construction company" with an empty services list is invisible for "roofer near me". Set "Roofing contractor" and paste the services table. 5 minutes.
2. **The description and the two storm Q&As.** A blank description gives ChatGPT and Gemini nothing to say about them. Paste the 750-character description, then post Q&A #2 and #4 so the questions homeowners ask most are answered on the listing. 5 minutes.
3. **Ten photos of real jobs with the town in them, then the review ask.** Ten photos from last month's jobs, uploaded from the owner's phone and captioned with the neighborhood; the same week, the owner sends us the emails of the last ten finished jobs and the review requests go out. 10 minutes plus one reply.

## 8. What a good first month looks like

- **Week 1:** Manager access granted; categories, services, description, hours (with the emergency branch) and Q&A live; first ten photos up; the lead page live with the owner's phone as the big button and opened once to check it.
- **Week 2:** the owner sends the last ten finished jobs' emails; review requests go out at the rules' pace; the QR card is on the invoice template and in the truck; the first Google post is up.
- **Week 3:** first review replies drafted and posted; the weekly visibility check records what ChatGPT and Gemini said word for word; Pro: the first lead alerts with the follow-up tip, and the owner has called one back the same day.
- **Week 4:** the monthly check-in asks which leads became jobs; the report shows the real counts, zeros included, the AI answers quoted, and next month's three bullets.
- **Signals we want (not numbers):** the owner pasted the fixes within a week; new reviews name the town and the job ("hail", "leak", "[Street]"); the profile check finds the new description on the copy sites; leads get a call back inside the hour; nobody has asked us to send a review request to a friend.
