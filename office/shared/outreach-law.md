# Email and call law, and deliverability

Canonical home. Plain words, written for a crew that sends email in the United States to small
businesses. Not legal advice; these are the rules the office follows so the business stays
clean and the Gmail account stays alive.

## Cold email to businesses (CAN-SPAM, the federal email law)
Business-to-business cold email is legal in the US when every message:
1. Uses a true From name and address (Ridgeline Local, ridgelinemarketinghq@gmail.com) and a
   true Reply-To. Never a spoofed or borrowed address.
2. Has an honest subject line that matches the body. No "RE:" to fake a thread, no "Your
   invoice", no "Urgent".
3. Includes a real postal mailing address for Ridgeline Local (settings.mailingAddress). A PO
   Box or a UPS Store box is fine. EMPTY ADDRESS = NO EMAIL GOES OUT. Echo writes a NEEDS YOU
   line instead ("Add a mailing address in Settings").
4. Tells the reader how to opt out, in plain words, and the opt-out costs them nothing: the
   footer line in settings.optOutLine (default: "If you'd rather not hear from me, reply
   'no thanks' and I'll stop."). A reply of no / stop / unsubscribe / remove = suppression
   within the same run, forever, for that address and that business.
5. Is identified for what it is: a one-person business offering a service. The body makes that
   obvious; no disguising it as a notification, a review, a customer inquiry or a bill.
6. Opt-outs are honored within 10 business days by law; the office honors them the same run.

## Texting and calling (TCPA and state mini-TCPA laws)
- The crew NEVER texts anyone. Cold texts to cell phones without written consent are illegal
  (TCPA) and carry $500 to $1,500 per text. Oklahoma and Florida have their own stricter laws.
- The crew NEVER places calls, never uses an autodialer, never leaves recorded voicemails.
- Grayson may call businesses by hand (manual dialing to a business's published number is
  allowed), 8 AM to 8 PM their time, and must honor "don't call again" at once: the office
  records it as suppression with reason "asked on call".
- The call list the office builds uses only the business's own published phone number (its
  website or its public profile), with the source URL.

## Where leads come from (and where they don't)
- Allowed: the business's own website, its public Google Business listing as shown in web
  search results, its public Yelp or Facebook page, public directories, public news. Read
  pages with WebFetch like a person would; record the source URL and the time.
- Not allowed: bulk scraping Google Maps or any site against its terms, logging into anything,
  buying lists, guessing emails (no "info@" or "owner@" guesses: if no email is published, the
  lead has no email and goes to the call list or the website-contact-form list instead).
- Personal data stays minimal: business name, trade, town, website, public phone, public
  business email, public profile numbers. Never a home address, never a personal cell marked
  as personal, never anything from a private profile.

## Deliverability (how the Gmail account stays out of spam)
- Plain text. No images, no attachments, no tracking pixels, no HTML templates.
- One link at most (the site). No link shorteners.
- Personal, specific, short. Spam filters and owners both read the first line.
- Volume ramp: 10 a day for the first week, 15 the second, 20 after (shared/rules.md caps).
  Spread sends over the window, not all at once (the sending step pauses a few seconds between
  sends).
- Weekdays only, 7:00 to 9:30 AM Central.
- Replies matter: a Gmail that gets replies is trusted. Follow-ups go in the same thread
  (reply to the first message) so the thread shows real conversation.
- Bounces: a bounce (mailer-daemon reply) marks the address bad; the lead goes to the call
  list; never re-send to a bounced address.
- Complaint signs: any "stop", "spam", "how did you get this" reply = suppression and a lesson.
- If Gmail refuses to send (quota, "unusual activity"): stop sending for the day, note it in
  the run doc, tell Grayson in one line. Never work around a refusal.
