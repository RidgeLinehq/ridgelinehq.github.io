# The run log

Canonical home for observability. Every run that uses this workspace ends with one line in
`office/runlog.jsonl`, written with the helper below, committed with the run's other repo
writes (or on its own if the run writes nothing else). This is how Grayson, Patch and Mara see
what ran, what it loaded and how long it took, without opening every app.

## What the provider exposes, honestly
- Token counts are NOT exposed to a scheduled session. The log records a proxy that is exact
  and comparable: the byte size of every instruction file the run loaded, and an estimate of
  tokens from it (bytes / 4).
- Wall time is exact: the run's start and finish.
- Model is what the scheduled task is set to; record it as the prompt names it or "unknown".
- Cost in dollars is unknown for model usage. The office spends no money unless Grayson says so,
  and any real spend is logged in the run doc and in settings/main.spend.

## The line (one JSON object per run)
{"task":"day-shift","day":"2026-10-23","run":"run-2026-10-23-0640","started":"...Z",
 "finished":"...Z","minutes":17.3,"model":"unknown","stages":["00-start","01-scout",...],
 "skipped":["05-nova"],"loaded":[{"f":"office/CLAUDE.md","b":3120},...],"loadedBytes":41200,
 "estTokens":10300,"gatewayJobs":0,"dbWrites":41,"outcome":"done",
 "note":"12 leads, 9 qualified, 6 drafts ready, 0 sent (autoSend off)","needsYou":"Approve 6 drafts"}

## Helper
`python3 office/shared/runlog.py add --task <name> --started <iso> --finished <iso>
  --stages a,b,c --skipped x,y --loaded f1,f2,... --gateway-jobs N --db-writes N
  --outcome done|failed|paused|skipped --note "<one line>" --needs-you "<one line or empty>"`
It measures the loaded files' sizes itself, appends the line, and prints it. Keep the list of
loaded files honest: name every instruction file you opened, nothing you did not.

`python3 office/shared/runlog.py --status` prints the last run per task.
`python3 office/shared/runlog.py --summary 7` prints per-task averages for the last 7 days.

## Baseline
No runs yet (office opened Oct 22, 2026). The first 7 days of lines are the baseline; Sage
compares later weeks against them (minutes, estTokens, leads per run, replies per 100 emails).
