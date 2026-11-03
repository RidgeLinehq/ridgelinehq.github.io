# SETUP NEEDED (phone only, in order of importance)

## New on Nov 3, 2026 (nothing to tap)
Starter is now **"Leads + Reviews"** at the same $39.99 price and the same Stripe link, so no
Stripe tap is needed. If you ever want a different Starter price: edit `PLANS` in
`office/stripe/stripe_ops.py` (the hourly "Ridgeline Stripe" Action creates the new price and
link and rewrites `data/stripe-links.json`, which the site reads) and change the price text in
`index.html`. The Second Month Free Guarantee now covers all plans ("zero new leads AND zero new
reviews"). Every client now gets a quote-request page (`ridgelinehq.github.io/p/<slug>/`), lead
texts to their own cell through their carrier's email-to-text address (email always too), a
private results page at `results.html?c=<token>`, and an industry playbook in
`office/playbooks/` (insurance agents, roofers, home services, salons, other).

Everything else runs by itself. These are the only taps that need you. Each one works from
Safari/Chrome on your phone. If a GitHub page looks cramped, tap **aA → Request Desktop Website**
(iPhone) or **⋮ → Desktop site** (Android).

**Already done and live (Oct 27, 2026):** the website forms (FormSubmit is activated and
submissions land in the Ridgeline Gmail), Stripe checkout for Starter $39.99 / Growth $75 /
Pro $125 (`data/stripe-links.json`), the old $147 link is off, and the founding counter and
yearly plans are gone.

---

## 1. INSTANT SERVER: free, answers forms in 1 to 3 minutes (about 10 minutes, once, optional)
Without this, free checks and new-client welcomes go out within the hour (the crew runs hourly).
With it, they go out in 1 to 3 minutes, free, from your Ridgeline Gmail, 24/7. Do it on the phone
in **desktop mode** (Safari: **aA → Request Desktop Website**), logged into the **Ridgeline Gmail**.

You need two keys (they're new copies; the old ones stay where they are):
- OpenAI: **platform.openai.com/api-keys** → **Create new secret key** → name `ridgeline-instant` → copy.
- Gemini: **aistudio.google.com/apikey** → **Create API key** → copy.

1. Open **script.google.com** → **New project**. Tap the title "Untitled project" and name it `Ridgeline Instant`.
2. Open **https://raw.githubusercontent.com/RidgeLinehq/ridgelinehq.github.io/main/office/instant/Code.gs**,
   long-press the text → **Select All** → **Copy**.
3. Back in the script editor: tap into the code box, select all the sample code, and **Paste** over it. Tap the **save** icon (💾).
4. Tap the **gear** icon (Project Settings) on the left → scroll to **Script properties** → **Add script property**:
   - `OPENAI_API_KEY` = your OpenAI key
   - `GEMINI_API_KEY` = your Gemini key
   Tap **Save script properties**.
5. Tap the **< >** icon (Editor). In the function menu at the top pick **setup**, tap **Run**.
6. Google asks for permission: **Review permissions** → pick the Ridgeline Gmail → **Advanced** →
   **Go to Ridgeline Instant (unsafe)** → **Allow**. ("Unsafe" just means you wrote it yourself and
   Google hasn't reviewed it.)
7. Done when you get an email **"✅ Ridgeline Instant is ON"**. From then on it checks every minute.

If anything goes wrong it emails you "🚨 Ridgeline: instant server problem", and the hourly crew
still handles everything, so nothing is lost.

## 1b. TEXT ALERTS: lead texts through Twilio (about 10 minutes, once; recommended)
The site promises each lead by text and email. Email goes out by itself (FormSubmit copies every lead
to the client the moment it arrives, and the Gmail app shows it on their phone in seconds). Texts need
a texting number, because the carriers' free email-to-text addresses are shutting down (AT&T closed
txt.att.net on June 17, 2025; Verizon closes vtext.com on March 31, 2027; T-Mobile's is unreliable).
Ridgeline Instant (section 1) sends the text through Twilio within a minute of a lead landing, once
these three script properties exist:
1. Open **twilio.com** → sign up → upgrade with a card (a trial account can only text numbers you
   verified yourself) → **Phone Numbers → Buy a number** → pick a **toll-free** US number (about
   $2 a month; each text about 1 cent).
2. **Messaging → Regulatory compliance → Toll-free verification**: business Ridgeline Local, the
   website, use case "lead alerts to our own clients, who opt in on their signup form", sample text
   "New lead for Cedar Ridge Roofing: Dana, (501) 555-0188. Roof repair · This week. Call back
   within 5 minutes if you can. - Ridgeline Local". Approval usually takes 1 to 5 business days;
   until then Twilio blocks toll-free texts, so leads ride on email only.
3. Twilio console → **Account Info**: copy **Account SID** and **Auth Token**. In script.google.com →
   Ridgeline Instant → Project Settings → Script properties add `TWILIO_SID`, `TWILIO_TOKEN`,
   `TWILIO_FROM` (the toll-free number as +1XXXXXXXXXX) and `TWILIO_TEST_TO` (your own cell, same
   format). In the editor pick **textTest** → Run.
Done when the test text arrives. The crew's day-0 test on each new client confirms their texts too;
"no text" → the client is told alerts are email-only until this is on.

## 2. Make sure Stripe emails you each payment (1 minute; probably already on)
1. Stripe → tap your profile (top right) → **Profile** → **Communication preferences** (or **Notifications**).
2. Turn ON **Successful payments** (email) for ridgelinemarketinghq@gmail.com.
   This is how the crew sees a new client within 2 hours.

## 3. Get alert emails from GitHub instantly (2 minutes, optional but recommended)
When an automation fails, GitHub opens an "ALERT" issue and emails the account owner at once
(the crew also emails the Ridgeline Gmail within 2 hours). To get GitHub's instant email in the
Ridgeline Gmail:
1. Open **github.com/settings/emails** → add `ridgelinemarketinghq@gmail.com` → open the
   verification email in Gmail → tap the link.
2. Open **github.com/settings/notifications** → **Default notifications email** → pick
   `ridgelinemarketinghq@gmail.com`. Make sure **Actions → Email** and **Watching → Email** are on.

## 4. Reddit leads for the Lead Finder (10 minutes, optional, only if you want Reddit as a source)
The Lead Finder (Pro) already uses: web search for public posts, your clients' Google profile
messages (when they add us as Manager), and Pro lead-page forms. Reddit is one more source and
needs a free Reddit app:
1. Log into Reddit in your browser. Open **reddit.com/prefs/apps** (use Desktop site).
2. Tap **create another app**. Name: `ridgeline-lead-finder`. Pick **script**. Redirect uri:
   `http://localhost:8080`. Tap **create app**.
3. Copy the short code under the app name (that's the **client id**) and the **secret**.
4. In GitHub → **github.com/RidgeLinehq/ridgelinehq.github.io/settings/secrets/actions** add two
   secrets: `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`.
5. Note: Reddit's Data API terms say commercial use may need Reddit's approval. Read
   **redditinc.com/policies/data-api-terms**; if Reddit asks you to register, use their form.
   The Lead Finder only reads public posts and never posts or messages anyone.

## 5. Keep the AI check paid up (only when an alert says so)
The ChatGPT side costs about 1 to 3 cents per check from your OpenAI credit.
- If you get "OpenAI credit ran out": **platform.openai.com → Settings → Billing → Add to credit balance**.
- Gemini is on the free key; nothing to do unless an alert says the key stopped.

---

### Checkout links (for your own texts and emails)
Each plan has one Stripe Payment Link (in `data/stripe-links.json`); every plan's checkout shows
the Second Month Free Guarantee line. To know who sent a client, add `?client_reference_id=NAME`
to the end (letters, digits, dashes and underscores only):
- Starter (Leads + Reviews, $39.99; same link as before Nov 3): https://buy.stripe.com/5kQ8wP0OfdCIdzIf0xaEE07
- Growth ($75, recommended): https://buy.stripe.com/14AbJ168z9msbrAdWtaEE08
- Pro ($125): https://buy.stripe.com/8x200jgNd6ag3Z8aKhaEE09
Or send https://ridgelinehq.github.io/start.html?plan=growth&client_reference_id=NAME and the
site forwards it to the right link.

### What the crew does by itself (no taps)
Free AI checks, signup emails + same-day onboarding, baseline AI score and starting review
count, each client's quote-request page with tracking links, lead alerts to the client by email
and (when they asked) by text to their own cell, Google profile optimization and change tracking,
review requests to real customers + review link and QR card + drafted review replies, weekly AI
re-checks (Growth/Pro), monthly profile updates and Google posts (Growth/Pro), lead finding and
competitor tracking (Pro), the lead log on every plan, monthly "did it turn into a customer?"
emails, results pages and reports, the first-of-the-month review of what worked across clients,
flat-client fixes, day-28 guarantee check + Stripe credit + client email (all plans),
cancellations, and alert emails to you when anything breaks.
