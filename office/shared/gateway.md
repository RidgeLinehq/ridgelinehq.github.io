# The AI check gateway (ChatGPT + Gemini, real answers)

Canonical home. The crew cannot open the ChatGPT or Gemini apps, and the cloud session cannot
reach their APIs directly, so a GitHub Action asks them. Keys live only in the repo's Actions
secrets (OPENAI_API_KEY, GEMINI_API_KEY); nobody sees or prints them.

## Protocol
1. Write `office/gw/jobs/aicheck-<day>-<town>-<4 hex>.json` =
   {"id": "<same as file name without .json>", "queries": [{"key": "<town>-<st>-<trade>",
   "question": "Who are the best <roofers|tree services> in <Town>, <ST>?", "city": "<Town>",
   "region": "<State name>"}]}. One query per town+trade (never a named lead: the repo is
   public). At most 6 queries per job.
2. Commit, `git pull --rebase`, `git push origin HEAD:main`. The Action "Ridgeline AI check"
   writes `office/gw/out/<same file name>` in about 1 to 3 minutes.
3. Poll: `git fetch -q origin main` then `git show origin/main:office/gw/out/<file>` every 15 s;
   give up after 6 minutes (record "AI check gateway slow" and carry on with "unknown").
4. Result per query: {key, question, chatgpt:{ok, model, web_search, text, sources[], error},
   gemini:{ok, model, google_search, text, sources[], note, error}}.

## Using the answer on a lead (every lead of that town+trade)
- named = the lead's business name (or its distinctive first two words) appears in the text,
  case-insensitive. aiCheck.chatgpt / aiCheck.gemini = "named" | "not named" | "unknown" (call
  failed). aiCheck.competitors = the businesses each answer names (from the text, max 5).
  aiCheck.answers = {chatgpt: first 600 chars, gemini: first 600 chars, models, sources (max 3
  each), at, jobId}. aiCheck.by = "gateway".
- A "not named" result is the strongest loss line there is: Parker uses it first, Echo quotes
  it exactly ("When I asked ChatGPT 'Who are the best roofers in Cabot, AR?' it named X, Y and
  Z."). Never paraphrase it into something it did not say.
- Cache: one job per town+trade per 7 days. Re-use the newest out file inside that window.

## Cost (Grayson's choice, Oct 22, 2026)
Gemini: free key; Google Search grounding needs a paid plan, so on the free key the answer is
the model alone (the result says so; say "Gemini" not "Google"). ChatGPT: about 1 to 3 cents a
query with web search, paid from a one-time $5 credit (auto-recharge off). One query per
town+trade means roughly 10 to 20 queries a week. If the result says "quota" or "billing",
write NEEDS YOU "OpenAI credit ran out" and use Gemini alone.
