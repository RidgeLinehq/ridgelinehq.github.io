# Database fields (the page reads exactly these names)

## settings/main
{businessName:"Ridgeline Local", paused:false, dryRun:true, autoSend:false, dailyEmailCap:10,
 ramp:{sendingSince:"" (first send day), step:1}, followUpDays:4, maxTouches:3, scoreGate:60,
 foundingSpots:10, signature:"Grayson\nRidgeline Local", optOutLine:"If you'd rather not hear
 from me, reply 'no thanks' and I'll stop.", mailingAddress:"", gmail:"ridgelinemarketinghq@gmail.com",
 siteUrl:"https://ridgelinehq.github.io", stripeUrl:"https://buy.stripe.com/dRm00jgNddCI53cbOlaEE00",
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
   website:bool, sources:[{url, what, at}]},
 searchCheck:{query, namedTop3:[names], namedYou:bool, at, source:"WebSearch"},
 aiCheck:{chatgpt:"named"|"not named"|"unknown", gemini:"named"|"not named"|"unknown",
   competitors:[names], questions:[two exact questions], at, screenshotAssetIds:[], by},
 score:0-100, scoreWhy:[strings], scoredAt,
 angle:{lever, hook, detail, by:"parker", at},
 status:"New"|"Researching"|"Qualified"|"Contacted"|"Replied"|"Meeting"|"Client"|"Not a fit"|"Suppressed",
 touches:[{n, t, channel:"email"|"call"|"voicemail", draftId, gmailMessageId, threadId, note}],
 nextTouchAt, gmailThreadId, replyGist, calls:[{t, outcome, note, nextAt}],
 notes, source:"scout <day>", runId, createdAt, updatedAt}

## drafts/<id>
{kind:"outreach"|"followup"|"breakup"|"freecheck"|"reply"|"script"|"caption"|"calendar"|"post",
 leadId, businessName, town, title, subject, body, touch:1|2|3,
 status:"draft"|"ready"|"approved"|"sent"|"rejected"|"failed"|"brief"|"filmed"|"posted",
 qa:{score, levers:[], flags:[], at}, gmailDraftId, gmailDraftUrl,
 evidence:{gmailMessageId, threadId, sentAt}, approvedAt, rejectedAt, editedAt, error,
 createdBy, runId, createdAt, updatedAt,
 video:{hook, lines:[{second, say, popup}], caption, hashtags:[], capcut:[], postPlan:{}, results:{}} (scripts only)}

## tasks/<id>
{agent, title, details, status:"queued"|"running"|"done"|"failed"|"blocked", result, error,
 attempts, maxAttempts:2, runId, by:"grayson"|"mara"|"sage"|"patch", startedAt, finishedAt,
 createdAt, updatedAt, leadId (optional)}

## approvals/<id>
{type:"cap"|"setting"|"spend"|"other", summary, detail, status:"pending"|"approved"|"rejected",
 by, decidedAt, createdAt}

## suppression/<id>   id = slug of the email or business
{email, domain, businessName, reason, by, at}

## clients/<id>
{leadId, businessName, town, state, plan:"founding"|"standard", monthly:147|197, startedAt,
 stripe:{customerEmail, lastPaymentAt}, reviewsAtStart, reviewsNow, managerAccess:bool,
 work:[{t, item, status}], reportDue, status:"active"|"paused"|"cancelled", notes}

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
