# Ridgeline Wash Co. team app: one-time setup (about 10 minutes, all on your phone)

The app is already up at **https://ridgelinehq.github.io/team/**, but until you do this it only
shows made-up sample data. These steps give it a real home for your data: a Google Sheet in your
own Google account. You do this once. Your team never sees any of it.

Do it in Safari or Chrome in **desktop mode** (iPhone: **aA → Request Desktop Website**. Android:
**⋮ → Desktop site**), signed in to the **Ridgeline Gmail**.

## 1. Make the project
1. Open **script.google.com** → **New project**.
2. Tap the title "Untitled project", name it `Ridgeline Wash Team`, tap **Rename**.

## 2. Paste the code
1. Open
   **https://raw.githubusercontent.com/RidgeLinehq/ridgelinehq.github.io/main/team/backend/Code.gs**,
   long-press the text → **Select All** → **Copy**.
2. Back in the script editor: tap into the code box, select all the sample code, and **Paste**
   over it.
3. Tap the **save** icon (the little disk).

## 3. Run setup
1. In the function menu at the top pick **setup**, then tap **Run**.
2. Google asks for permission: **Review permissions** → pick the Ridgeline Gmail → **Advanced** →
   **Go to Ridgeline Wash Team (unsafe)** → **Allow**. "Unsafe" only means Google has not reviewed
   a script you made yourself. It asks to manage your Google Sheets and to send email as you.
   That is how the app saves your data and emails you when a job is booked.
3. Done when you get an email **"Ridgeline Wash Co.: your team system is ready"**. It has your
   **sign-in name** and your **PIN**. Keep that email.

No email after a minute? The same text is in the **Execution log** at the bottom of the editor.

## 4. Turn it on
1. Top right: **Deploy** → **New deployment**.
2. Tap the **gear** next to "Select type" → **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. ("Anyone" is what lets your team's
   phones reach it. Nobody gets in without a name and a PIN.)
4. Tap **Deploy**. If it asks for permission again, allow it the same way as before.
5. Copy the **Web app URL**. It ends in `/exec`.

Check it: open that URL in a new tab. You should see one short line starting with `{"ok":true`.

## 5. Connect the app
Send the Web app URL to Claude in this chat and it will be switched on for you.

Or do it yourself: on GitHub open `team/config.js`, tap the pencil, and paste the URL between the
quotes so the line reads `window.RIDGELINE_BACKEND = "https://script.google.com/.../exec";`
then tap **Commit changes**. About a minute later the app stops showing sample data and runs on
the real thing.

## 6. Sign in and add your team
1. Open **https://ridgelinehq.github.io/team/** on your phone. Sign in with the name and PIN from
   the email.
2. Tap your initials (top left) → **Team**, and add each rep and tech. Each new person gets a
   PIN, shown to you once. Give each person their name and PIN.
3. Tap your initials → **Company standards**. A starting draft is already there. Change anything
   that is not how you want it done. Every rep and tech is asked to confirm they have read them,
   and again whenever you change them, and you can see who has.
4. Tell each person to open the same link, sign in, and then **Share → Add to Home Screen**
   (iPhone) or **⋮ → Add to Home screen** (Android). From then on it opens like any other app.

Done. Sales, bookings and jobs now show up on everyone's phone within about half a minute.

---

## Good to know

**Where your data lives.** In a Google Sheet called **"Ridgeline Wash Co. Team Data"** in your
Google Drive. The link is in the setup email. Look any time, but do not type in it, and never
delete it or move it to the trash: that sheet is your data. The app does the writing.

**Forgot your PIN?** Open **script.google.com** → **Ridgeline Wash Team** → pick
**resetOwnerPin** in the function menu → **Run**. A new PIN is emailed to you, and every phone
that was signed in as you is signed out. For anyone else's PIN, use **Team** in the app.

**Updates.** If Claude ever changes the backend:
1. Paste the new Code.gs over the old code (step 2 above) and save.
2. Pick **setup** → **Run**. It is safe to run again: it changes nothing, your PIN stays the
   same, and it lets Google ask for any new permission.
3. **Deploy** → **Manage deployments** → the **pencil** → **Version: New version** → **Deploy**.

The URL stays the same, so nothing else changes and nobody has to sign in again. Do not use "New
deployment" for an update: that would make a second, different URL.

**Limits.** This runs on Google's free allowance, which is far more than a small team uses. The
email alerts are sent from your own Gmail (Google allows about 100 a day). You can send them to
a different address, or turn them off, under your initials → **Settings**.

**"The system is busy. Try again in a moment."** If two people save at the very same second, one
of them may see this. It is normal. It is how the app makes sure two people can never book the
same time.
