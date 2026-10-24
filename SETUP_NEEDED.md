# SETUP NEEDED (phone only, in order of importance)

Everything else runs by itself. These are the only taps that need you. Each one works from
Safari/Chrome on your phone. If a GitHub page looks cramped, tap **aA → Request Desktop Website**
(iPhone) or **⋮ → Desktop site** (Android).

---

## 1. Turn on the website forms (2 minutes, do this FIRST, before calls)
The free-check form and the signup form send to your Gmail through FormSubmit. It needs one
"yes" from you the first time.
1. On your phone open **ridgelinehq.github.io**, scroll to **Get my free AI check**.
2. Fill it in with test info: business **TEST ignore**, any town, email ridgelinemarketinghq@gmail.com and tap **Send my free AI check**.
3. Open the **Ridgeline Gmail**. Find the email from **FormSubmit** ("Activate Form" / "Confirm your email").
4. Tap **Activate Form**. Done. Every form after this lands in the inbox and the crew answers it.

Until you do this, the form shows visitors a "Send by email" button instead, so nobody is lost.

## 2. Turn on Stripe checkout for the 3 plans (5 minutes)
The crew makes the Starter / Growth / Pro checkout links (monthly + yearly), the guarantee
coupon, and puts the links on the site by itself. It only needs your Stripe key, once.
1. Open **dashboard.stripe.com** and log in. Make sure the **Test mode** switch is OFF.
2. Tap **Developers → API keys**. Next to **Secret key** tap **Reveal**, then copy it (starts with `sk_live_`).
3. Open **github.com/RidgeLinehq/ridgelinehq.github.io/settings/secrets/actions** and log in.
4. Tap **New repository secret**. Name: `STRIPE_SECRET_KEY`. Secret: paste the key. Tap **Add secret**.
5. Done. Within an hour the "Start Starter / Growth / Pro" buttons open real Stripe checkout.
   Want it now? Open **github.com/RidgeLinehq/ridgelinehq.github.io/actions/workflows/stripe.yml**
   → **Run workflow** → **Run workflow**.

The key is stored encrypted in GitHub; the crew never sees or prints it. Until this is done,
the plan buttons show "Email me my checkout link" and the crew replies to those emails.

## 2b. INSTANT SERVER: free, answers forms in 1 to 3 minutes (about 10 minutes, once)
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

## 3. Retire the old $147 link (1 minute, after step 2)
1. Stripe → **Payment Links**. Tap the old **$147** link → **⋯ → Deactivate**.
   (The site and the crew no longer use it. Deactivating stops old emails from selling the old plan.)

## 4. Make sure Stripe emails you each payment (1 minute; probably already on)
1. Stripe → tap your profile (top right) → **Profile** → **Communication preferences** (or **Notifications**).
2. Turn ON **Successful payments** (email) for ridgelinemarketinghq@gmail.com.
   This is how the crew sees a new client within 2 hours.

## 5. Get alert emails from GitHub instantly (2 minutes, optional but recommended)
When an automation fails, GitHub opens an "ALERT" issue and emails the account owner at once
(the crew also emails the Ridgeline Gmail within 2 hours). To get GitHub's instant email in the
Ridgeline Gmail:
1. Open **github.com/settings/emails** → add `ridgelinemarketinghq@gmail.com` → open the
   verification email in Gmail → tap the link.
2. Open **github.com/settings/notifications** → **Default notifications email** → pick
   `ridgelinemarketinghq@gmail.com`. Make sure **Actions → Email** and **Watching → Email** are on.

## 6. Reddit leads for the Lead Finder (10 minutes, optional, only if you want Reddit as a source)
The Lead Finder already uses: web search for public posts, your clients' Google profile messages
(when they add us as Manager), and Pro lead-page forms. Reddit is one more source and needs a
free Reddit app:
1. Log into Reddit in your browser. Open **reddit.com/prefs/apps** (use Desktop site).
2. Tap **create another app**. Name: `ridgeline-lead-finder`. Pick **script**. Redirect uri:
   `http://localhost:8080`. Tap **create app**.
3. Copy the short code under the app name (that's the **client id**) and the **secret**.
4. In GitHub → **settings/secrets/actions** (same page as step 2) add two secrets:
   `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET`.
5. Note: Reddit's Data API terms say commercial use may need Reddit's approval. Read
   **redditinc.com/policies/data-api-terms**; if Reddit asks you to register, use their form.
   The Lead Finder only reads public posts and never posts or messages anyone.

## 7. Keep the AI check paid up (only when an alert says so)
The ChatGPT side costs about 1 to 3 cents per check from your OpenAI credit.
- If you get "OpenAI credit ran out": **platform.openai.com → Settings → Billing → Add to credit balance**.
- Gemini is on the free key; nothing to do unless an alert says the key stopped.

---

### What the crew does by itself (no taps)
Free AI checks, signup emails + onboarding, baseline AI score, founding counter, weekly AI
re-checks, Google profile fixes and change tracking, review requests to real customers, lead
finding + lead log, monthly "did it turn into a job?" emails and reports, flat-client fixes,
day-28 guarantee check + Stripe credit + client email, cancellations, and alert emails to you
when anything breaks.

### Change the founding counter yourself
Open **github.com/RidgeLinehq/ridgelinehq.github.io/edit/main/data/founding.json**, change the
number after `"spotsLeft":`, tap **Commit changes**. The site shows it within a minute.
