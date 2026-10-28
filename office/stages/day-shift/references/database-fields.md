# Database fields (the page reads exactly these names)

## settings/main
{businessName:"Ridgeline Local", paused:false, dryRun:true, autoSend:false, dailyEmailCap:10,
 ramp:{sendingSince:"" (first send day), step:1}, followUpDays:4, maxTouches:3, scoreGate:60,
 foundingSpots:0 (retired, ignore), signature:"Grayson\nRidgeline Local", optOutLine:"If you'd rather not hear
 from me, reply 'no thanks' and I'll stop.", mailingAddress:"", gmail:"ridgelinemarketinghq@gmail.com",
 siteUrl:"https://ridgelinehq.github.io", stripeUrl:"" (retired; checkout links live in data/stripe-links.json),
 targets:[{town:"Owasso", state:"OK", trades:["roofing","tree service"]}, ...],
 nextTarget:0 (index into targets; 00-start uses it, 08-report advances it),
 dayShiftTriggerId:"" (filled when the scheduled task exists), officeVersion:"v1",
 lastRun:{runId, day, finishedAt, outcome}, updatedAt}

## crew/<agent>  (ids: mara, scout, quinn, parker, echo, nova, sage, patch)
{name, role, state:"idle"|"working"|"error"|"paused", task, lastActivity, lastResult,
 lastError, stats:{runs, done, failed}, updatedAt}

## leads/<id>   id = <town>-<slug>  e.g. cabot-ar-pine-hill-roofing
{businessName, trade:"roofing"|"tree service"|"other", town, state, website, phone,
 phoneSource, contactEmail, emailSource (URL where it was found), contactName, contactNameSource,
 profile:{gbpFound:bool, claimed:bool|null, rating:number|null, reviews:number|null,
   photos:number|null, hoursListed:bool|null, servicesListed:bool|null, yelpClaimed:bool|null,
   website:bool, sources:[{url, what, at}],
   publicRating:number|null, publicReviews:number|null, publicRatingSource,
   signals:[{signal:"pay-per-lead"|"bad-review-unanswered"|"new-business"|"hiring"|"last-activity"|"peak-season", detail, url, at}]},
 searchCheck:{query, namedTop3:[names], namedYou:bool, at, source:"WebSearch"},
 aiCheck:{chatgpt:"named"|"not named"|"unknown", gemini:"named"|"not named"|"unknown",
   competitors:[names], questions:[two exact questions], at, screenshotAssetIds:[], by},
 score:0-100, scoreWhy:[strings], scoredAt, rubricVersion:2,
 tier:"Hot"|"Warm"|"Cold", buySignals:[names from scoring.md section B], whyNow:"one true sentence",
 angle:{lever, hook, detail, by:"parker", at},
 status:"New"|"Researching"|"Qualified"|"Contacted"|"Replied"|"Meeting"|"Client"|"Not a fit"|"Suppressed",
 touches:[{n, t, channel:"email"|"call"|"voicemail", draftId, gmailMessageId, threadId, note}],
 nextTouchAt, gmailThreadId, replyGist, calls:[{t, outcome, note, nextAt}],
 notes, source:"scout <day>", runId, createdAt, updatedAt,
 FULL LEAD CARD (Grayson, Oct 26, 2026; the page's Lead Desk and call sessions read these):
 niche:"<id from office/call_kit/kit.json niches>" (Scout sets it on every lead), address (published
 business address, with addressSource), contactRole ("owner"|"manager"), gbpUrl (the public Google
 Business Profile URL a search result showed), social:{facebook, instagram, ...} (public page URLs),
 weakSpots:[short plain strings, each true from the facts above, e.g. "Only 7 Google reviews"],
 enrich:{<field>:{status:"found"|"not found", tries:n, lastTriedAt, sources:[urls tried]}} for
   fields email, phone, owner, address, website, gbp, rating, social. "Not found" is written, never
   guessed; Scout retries it on later runs (01-scout "Enrichment pass"),
 callStatus:"New"|"Called"|"Voicemail"|"Callback"|"Interested"|"Sold"|"Not interested"|"Do not contact"
   (Grayson's call word, set by the page; separate from status, which stays the pipeline word),
 nextCallAt (next follow-up / callback time, ISO), callDone (3 tries with no answer),
 calls:[{t, who, outcome, note, nextAt, niche, town, pitchLine, sessionId}],
 followUp:{kind:"email_ai_check"|"email_ai_check_plus_offer"|"voicemail_email"|"close_lead",
   status:"pending"|"waiting-email"|"sent"|"failed"|"done", email, plan ("starter"|"growth"|"pro"
   on a Sold call), withOffer, requestedAt, sentAt, gmailMessageId, error, tries, by}

## drafts/<id>
{kind:"outreach"|"followup"|"breakup"|"freecheck"|"reply"|"script"|"caption"|"calendar"|"post"|"kit"|"plan"|"report"
   |"leads"|"jobcheck"|"reviewreq"|"fix"|"checkin"|"update"|"win" (the last three: client care, specs/client-happiness.md), clientId (client work only),
 leadId, businessName, town, title, subject, body, touch:1|2|3,
 status:"draft"|"ready"|"approved"|"sent"|"rejected"|"failed"|"brief"|"filmed"|"posted",
 qa:{score, by:"grader"|"self"|"desk", weakest, rewrites, levers:[], flags:[], at}, gmailDraftId, gmailDraftUrl,
 evidence:{gmailMessageId, threadId, sentAt}, approvedAt, rejectedAt, editedAt, error,
 createdBy, runId, createdAt, updatedAt,
 video:{hook, lines:[{second, say, popup}], caption, hashtags:[], capcut:[], postPlan:{}, results:{}} (scripts only)}

## tasks/<id>
(kind:"apply-google" + clientId when it is a Grayson task to apply the crew's Google profile fields as Manager; the page lists queued Grayson tasks on Today with Mark done)
{agent, title, details, status:"queued"|"running"|"done"|"failed"|"blocked", result, error,
 attempts, maxAttempts:2, runId, by:"grayson"|"mara"|"sage"|"patch", startedAt, finishedAt,
 createdAt, updatedAt, leadId (optional)}

## approvals/<id>
{type:"cap"|"setting"|"spend"|"other", summary, detail, status:"pending"|"approved"|"rejected",
 by, decidedAt, createdAt}

## suppression/<id>   id = slug of the email or business
{email, domain, businessName, reason, by, at}

## inbox/in-<gmail thread id>   (reply desk Lane J; the page's Inbox tab, Oct 27, 2026)
{name, businessName, phone, email, town, message, bestTime, kind: pricing|freecheck|onboarding|reply|other,
source: "website form"|"email", subject, receivedAt, gmailThreadId, gmailUrl, leadId, clientId, handled (what the
crew already did), status: New|Called|Left voicemail|Emailed|Done (Grayson's), statusAt, notes (Grayson's),
test, createdAt, updatedAt}. The crew never changes status or notes after creating the doc.

## clients/<id>
{leadId, businessName, town, state, contactEmail, phone, services, googleProfile, slug,
 plan:"starter"|"growth"|"pro", billing:"monthly"|"yearly", price, foundingLocked:bool, startedAt,
 stripe:{customerEmail, lastPaymentAt, messageId, amount}, stripeSession:"cs_..."|"none",
 aiQuestions:[{key, question}], baseline:{score, points, answers, jobId, at, detail},
 aiTrend:[{at, score, jobId, named}], competitorsNow:[...],
 guarantee:{checkedAt, leads, baselineScore, dayScore, owed, jobId, stripeJob, applied, appliedAt, what},
 audit:{at, ...}, profileLog:[{at, field, before, after, source}], reviewsAtStart, reviewsNow:{count, at, source},
 customers:[{email, firstName, addedAt, askedAt}] (never in the repo), fixesTried:[{at, fix, result}], flatAt,
 managerAccess:true|false|"invited"|"later"|"no-access" (the onboarding form's manager_access; true once Google's acceptance email arrives), reviewLink, reviewCard, landing:{slug, url},
 checkins:[{at, kind:"day-3"|"simpler"|"ask", question, draftId, gmailMessageId, repliedAt, reply}] (client-happiness.md 1, 4),
 wins:[{at, kind:"ai-named"|"reviews"|"fix-live"|"lead", proof, draftId, gmailMessageId}] (client-happiness.md 2; proof is the exact line emailed),
 lastUpdateAt (ISO of the last day-21 "what we did" email), cancelReason (the client's words, "no answer", or typed by Grayson on the page),
 work:[{item, status:"todo"|"drafted"|"done", t, draftId}], reportDue,
 status:"awaiting-onboarding"|"awaiting-payment"|"active"|"paused"|"cancelled", notes, createdAt, updatedAt}
 Standard work items: welcome-sent, onboarding, baseline, manager-access, review-link,
 profile-audit, buildout-plan, buildout-applied, review-kit, review-requests, lead-page (Pro),
 week-post, report-<yyyy-mm>, jobcheck-<yyyy-mm>, video-<yyyy-mm> (Pro), guarantee (Growth/Pro)
 (No client is on the retired $147 founding plan; plan "founding" is legacy and unused.)

## leadlog/<clientId>-<yyyymmdd>-<4 hex>
specs/lead-tracking.md "The lead log" (source, sourceUrl, contact, summary, status, counted,
sentToClientAt, sentGmailId, jobAnswer, notes). Never in the repo.

## alerts/<key>
{key, what, firstAt, lastAt, count, emailedAt, resolvedAt} (shared/alerts.md)

## lessons/<id>
{title, observation, evidence, confidence:0-100, agent, predicted, observed, workflowVersion,
 status:"active"|"retired", source, createdAt}

## workflow/<version>   e.g. v1-echo-subject-a
{version, stage, change, prediction, evalSet:{leads:[ids], sends:n}, result:{replies, rate,
 baselineRate}, verdict:"adopted"|"rolled back"|"testing", proposedAt, decidedAt}

## runs/<runId>   runId = run-<day>-<HHMM>
{task:"day-shift", day, startedAt, finishedAt, status:"running"|"done"|"failed"|"paused",
 stages:[{id, status, minutes, note}], counts:{found, new, qualified, drafts, ready, sent,
 replies, lessons}, summary, needsYou:[strings], town, model}

## sessions/<id>   id = s-<yyyymmdd>-<random>   (written by the page during a cold call session)
{niche, town:"<Town>, <ST>", startedAt, endedAt, status:"open"|"done", line (current pitch line id),
 done:[leadIds], skipped:[leadIds], counts:{<outcome>:n}, log:[{leadId, name, outcome, t, line, niche, town}],
 callbacks:[{leadId, name, at}], followUps:[{leadId, name, kind, plan}], by:"grayson"}

## markets/<niche>-<town>-<st>   e.g. roofing-cabot-ar   (Quinn; the page's "Who's On Top" panel)
{niche, town, state, question, chatgpt:[names], gemini:[names], google:[names],
 googleFrom:"local pack"|"directory <name>", jobId, sources:[urls], at}
Names exactly as the gateway text / the search result shows them, in their order, up to 5 each.
Refreshed every 14 days. The page merges them into one "Top 5 in <town>" list for the pitch.

## callstats/main   (Sage, from office/tools/call_desk.py stats)
{at, calls, byNiche:{<id>:{calls, talked, interested, sold, winRate, score}}, byTown:{...},
 byLine:{<pitch line id>:{...}}, byHour:{...}, nicheOrder:[niche ids, best first], bestLine, tooEarly}
The page orders the Niche of the Day rotation by nicheOrder and leads with bestLine.

## events/<day>
{day, items:[{t, agent, text}]}  (read first, append, keep newest 200)

## stats/<day>
{day, leads, newToday, qualified, contacted, replied, meeting, clients, sent, drafts, ready,
 followupsDue, callsLogged, at}

## health/main
{at, lights:{leads, outreach, replies, site, runs} each "green"|"yellow"|"red",
 site:{ok, status, ms, checkedAt, missing:[]}, db:{ok, leads, drafts},
 needsYou:[strings], fixed:[strings], watching:[strings], failedTasks:[ids],
 backups:[{day, assetId, bytes}], lastDayShift:{runId, outcome, minutes}}
