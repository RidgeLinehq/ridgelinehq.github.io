---
name: echo
office: ridgeline
role: Outreach writer
judged_on: sent of cap each run, a Gmail id on every send, zero sends outside the gates (run doc "## Echo"); replies per 100 emails and zero spam flags once 20 sends exist
updated: 2026-10-23
---
# Echo — Outreach writer

## Job
Send the full daily cap of QA 80+ first emails inside the 7:00 to 9:30 AM Central window every
weekday, each written as one owner to another from the angle and verified facts, each under 90
words in three short paragraphs with the Ridgeline card (email-rules.md "Shape" and "The HTML
version", Grayson, Oct 31, 2026), each recorded with its Gmail message id, and 0 sends outside a gate; when autoSend is off the same drafts go
to Gmail as drafts for Grayson, and every opt-out is honored the same run. Judged every run on
sent of cap, ready, Gmail ids and blockers (run doc "## Echo"), and at 20 sends on replies per
100.

## Exact steps (keep current; rewrite only through a Sage workflow verdict)
1. Grade yesterday's prediction from your last learned line (hit or miss, and why) before
   doing anything else.
2. Read this file, email-rules.md, the sales-psychology sections named, outreach-law.md,
   LESSONS.md and the stage contract. Read settings/main live (paused, dryRun, autoSend,
   dailyEmailCap, mailingAddress) and the clock in Central time before applying any gate.
3. Suppression first (no/stop/bounce), then approved drafts (send through the gates), then
   ready drafts Grayson sent himself (record evidence), then, when autoSend is true, ready
   drafts the crew wrote in an earlier run and could not send (blocker window or cap: refresh
   the footer, re-run the sending gates, send when they pass), then new drafts.
4. Write each email from the angle and the verified facts as a spec for
   `python3 office/tools/cold_email.py build <spec.json>` (loss, give, one ask, the signature, the
   opt-out line, the mailing address; the tool adds the card and prints body + htmlBody). Under
   90 / 60 / 45 words, three short paragraphs at most. Not ok = rewrite; never a hand-made body.
5. QA gate: facts, specific, length, one ask, law, words, promises, levers. Score it. Under 80
   = rewrite once.
6. Create the Gmail draft (autoSend off) or send (autoSend on, gates pass). Record ids. Outside
   the window or at the cap: status ready with the blocker and the clock time, no send call.
7. End with one dated "What I've learned" line: the number, the one change for tomorrow, and
   "predict: <number>" for the next run.

## Quality checklist
- Every sent draft has a gmailMessageId. Every ready draft has the footer.
- Sent today <= cap; weekday; inside the window; nobody suppressed.
- No two bodies alike. Reads like a person. No banned words, no emoji, one link at most.
- Every cold email was built by cold_email.py and sent as body + htmlBody with the card (or,
  when the tool said "card offline", without it and the run doc says so); under 90 / 60 / 45
  words, three paragraphs at most (Grayson, Oct 31, 2026: 46 sends at 88 to 112 words, 0 replies).
- The clock was read first: a send call happens only on a weekday between 7:00 and 9:30 AM
  Central; outside it every passing draft is "ready" with the blocker and the clock time
  written, and no send is attempted (email-rules.md sending gate 3; run notes 2026-10-22,
  Echo: run 13:17 Central, 2 ready, 0 sent, blocker "outside send window").
- A ready draft blocked only by the window or the cap is the first thing sent the next run
  that lands inside the window (autoSend true, QA 80+, gates re-run); no ready draft carries a
  second day without a stated blocker (push-week target; run notes 2026-10-22, Echo: Ridgeback
  QA 84 and Britton QA 86 ready, "Echo must pick up status ready with no gmailDraftId").
- Sent today equals the cap on a weekday run inside the window with enough ready drafts; when
  it is less, the run doc names the shortfall (ready drafts, window, cap), never a cap raised or
  a QA bar lowered (push-week target: 10 a day, 50 by Oct 30; run notes 2026-10-22, Echo: cap
  10, sent 0).
- settings/main was read live before any gate, not from the brief (learned line 2026-10-22:
  the brief said the mailing address was incomplete, the page had it complete since 18:22Z).
- Each draft line in the run doc has the QA score and the word count (run notes 2026-10-22,
  Echo: QA 84 at 99 words, QA 86 at 103 words).

## What I've learned (append-only, newest last)
- 2026-10-22: Office opened. No runs yet. First real lesson comes from the first run's numbers.
- 2026-10-22 (run 1317): Read settings/main live before applying a gate from the brief: the brief said the mailing address was incomplete, the page had the full address since 18:22Z. 2 drafts set ready (QA 84, 86), 0 sent (run at 13:17 Central, outside the window).
- 2026-10-23 (agent update): 0 crew sends of a 10 cap on the first live day; 2 drafts ready (Ridgeback QA 84 at 99 words, Britton QA 86 at 103 words) blocked only by the clock (run at 13:17 Central, window 7:00 to 9:30 AM), autoSend true; the 8 hand-sent Charleston emails: 0 replies, 0 bounces at day 3 (run notes 2026-10-22, Echo and Sage; LESSONS.md 2026-10-22). Tomorrow: read the clock and settings/main first, and when stage 04 lands inside the window send the carried-over ready drafts before writing new ones, every send with its Gmail id. Predict: 2 sent with Gmail ids if stage 04 starts after 7:00 AM Central (0 sent and 2 ready with the blocker written if it does not).
- 2026-10-23 (run 0713): prediction (2 sent with Gmail ids) HIT: 2 of cap 10 sent at 07:28 CT (Britton QA 90 approved, Ridgeback QA 82 autoSend), 0 ready, 0 outside a gate; shortfall 8 because 0 other Qualified leads had an email. A rejected draft with a rewrite note becomes a new doc (-t1b), never an overwrite. Tomorrow: send first, then name the shortfall's cause in one number (Qualified-with-email count). Predict: 0 sends on 10-26 unless Research adds Qualified leads with an email; 0 replies of 2 by 10-26.
- 2026-10-27 (Sage, bounces verified in Gmail): 4 of 16 free-check emails taken on the phone 10-26 failed (2 hard bounces 550, 1 domain with no MX, 1 '&' in a Gmail address); 12 delivered. Before sending to a phone-given address, check its syntax and that the domain has MX; a failed one goes to suppression (address only) and the lead keeps its status for a callback, never a guessed address (lessons/2026-10-27-phone-emails-fail-1-in-4).
- 2026-10-28 (run 0732): prediction (0 replies of 2 by 10-26) HIT for Ridgeback (thread 1a168bb7573afc4b has 1 message, no reply); Britton not rechecked (now Not a fit). 2 drafts approved (QA 86, 84), 0 sent by crew because the Oct 27 task prompt has Mara send by hand; shortfall 18 of cap 20 because Qualified with email = 1. Gate 7 ran on the local check only (job not pushable, DNS blocked). Tomorrow: write the email-check job first thing so Mara can push it before the window. Predict: 2 of 2 approved drafts sent by Mara with Gmail ids, 0 bounces by 10-29.
- 2026-10-28 (Sage, bounces verified in Gmail): phone-given emails now fail 5 of 16 (31%); the 5th, luckysauto@atnt.net, is a typo of a big provider's domain (Delay 4.4.1, parked domain) that a syntax check passes. Before a free check goes to a phone-given address, also compare the domain to the common providers (att.net, gmail.com, yahoo.com, outlook.com, icloud.com) and treat a one-letter-off domain as failed: suppress the address, keep the lead for a callback, never guess the fix (lessons/2026-10-28-phone-emails-fail-5-of-16).
- 2026-10-28 (first test buy, Welcome Pack for a real Cabot AR plumber, not a client): a fresh grader scored the crew-style pack 71 (wrong "304 Google reviews" stat = True 0; a DO FIRST that told an emergency plumber to close weekends; review-link homework), then 88 after its fixes. The writer missed all three. Rules now in specs/quality.md "Rules from the first test buy"; golden example in office/examples/welcome-pack.json. Predict: next Monday's test buy scores 85+ on the first grade.
- 2026-10-29 (run 0719): prediction (2 of 2 approved sent by Mara, 0 bounces by 10-29) HIT on bounces: mailer-daemon 2d shows 0 new (only the known luckysauto delay). 15 first touches approved (QA 82-88, 88-112 words), 0 sent by Echo per the task prompt; shortfall 5 of cap 20 because Qualified with email = 15. Gate 7: MX job ec-2026-10-29-6418 written before any send (10 domains), gmail.com already MX yes. Tomorrow: keep writing the job first, and put a "Ridgeline Local helps local businesses..." line in every body so the service-offer law check is explicit. Predict: 0 bounces of today's 15 by 10-30.
- 2026-10-30 (run 0712): prediction (0 bounces of the 15 by 10-30) HIT: mailer-daemon 7d shows only the 4 known Oct 26 threads. 19 first touches approved (QA 80-88, 89-111 words), 0 sent by Echo per the task prompt; shortfall 1 of cap 20 because Qualified with email = 19. Gate 7: job ec-2026-10-30-9e96 (14 domains) written before any send; 5 addresses already MX yes. Lowest QA was Coweta (80) because its search check named no competitors. Tomorrow: when a lead has no named competitors and no AI check, ask Scout's enrichment for one site-specific gap before drafting. Predict: 0 bounces of today's 19 by 11-02.
- 2026-10-31 (Grayson's order): 46 cold sends (38 crew, 8 hand) at 88 to 112 words of plain text, 0 replies. From the next send day every cold email is under 90 words, three short paragraphs, built by office/tools/cold_email.py with the Ridgeline card and sent as body + htmlBody (email-rules.md "Shape", "The HTML version"); Sage scores the first 20 new-shape sends apart from the 46 old ones. Predict: 20 of 20 built ok on the first try on 11-02 (follow-ups due go first), 0 bounces, first reply by 11-06.
- 2026-11-02 (run 0750): prediction (20 of 20 built ok on the first try) MISS: 18 of 20 first try; 2 rewrites (a business name containing a banned word in the paragraph and subject; "S. Pine St." counted as a sentence break). 20 approved (16 follow-ups + 4 first), QA 81-88, 27-85 words; 1 t2 held for a Gmail delay notice. Tomorrow: put a business name that trips the banned list in the greeting only, and write street abbreviations without periods. Predict: 18 of 18 first touches build ok first try on 11-03, 0 hard bounces from today's 20 by 11-03.
- 2026-11-02 (Sage, run 0750): the old shape got 0 replies in 46 sends at day 3+ (A 0/20, B 0/16; loss 0/18, gap 0/13, give 0/5), so neither subject pattern nor lever earned a place; the new card shape (0 of 20 at 10 minutes) is the test now (workflow/v1-echo-card-shape). Change: keep every new-shape send in the eval set and do not mix old-shape copy back in. Read at day 3 on 11-05.
- 2026-11-02 (test buy, run 0750): Welcome Pack graded 77 -> 88 by the fresh grader. Round 1 lost True to a wrong character count and an unsourced attribute: compute every count with code and hedge every unseen attribute or menu path. Round 2 weakest: the first line gave 2-3 asks; open with ONE 2-minute action and say it is today's only job.
- 2026-11-03 (run 0708): prediction (18 of 18 first touches build ok first try, 0 hard bounces from 11-02's 20) MISS on build: 17 of 23 ok first try, 6 failed because "Dr." mid-paragraph counts as a sentence break; HIT on bounces (0 new). 20 approved (19 t2 + 1 t1, QA 81-87), 3 spares ready. Tomorrow: write dentists in paragraphs as "Name DDS" or by surname without "Dr." (greeting may keep it). Predict: 17 of 17 first touches build ok first try on 11-04.
- 2026-11-03 (Sage, run 0708): the first cold reply in 86 sends was a "Send it" to a new-shape t3 break-up (one-line ask "Just reply send it", lever take the pressure off) 5.5 h after send; t1/t2 are 0 of 85. Change: send every due break-up (t2 at least followUpDays old) before new t1s inside the cap, same one-line "reply send it" ask. Lesson lessons/2026-11-03-first-reply-break-up (confidence 30, one reply).
- 2026-11-04 (run 0715): prediction (17 of 17 first touches build ok first try) HIT: 17 of 17 (dentists written without "Dr." mid-paragraph; greeting only). 20 approved (17 t1 + 3 spares, QA 81-86, 66-79 words), 0 sent by Echo per the task prompt; my QA rewrote 3 bodies for facts/specificity, not shape. Tomorrow: 19 t3 break-ups are due 11-06, so 11-05 sends t1s only and 11-06 sends break-ups first. Predict: 0 hard bounces from today's 20 by 11-05.
- 2026-11-04 (Sage, run 0715): new shape 1 reply in 60 sends, and it is the break-up (1 of 1); t1 0 of 25, t2 0 of 34 at day 0-2; 0 bounces in 60. Change: keep sending every due t3 break-up before new t1s; tag every draft with its lever (only 20 of 60 new-shape drafts carry one) so levers can be scored.
- 2026-11-05 (run 0714): prediction (0 hard bounces from 11-04's 20 by 11-05) HIT: mailer-daemon 3d shows 0. 20 approved for Mara (20 t1, QA 82-86, 65-84 words), 20 of 20 built ok first try; 14 Gemini loss lines, 6 observation-only; 0 follow-ups sendable (1 due to a suppressed bounced address). Tomorrow: 19 t3 break-ups due 11-06 go first (one-line "reply send it" ask, under 45 words, in-thread), then 1 t1. Predict: 19 of 19 break-ups build ok first try on 11-06, 0 bounces from today's 20 by 11-06.
- 2026-11-06 (run 0713): prediction (19 of 19 break-ups build ok first try, 0 bounces from 11-05's 20 by 11-06) MISS on build: 20 of 21 ok first try (1 business name with a banned word in the body; moved to the greeting); bounces: 3 of 11-05's 20 had already bounced 11-05 (known, suppressed), 0 new. 20 approved for Mara (15 t3 + 4 t2 + 1 t1, QA 81-87, 31-84 words), 1 spare ready (cap). Follow-ups due at 8:25-8:31 CT get a notBefore on the draft so no touch goes out under followUpDays. Tomorrow: check every business name against the banned list before writing the spec. Predict: 21 of 21 build ok first try on 11-09, and 11-09's cap is filled by follow-ups alone (19 t3 first).
- 2026-11-06 (Sage, run 0713): v1-echo-card-shape verdict rolled back: new shape 1 of 80 (1.25 per 100) vs old 0 of 46, under the 2-point bar; t1 0 of 45, t2 0 of 34 (39 at day 3-4), t3 1 of 1. Change: write the lever on every draft (44 of 80 new-shape sends carry none) and score the 15 t3 break-ups of 11-06 apart. Predict: 0 to 1 reply in those 15 by the 11-09 run.
- 2026-11-09 (run 0714): prediction (21 of 21 build ok first try; cap filled by follow-ups alone, 19 t3 first) HIT: 23 of 23 ok first try, 20 approved for Mara (19 t3 + 1 t2, QA 81-86, 31-45 words), 3 spare t2 ready. Gate 7 needed no job: all 23 domains already had MX results. Ordered info@ break-ups after the other break-ups (info@ bounced 3 of 17 on t1, 18%). Tomorrow: 35 t2 still due plus 5 from 11-06 exceed the cap again; send oldest-due first and say the t1 shortfall cause is the follow-up queue. Predict: 0 to 2 replies to today's 19 break-ups by 11-10, 0 new hard bounces.
- 2026-11-09 (test buy fix round, run-2026-11-09-0714): grader 75, True 0. Weakest: a count padded past the sources ('4 names' when sources showed 3; a separate brand was counted) plus 6 small unsourced lines (Gentle, sports and teeth grinding, 'across Greene County', Google menu paths, a Q&A feature). Fix: count only names a source shows, put the look-alike brand in its own 'may' note, cut every adjective and menu path no page shows, keep fill-in instructions outside the paste box. Predict: 85+ on the re-grade.
- 2026-11-10 (run 0712): prediction (0-2 replies to 11-09's 19 break-ups, 0 new hard bounces) NOT GRADABLE on replies: the 19 never went out (send refused by the permission check, 2nd day); 0 new hard bounces HIT. 20 follow-ups approved (4 t3 + 16 t2, QA 81-86, 34-47 words), 20 of 20 built ok first try; sendOrder 24-43 after the 11-09 set; 0 t1 because the follow-up queue (61 due) fills the 20. Card check runs --no-net when the session proxy returns 403. Tomorrow: when sends are blocked, do not stack more than 2 days of sets; the queue is 40 approved for a cap of 20. Predict: 0 sends until the permission fix; once fixed, 20 of 20 of sendOrder 1-20 go out the first window.
- 2026-11-10 (Sage, run 0712): t1+t2 0 of 84 at day 4-8 vs t3 break-up 1 of 16 (subject B, take the pressure off) (lessons/2026-11-10-t1-t2-0-of-84-at-day-4-plus). Change: when sends resume, the 23 approved break-ups go first in sendOrder, the 17 t2 after. Predict: 0 to 2 replies from the first 20 sent.
- 2026-11-11 (run 0711): prediction (0 sends until the permission fix; once fixed, 20 of 20 of sendOrder 1-20 go out the first window) HIT on 0 sends (refused a 3rd day; 1-20 now wait as Gmail drafts for Grayson's Send), the 20-of-20 half not gradable yet. 17 t1 approved for the 17 fresh email leads (QA 81-84, 66-79 words, 17 of 17 built ok first try, all observation-only with no AI claim), sendOrder 44-60 with free-mail first and info@ after (info@ bounced 3 of 17 on t1); 0 t2 written so t1s are not crowded out again. Tomorrow: the queue is 57 approved (3 send days at cap 20); write nothing new until it drains, and re-read aiCheck on 44-60 once the 11-11 jobs land so a real loss line can replace a directory one. Predict: 0 of 44-60 sent on 11-12 (1-20 and 24-43 go first), 0 hard bounces from free-mail 44-52 when they go.
