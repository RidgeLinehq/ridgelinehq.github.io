# Proposal: ask for Google Manager access up front on welcome.html (Oct 28, 2026; NOT live)

Status: proposal only. Nothing on the live site changes until Grayson says go.
Preview it on your phone (private artifact; its form sends nothing): https://claude.ai/artifact/1XJ5LrwPYAMRnKzhX4A9J7

## Why
- The crew cannot open a Google Business Profile from a scheduled run (Google blocks the fetch).
  The first test buy had to work from Birdeye, MapQuest, Yahoo and TrustAnalytica copies, and they
  disagreed on hours and phone (specs/quality.md "Rules from the first test buy").
- With Manager access the crew sees the real listing (hours, categories, description, photos,
  Q&A), pulls the review link itself (no more "paste your review link" homework), and Google
  sends the profile's message and call notices to the Ridgeline Gmail (tracked leads, Lane G).
- Today the ask sits BELOW the form as "Optional ... (3 minutes)". Optional steps after the submit
  button don't get done. Asking inside the form, with a required three-way answer, makes it a
  conscious step without blocking anyone.

## What changes on the page (phone first)
1. Header promise: "One short form (about 2 minutes) and one Google tap (3 minutes) and we get going."
2. A brass-outlined block inside the form, after the email field and before "Start my work": the
   why in three plain sentences, the two-step path (Maps app -> your profile -> three dots or Edit
   profile -> Business Profile settings -> People and access -> Add -> Manager -> Invite), the
   email with a Copy button, and one required question "Did you send the invite?" with three big
   radio answers:
   - invited: "Yes, the invite is sent"
   - later: "Not yet. I'll do it right after this form (we'll remind you once)"
   - no-access: "I can't get into my Google listing, or I'm not sure I have one"
   No answer = the block turns red with "Pick one so we know how to start" (the same pattern as
   the other required fields). "Later" is a real answer, so nobody is blocked.
3. The success box changes with the answer: "later" repeats the two steps right there; "invited"
   says we accept within the hour; "no-access" says the pack works from public information and
   shows how to claim the listing (free, about 5 minutes).
4. The FormSubmit autoresponse carries the matching line, so the confirmation email repeats the
   one step. It also now says the Welcome Pack lands within the hour and a day-3 check-in follows
   (that is what specs/quality.md "Speed" and specs/client-happiness.md promise).
5. The old "Optional: add us as a Manager" step below the form becomes "Why we ask for Manager
   access" (three reasons, and that they can remove us any time).

## What the form sends (one new field)
`manager_access: invited | later | no-access` in the FormSubmit email "Onboarding - <business>",
between email and plan. Every other field is unchanged, so nothing downstream breaks if the crew
ignores the new field.

## Crew-side changes to apply on the same go (not applied yet)
- office/instant/Code.gs KEYS_: add `manager: ['manager access', 'manager_access']` so the Instant
  log JSON carries it.
- stages/reply-desk/CONTEXT.md Lane C step 2: read `manager_access`; set client.managerAccess to
  "invited" | "later" | "no-access" (true once Google's "manager invitation accepted" email
  arrives, step 6). invited: accept the invite the same run when the Gmail shows it; the Welcome
  Pack says "we're in your listing" and drops the review-link homework. later: the pack's DO FIRST
  #1 is the Manager step and the day-3 check-in asks for it once, never twice. no-access: the pack
  includes "Claim your Google listing (free, 5 minutes)" as DO FIRST #1 and every profile fact
  is labeled with the copy site it came from.
- stages/day-shift/references/database-fields.md: managerAccess: true|false|"invited"|"later"|"no-access".
- specs/client-delivery.md "The flow" step 3: add manager_access to the field list.
- office/page: show the self-reported value as a pill next to "Added as Manager" in the client
  drawer (the checklist item already flips managerAccess to true).

## What was checked
- Rendered at 390 px and 1280 px: no horizontal scroll, no script errors. Submitting with no
  answer marks the block red and focuses it; picking "later" and submitting shows the success box
  with the two steps.
- The preview artifact fakes the send (no FormSubmit call), so it can be tapped through safely.

## The exact change (unified diff against welcome.html as of Oct 28, 2026)
```diff
--- welcome.html (live, Oct 28, 2026)
+++ welcome.html (proposed)
@@ -61,6 +61,27 @@
 .fallback{display:none;margin-top:14px}
 .fallback textarea{width:100%;min-height:140px;padding:10px;border-radius:9px;border:1px solid #b9b3a1;font:13px/1.4 ui-monospace,Menlo,monospace}
 .planline{font-weight:600}
+
+/* Manager access (proposed Oct 28, 2026): the one step that unlocks the real Google listing */
+.mgr{margin-top:24px;padding:16px;border:2px solid var(--brass);border-radius:14px;background:#fbf8f0;min-width:0}
+.mgr legend{font-weight:700;font-size:1rem;padding:0 6px;line-height:1.35}
+.mgr legend span{display:block;color:var(--brass-text);font-weight:600;font-size:.82rem;letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px}
+.mgr .why{margin:8px 0 0;color:var(--ink);font-size:.95rem}
+.mgr .path{margin:12px 0 0;padding-left:22px;font-size:.95rem;color:var(--ink)}
+.mgr .path li{margin:6px 0}
+.copyrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px}
+.copyrow .copy{margin:0;flex:1 1 100%;min-width:0;word-break:normal;overflow-wrap:anywhere}
+.tap.sm{margin:0;min-height:46px;display:inline-flex;align-items:center;border:0;font:600 .95rem/1 Inter,system-ui,sans-serif;cursor:pointer}
+.choices{margin-top:14px}
+.choices .q{margin:0 0 6px;font-weight:700;font-size:.95rem}
+.choices label{display:flex;gap:12px;align-items:flex-start;padding:12px 14px;border:1px solid #b9b3a1;border-radius:10px;margin-top:8px;min-height:50px;font-weight:500;font-size:.95rem;background:#fffefb;cursor:pointer}
+.choices label:has(input:checked){border-color:var(--forest);background:var(--sage)}
+.choices input{width:22px;height:22px;margin:1px 0 0;flex:none;accent-color:var(--forest)}
+.mgr.err{border-color:#b23a2d}
+.mgr .msg{margin-top:8px}
+.okstep{margin-top:14px;padding:14px;background:var(--white);border:1px solid var(--line);border-radius:12px}
+.okstep ol{margin:6px 0 0;padding-left:22px;font-size:.95rem}
+.okstep ol li{margin:5px 0}
 </style>
 </head>
 <body>
@@ -75,7 +96,7 @@
   <div class="wrap">
     <span class="kicker">You’re in</span>
     <h1>Welcome to <em>Ridgeline Local.</em></h1>
-    <div class="promise">One short form (about 2 minutes) and we get going. We run your <strong>starting AI visibility check</strong> right away and email you the result.</div>
+    <div class="promise">One short form (about 2 minutes) and one Google tap (3 minutes) and we get going. We run your <strong>starting AI visibility check</strong> right away and email you the result.</div>
     <p class="meta planline" id="planLine">No contract. Cancel anytime by replying to any email.</p>
   </div>
 </header>
@@ -92,13 +113,38 @@
       <div class="f"><label for="sv">What do you do? <span>(your main services)</span></label><textarea id="sv" required maxlength="500" placeholder="e.g. haircuts, beard trims, kids cuts"></textarea><div class="msg">Please list your main services.</div></div>
       <div class="f"><label for="ct">City and state</label><input id="ct" required maxlength="100" placeholder="e.g. Tulsa, OK" autocomplete="address-level2"><div class="msg">Please add your city and state.</div></div>
       <div class="f"><label for="em">Email for reports and leads</label><input id="em" type="email" required maxlength="160" autocomplete="email" inputmode="email"><div class="msg">Please add an email we can reach you at.</div></div>
+
+      <fieldset class="f mgr" id="mgrBox">
+        <legend><span>The step that unlocks the most</span>Add us as a Manager on your Google listing (3 minutes)</legend>
+        <p class="why">Google doesn’t let outside tools read your listing, and the copies on other sites are often wrong (hours, phone, even the kind of business). With Manager access we see the real thing: we fix your hours and categories faster, grab your review link for you, and see the messages and missed calls that come through Google. You stay the owner. Never a password. Remove us any time.</p>
+        <ol class="path">
+          <li>Open the Google Maps app and tap your business profile (or search your business name on Google while signed in) → <strong>⋯</strong> or <strong>Edit profile</strong> → <strong>Business Profile settings</strong> → <strong>People and access</strong>.</li>
+          <li>Tap <strong>Add</strong>, paste the email below, choose <strong>Manager</strong>, tap <strong>Invite</strong>.</li>
+        </ol>
+        <div class="copyrow"><span class="copy" id="mgrEmail">ridgelinemarketinghq@gmail.com</span><button type="button" class="tap sm" id="copyMgr">Copy email</button></div>
+        <div class="choices" role="radiogroup" aria-labelledby="mgrQ">
+          <p class="q" id="mgrQ">Did you send the invite?</p>
+          <label for="mgr1"><input type="radio" name="mgr" id="mgr1" value="invited"> Yes, the invite is sent</label>
+          <label for="mgr2"><input type="radio" name="mgr" id="mgr2" value="later"> Not yet. I’ll do it right after this form (we’ll remind you once)</label>
+          <label for="mgr3"><input type="radio" name="mgr" id="mgr3" value="no-access"> I can’t get into my Google listing, or I’m not sure I have one</label>
+        </div>
+        <div class="msg">Pick one so we know how to start.</div>
+      </fieldset>
+
       <button class="go" id="go" type="submit">Start my work →</button>
       <p class="meta">We never ask for a password. Leads and reports go to the email above.</p>
     </form>
 
     <div class="ok" id="ok" role="status" aria-live="polite">
       <h2 id="okTitle">Got it. We’re starting now.</h2>
-      <p id="okText">Your starting AI visibility check is running and a confirmation email is on its way. Your score comes first, usually within the hour. Your Google profile fixes and review kit follow within 2 business days.</p>
+      <p id="okText">Your starting AI visibility check is running and a confirmation email is on its way. Your score comes first, usually within the hour. Your Welcome Pack (profile fixes, review kit, your first 30 days) follows within the hour too.</p>
+      <div class="okstep" id="okMgr" style="display:none">
+        <strong>One more thing, 3 minutes, and it unlocks the most:</strong>
+        <ol>
+          <li>Google Maps app → your business profile (or search your business name on Google while signed in) → <strong>⋯</strong> / <strong>Edit profile</strong> → <strong>Business Profile settings</strong> → <strong>People and access</strong>.</li>
+          <li>Tap <strong>Add</strong>, paste <span class="copy" style="margin:0;padding:4px 8px">ridgelinemarketinghq@gmail.com</span>, choose <strong>Manager</strong>, tap <strong>Invite</strong>.</li>
+        </ol>
+      </div>
       <div class="fallback" id="fb">
         <p><strong>One more tap:</strong> our form didn’t go through. Tap below to send these details by email.</p>
         <a class="tap" id="fbMail" href="mailto:ridgelinemarketinghq@gmail.com">Send by email</a>
@@ -107,21 +153,17 @@
     </div>
 
     <ol class="terms steps" style="margin-top:34px">
-      <li><div><h2>Optional: add us as a Manager on your Google profile (3 minutes)</h2>
-        <p>This lets Google send us your profile’s message and call notices so we can log your leads, and lets us see your profile like you do. You stay the owner and can remove us any time. Never a password.</p>
-        <ul>
-          <li>Google Maps app (or google.com/business) → your profile → <strong>⋯ menu</strong> → <strong>Business Profile settings</strong> → <strong>People and access</strong> (or <strong>Managers</strong>) → <strong>Add</strong>.</li>
-          <li>Enter this email, choose <strong>Manager</strong>, tap <strong>Invite</strong>:</li>
-        </ul>
-        <span class="copy">ridgelinemarketinghq@gmail.com</span></div></li>
       <li><div><h2>What happens next</h2>
         <ul>
           <li><strong>Today:</strong> your starting AI visibility check (what ChatGPT and Gemini say, and your score).</li>
-          <li><strong>Within 2 business days:</strong> your Google profile fixes, written out and ready to paste, and your review request kit.</li>
-          <li><strong>Growth and Pro, every week:</strong> we re-check ChatGPT and Gemini and keep your profile moving.</li>
+          <li><strong>Within the hour:</strong> your Welcome Pack: Google profile fixes written out and ready to paste, your review request kit, and your first 30 days.</li>
+          <li><strong>Day 3:</strong> a one-question check-in, so nothing stays confusing.</li>
+          <li><strong>Growth and Pro, every week:</strong> we re-check ChatGPT and Gemini and keep your profile moving. When something wins, you hear about it the same day.</li>
           <li><strong>Pro:</strong> leads go to your email as we find them.</li>
           <li><strong>Growth and Pro, every month:</strong> a short report: AI score then vs now, reviews gained, and on Pro, the leads we sent.</li>
         </ul></div></li>
+      <li><div><h2>Why we ask for Manager access</h2>
+        <p>Three real reasons. We can see your listing the way you do, instead of guessing from copies on other sites. Google sends us your profile’s message and call notices, so we can log your leads. And we can grab your review link ourselves, so your review kit is ready the same day. You can remove us any time in the same People and access screen.</p></div></li>
     </ol>
 
     <div class="box">
@@ -143,6 +185,7 @@
   if(plans[plan]){document.getElementById("planLine").textContent="Your plan: "+plans[plan]+". No contract. Cancel anytime by replying to any email."}
   var $=function(id){return document.getElementById(id)};
   var req=["b","ty","ph","sv","ct","em"];
+  function mgrChoice(){var el=document.querySelector('input[name="mgr"]:checked');return el?el.value:""}
   function val(){
     var good=true;
     req.concat(["gp"]).forEach(function(id){
@@ -150,20 +193,34 @@
       var bad=(req.indexOf(id)>-1&&!el.value)||(id==="em"&&el.value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value))||(id==="gp"&&el.value&&!/^https?:\/\/\S+$/i.test(el.value)&&!/^(maps\.app\.goo\.gl|g\.page|goo\.gl|www\.google|google)\S*/i.test(el.value));
       f.classList.toggle("err",bad);if(bad&&good){el.focus();good=false}
     });
+    var m=!mgrChoice();$("mgrBox").classList.toggle("err",m);if(m&&good){$("mgr1").focus();$("mgrBox").scrollIntoView({block:"center"});good=false}
     return good;
   }
   req.concat(["gp"]).forEach(function(id){$(id).addEventListener("input",function(){this.closest(".f").classList.remove("err")})});
+  Array.prototype.forEach.call(document.querySelectorAll('input[name="mgr"]'),function(r){r.addEventListener("change",function(){$("mgrBox").classList.remove("err")})});
+  $("copyMgr").addEventListener("click",function(){
+    var btn=this;var done=function(){btn.textContent="Copied";setTimeout(function(){btn.textContent="Copy email"},1800)};
+    var fb=function(){var r=document.createRange();r.selectNodeContents($("mgrEmail"));var s=window.getSelection();s.removeAllRanges();s.addRange(r);try{document.execCommand("copy");done()}catch(e){btn.textContent="Select and copy"}};
+    try{if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(EMAIL).then(done,fb)}else fb()}catch(e){fb()}
+  });
   $("ob").addEventListener("submit",function(e){
     e.preventDefault();if(!val())return;
-    var d={business:$("b").value,type_of_business:$("ty").value,google_profile:$("gp").value||"Not given",phone:$("ph").value,services:$("sv").value,city:$("ct").value,email:$("em").value,plan:plan||"unknown",billing:billing,stripe_session:session||"none"};
+    var mgr=mgrChoice();
+    var d={business:$("b").value,type_of_business:$("ty").value,google_profile:$("gp").value||"Not given",phone:$("ph").value,services:$("sv").value,city:$("ct").value,email:$("em").value,manager_access:mgr,plan:plan||"unknown",billing:billing,stripe_session:session||"none"};
     var subject="Onboarding — "+d.business;
     var text=Object.keys(d).map(function(k){return k+": "+d[k]}).join("\n");
     $("go").disabled=true;$("go").textContent="Sending…";
-    var auto="Thanks, "+d.business+"! You\u2019re all set with Ridgeline Local.\n\nYour work has started. Here\u2019s what lands in your inbox next:\n1. Usually within the hour: your starting AI visibility score, what ChatGPT and Gemini say about your kind of business in "+d.city+", and whether they name you.\n2. Within 2 business days: your Google profile fixes, written out and ready to paste (about 10 minutes).\n3. Within 2 business days: your review kit, a ready-to-send text and a QR card for your counter.\n\nQuestions? Just reply to this email. A real person answers.\n\nGrayson\nRidgeline Local";
+    var mgrLine=mgr==="invited"?"You added us as a Manager on your Google listing: thank you. We accept the invite within the hour, and from then on we see your real listing, fix it faster and pull your review link ourselves.":mgr==="later"?"The one thing that unlocks the most (3 minutes): add ridgelinemarketinghq@gmail.com as a Manager on your Google listing. Google Maps app > your business profile > Edit profile or the three dots > Business Profile settings > People and access > Add > Manager > Invite. Never a password; remove us any time.":"No Google access? No problem. Your Welcome Pack works from public information, and it shows you how to claim your Google listing (free, about 5 minutes). Reply to this email if you want us to walk you through it.";
+    var auto="Thanks, "+d.business+"! You’re all set with Ridgeline Local.\n\nYour work has started. Here’s what lands in your inbox next:\n1. Usually within the hour: your starting AI visibility score, what ChatGPT and Gemini say about your kind of business in "+d.city+", and whether they name you.\n2. Within the hour: your Welcome Pack, one PDF with your Google profile fixes written out and ready to paste (about 10 minutes), your review kit (a ready-to-send text and a QR card for your counter), and your first 30 days.\n3. Day 3: a one-question check-in from us, so nothing stays confusing.\n\n"+mgrLine+"\n\nQuestions? Just reply to this email. A real person answers.\n\nGrayson\nRidgeline Local";
     var payload=Object.assign({_subject:subject,_template:"box",_captcha:"false",_autoresponse:auto},d);
     function done(ok){
       $("ob").style.display="none";$("ok").style.display="block";
-      if(!ok){$("okTitle").textContent="One more tap";$("okText").textContent="Our form didn\u2019t go through, so nothing has started yet. Send your details by email below and we take it from there.";$("fb").style.display="block";$("fbText").value="Subject: "+subject+"\n\n"+text;$("fbMail").href="mailto:"+EMAIL+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(text)}
+      if(ok){
+        if(mgr==="later"){$("okMgr").style.display="block"}
+        else if(mgr==="invited"){$("okText").textContent="Your starting AI visibility check is running and a confirmation email is on its way. Thanks for the Manager invite: we accept it within the hour, and your Welcome Pack (profile fixes, review kit, your first 30 days) follows within the hour too."}
+        else if(mgr==="no-access"){$("okText").textContent="Your starting AI visibility check is running and a confirmation email is on its way. Your Welcome Pack follows within the hour, built from public information, and it shows you how to claim your Google listing (free, about 5 minutes)."}
+      }
+      if(!ok){$("okTitle").textContent="One more tap";$("okText").textContent="Our form didn’t go through, so nothing has started yet. Send your details by email below and we take it from there.";$("fb").style.display="block";$("fbText").value="Subject: "+subject+"\n\n"+text;$("fbMail").href="mailto:"+EMAIL+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(text)}
       $("ok").scrollIntoView({block:"center"});
     }
     fetch("https://formsubmit.co/ajax/"+EMAIL,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(payload)})
```
