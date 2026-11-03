# Insurance agents playbook

Read by the crew when client.industry = "insurance-agents". Covers life and health agents, independent
and captive: term and whole life, final expense, individual and family health, ACA Marketplace,
supplemental, and Medicare where the agent is licensed for it. The customer is a person or family in
[Town] who asks Google "life insurance agent near me" or "health insurance help [Town]", and asks ChatGPT
"who can help me compare health insurance in [Town]". Site promise for this industry, word for word:
"Get people in your area requesting life and health insurance quotes, sent right to your phone."
Never a number of leads, never rankings, never "#1", never a guaranteed rate or approval.

## 1. Google Business Profile setup
**Primary category:** Insurance agency. **Add as additional** (each one only if it shows when you type it):
Life insurance agency, Health insurance agency, Insurance broker. Add "Medicare" or "Senior" style
categories only if the agent is licensed and appointed for Medicare plans and only if the category shows.

**Services** (Edit profile > Services; keep only what they actually sell, one line each):
1. Term life insurance quotes: 10, 20 or 30 years of coverage, compared across carriers.
2. Whole life insurance: lifetime coverage with a fixed premium, explained in plain words.
3. Final expense insurance: smaller policies meant to cover a funeral and last bills; many have no exam.
4. Individual and family health insurance: plans for people without coverage through work.
5. ACA Marketplace enrollment help: we check what you qualify for and enroll you, at no charge to you.
6. Supplemental insurance: accident, critical illness and hospital plans that pay you cash. [delete if not sold]
7. Dental and vision plans: standalone plans for individuals and families. [delete if not sold]
8. Medicare plan help: Advantage, Supplement and Part D comparisons during enrollment periods. [delete if not licensed]
9. Life insurance policy review: a free look at what you have and whether it still fits.
10. Small business group health: plans for owners with a few employees. [delete if not sold]
11. Short-term health insurance: gap coverage between jobs, where the state allows it. [delete if not sold]

**Description** (Edit profile > Business information > Description, 750 characters max; this template is
under the limit with the placeholders filled by typical names; the crew counts it before it ships):
> [Business] is an independent insurance agency in [Town], [State]. We help families and individuals
> compare life and health insurance from several carriers and pick a plan that fits the budget: term life,
> whole life and final expense insurance, individual and family health plans, ACA Marketplace enrollment,
> supplemental coverage such as accident and critical illness plans, and dental and vision. [Owner] is a
> licensed agent who explains the options in plain words. Quotes are free with no obligation, and most take
> one short call. We serve [Town], [Nearby Town 1], [Nearby Town 2] and [Nearby Town 3] by phone, video or
> in person at our [Street] office. Call [Phone] or request a quote online.

Captive agent? Replace "independent insurance agency" with "[Carrier] agency" and "from several carriers"
with "from [Carrier]". Delete any town they do not serve. If they sell Medicare plans, add one sentence:
"We also help with Medicare plan comparisons; we are not connected with the federal Medicare program."

**Hours:** set the real office hours. If the agent takes evening quote calls, Google "More hours" offers
set hour types only; use one (for example an online service hours type) only if it shows when you tap
Add, otherwise put "Evening calls by appointment" in the description and a Q&A. During Open Enrollment
(Nov 1 to Jan 15 on HealthCare.gov; state marketplaces vary) set Special hours for any extended days.
Mark holidays closed in Special hours so Google does not show "might be closed".

**Q&A** (post the question from the owner's account, then answer it from the same account):
1. Q: Is there a charge for a quote? A: No. Quotes and enrollment help are free. Agents are paid by the
   carrier, so you pay the same premium whether you use an agent or not.
2. Q: Can I get a quote over the phone? A: Yes. Most life and health quotes take one 10 to 15 minute
   call. Call [Phone] or send a request at [quote page link] and we call you back.
3. Q: How much does life insurance cost? A: It depends on your age, your health and how much coverage you
   want. A quote is an estimate; the final rate is set by the carrier after you apply.
4. Q: Can I get health insurance outside of Open Enrollment? A: Often, yes. A move, a marriage, a new baby
   or losing coverage from a job can open a special enrollment window. Call and we check for you.
5. Q: Do I need a medical exam for life insurance? A: It depends on the policy and the carrier. Many
   term and final expense policies have no exam. We tell you before you apply.

**Photo ideas** (their own photos, no client paperwork or screens in frame):
1. The office front with the sign and the door, taken on a sunny day.
2. [Owner] at the desk, facing the camera, with the agency name on the wall or a name plate.
3. A plain headshot of [Owner] against a wall, phone-quality is fine.
4. The [State] license certificate framed on the wall (the number is public).
5. The waiting area or the two chairs across from the desk.
6. A whiteboard with "Term vs whole life" drawn in three lines.
7. The team, standing in front of the sign, first names in the caption.
8. [Owner] on a call with a headset, the quote page open on the monitor (no client data).
9. A table sign that reads "Open Enrollment: Nov 1 to Jan 15" during that window.
10. The agency booth or sponsorship banner at a [Town] event, with the event named in the caption.

**Attributes to tick** (only if true and only if the attribute shows): Online appointments, Onsite
services, Language assistance: Spanish (or the real language), Wheelchair accessible entrance and
parking, Veteran-owned, Women-owned, Appointment required if they do not take walk-ins.

## 2. Quote-request page config
office/landing/[slug].json for make_landing.py. No health question of any kind on this form.
```json
{"slug": "[business-town]", "industry": "insurance-agents", "business": "[Business]", "town": "[Town]", "state": "[ST]",
 "phone": "[Phone]", "leadEmail": "[owner email]", "leadCc": ["[cell number]@[carrier email-to-text domain]"], "hours": "Mon-Fri 9-5",
 "about": "Licensed life and health insurance agent in [Town]. Free quotes, no obligation, one short call.",
 "cta": "Request a free quote",
 "services": ["Term life insurance", "Final expense insurance", "Individual and family health plans",
              "ACA Marketplace enrollment", "Supplemental coverage", "Medicare plans [delete if not licensed]"],
 "whenOptions": ["As soon as possible", "This week", "Within a month", "Just comparing options"],
 "extraQuestion": {"label": "What are you looking for?",
                   "options": ["Life insurance quote", "Health insurance quote", "Both", "Not sure yet, just have questions"]},
 "reviewLine": "4.9 stars on Google from [N] reviews",
 "consentLine": "By sending this form you ask {business} to contact you by phone, text or email about your request. No purchase is required. Quotes are estimates; final rates depend on the carrier. Your details go only to {business} and are never sold or shared."}
```
reviewLine: only a true, current number read from their Google profile; leave the key out until it is
checked. consentLine: the tool fills {business} itself. leadEmail and leadCc come from onboarding
(lead_alerts "text and email" = the carrier email-to-text address) and the playbook never changes them.
"[Name] is a licensed agent in [State], license #[number]": add it to "about" when the state requires
the number on advertising (most do for health; check the client's onboarding answer).

**Follow-up tip (goes in every lead alert):** call within 5 minutes during business hours; a quote lead
cools fast. No answer: one text and one email the same day ("It's [Owner] from [Business], you asked for
a quote, call me at [Phone] when you're free"), one more call the next morning, then stop unless they
reply. The lead asked to be contacted on the form, so the owner may text; the crew never does.

**Call-back script (owner's voice):** "Hi [First name], this is [Owner] with [Business] here in [Town];
you just sent us a request about [life / health] insurance. I can usually get you two or three options
in about ten minutes if you have time now, or we can set a time that suits you better. Is now good?"

## 3. Review growth
**When to ask:** the day the policy is issued or the enrollment is confirmed (the "in force" or
"enrollment complete" moment), never at application and never during underwriting. Also after a free
policy review the client thanked them for. Never while a claim is pending with the carrier.

**Review request email** (under 90 words, one link, sent by the reply desk to addresses the owner gave us):
> Subject: How did we do, [First name]?
>
> Hi [First name],
>
> Thanks for trusting [Business] with your coverage. If [Owner] made it easy and answered your
> questions, would you take 30 seconds to say so on Google? It helps other families in [Town] find an
> agent they can trust.
>
> [review link]
>
> Honest reviews only; no need to mention your policy details.
>
> [Owner], [Business]
> Reply 'stop' and we won't email you again.

**Staff script (1 line):** "If I made this easy today, a quick Google review helps more families in
[Town] find us; the link is on this card."

**QR card placement:** the desk where clients sign, the back of the business card, inside the policy
folder or envelope, the email signature, and the front window at eye level.

**Reply to a 5-star review:** "Thank you, [First name]. Glad the options made sense and we could wrap it
up in one call. If anything changes, like a new baby or a new job, call us and we'll review your coverage
together. [Owner], [Business]"

**Reply to a 3-star review:** "Thank you for the honest feedback, [First name]. We want every quote to be
clear and quick, and I'd like to hear more about your experience. Please call me directly at [Phone] and
I'll go over it with you personally. [Owner], [Business]"
Never mention policy details, health, premiums or claims in a public reply, and never ask for a changed rating.

## 4. Lead sources that fit (Pro Lead Finder)
Search phrases (town + kind of agent, never the client's name; swap [Town] for nearby towns on week 3+):
1. "[Town] life insurance agent recommendation"
2. "anyone know a good health insurance agent in [Town]"
3. "need help with marketplace insurance [Town]"
4. "best place to get term life insurance near [Town]"
5. "final expense insurance for my parents [Town]"
6. "losing my job insurance what do I do [State]"
7. "self employed health insurance [Town]"
8. "Medicare agent [Town] recommendation" [only if licensed]

**A real lead:** a person asking for an agent, a quote or enrollment help for themselves or family, in or
near [Town], posted in the last 14 days, with a public way to reply on the post. **Noise (counted false):**
other agents or recruiters ("join my agency"), carrier complaints, claim disputes, national "is whole
life worth it" debates, product sellers, duplicates within 30 days, anything older than 14 days. The lead
summary says "asking about health coverage options", never the condition or medication a poster named.
The crew never messages the poster; the owner replies on the post with his name and the quote page.

## 5. Monthly Google post ideas
1. Jan: "New year, free policy review"; photo: [Owner] at the desk with a wall calendar; CTA: Call [Phone].
2. Feb: "New baby? Term life in one call"; photo: the two chairs across the desk; CTA: Request a quote.
3. Mar: "Marketplace plan? Watch for your 1095-A at tax time"; photo: the office front; CTA: Questions? Call.
4. Apr: "What final expense insurance covers, in plain words"; photo: the whiteboard sketch; CTA: Call for a quote.
5. May: "Turning 26 and leaving a parent's plan? You have options"; photo: [Owner] headshot; CTA: Send a request.
6. Jun: "Getting married? That opens a special enrollment window"; photo: the team at the sign; CTA: Call.
7. Jul: "Income changed mid-year? Your Marketplace plan may need an update"; photo: the quote page on a phone; CTA: Request a check.
8. Aug: "Self-employed in [Town]? Health plans without an employer"; photo: [Owner] at a [Town] coffee shop; CTA: Call.
9. Sep: "September is Life Insurance Awareness Month"; photo: the license on the wall; CTA: Free quote.
10. Oct: "Medicare Annual Enrollment runs Oct 15 to Dec 7" [only if licensed, with the disclaimer]; photo: the table sign; CTA: Call.
11. Nov: "Open Enrollment is open: Nov 1 to Jan 15 on HealthCare.gov" (state dates vary); photo: the sign; CTA: Book a call.
12. Dec: "Enroll by Dec 15 for Jan 1 coverage on HealthCare.gov"; photo: the office with holiday lights; CTA: Call today.

## 6. Compliance notes
- No guarantees about coverage, approval, or rates, anywhere: "quotes are estimates, final rates depend
  on the carrier" is on the quote page, in the Q&A and in every post that mentions price.
- Licensing line where the state requires it: "[Name] is a licensed agent in [State], license #[number]."
  On the quote page "about", in the email signature, and in any post that names a product.
- No health questions on the form: no conditions, medications, diagnoses, tobacco, height or weight.
  Those happen in the call, so the form and our lead log stay HIPAA-safe. Lead summaries and review
  requests never repeat a health detail even if the person typed one in the message box.
- Medicare: "Medicare" never appears in the business name, the categories or the page title, and nothing
  implies the agent is Medicare, the government or CMS. If they sell Medicare Advantage or Part D plans,
  posts and the page carry the standard disclaimer: "We do not offer every plan available in your area.
  Currently we represent [N] organizations which offer [M] products in your area. Please contact
  Medicare.gov, 1-800-MEDICARE, or your local State Health Insurance Program to get information on all of
  your options." Fill N and M from the owner; never guess them.
- Consent for calls and texts is the lead's own form submission (the consentLine above). The owner
  contacts only people who submitted the form; the crew never texts or messages anyone.
- Leads are never resold, shared or pooled with another agent. One lead, one client.
- Reviews cannot be bought, traded, discounted or gated. No "leave a review and get a gift card".
- Captive agents: the carrier's advertising rules apply on top; the crew uses the carrier name only the
  way the owner's agreement allows, and never the carrier logo on our pages.

## 7. The 3 fixes we'd make first
1. Primary category "Insurance agency" plus the description that names [Town], the nearby towns and
   "life insurance" and "health insurance" in plain words. AI tools and Google quote these words.
2. The quote-request page set as the website or appointment link on the profile, with the consent line,
   the "estimates" line and the phone as the big button, so a lead reaches the owner's phone in minutes.
3. Review requests to the last 10 clients whose policies were issued (the owner sends us their emails).
   Most agents have many happy clients and fewer than 10 Google reviews; this is the fastest real gain.

## 8. What a good first month looks like
- Week 1: profile fixes applied as Manager (or pasted) and seen live: category, description, services,
  5 Q&A and the first photos. The quote page is live, opened on a phone, and its link is on the profile.
- Week 1 to 2: the review request email went to the first batch of real clients; the QR card is on the
  desk; the first new review appeared and the drafted reply was posted.
- Week 2 to 4: lead alerts arrive by email and text with the follow-up tip, and the owner calls them back
  (status moves from sent to contacted in the lead log); Pro: Lead Finder posts logged, real vs noise marked.
- Every week: the ChatGPT and Gemini check ran and the trend has a dated point; one Google post drafted
  (or posted as Manager); every profile change logged in profileLog.
- Day 30: the check-in and report went out with the real numbers, zeros included, and next month's 3 steps.
