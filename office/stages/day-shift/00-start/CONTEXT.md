# 00 Start (Mara, the coordinator does this herself)

## Inputs
| File | Section |
|---|---|
| shared/repo.md | Getting it |
| database: settings/main, crew/*, stats/<yesterday>, health/main | all |

## Process
1. Day key and runId (`run-<day>-<HHMM>` Central). Pull the repo.
2. Read settings/main. If `paused` is true: set every crew doc to state "paused", write
   runs/<runId> {status:"paused"}, write the run-log line, tell Grayson nothing (the page shows
   it), stop.
3. Pick today's town: `targets[nextTarget]`. Count that town's leads by status (query leads
   where town == ..., out_dir). Decide worker skips per the pipeline table.
4. Ramp check: if `ramp.sendingSince` is set, days since it decide the cap ladder (10/15/20);
   if the live `dailyEmailCap` is below the ladder's value for today, update it (this is the
   one settings field the crew may raise, never above 20). Record it.
5. Claim assigned tasks (pipeline "Assigned tasks").
6. Write runs/<runId> {status:"running", day, startedAt, town, stages:[]}. Set crew/mara
   working "Running the day shift".

## Audit
settings read; town chosen; cap within the ladder; runId written.

## Outputs
| Where | What |
|---|---|
| runs/<runId> | created |
| output/<day>-run.md | `# Day Shift <day>` and `## Settings` (town, trades, cap, autoSend, dryRun, foundingSpots, skips) |
