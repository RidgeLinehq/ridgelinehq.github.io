#!/usr/bin/env python3
"""Ridgeline AI check gateway (runs in GitHub Actions; keys live in repo secrets only).

A job file office/gw/jobs/<id>.json = {"id": "...", "queries": [{"key": "cabot-ar-roofing",
"question": "Who are the best roofers in Cabot, AR?", "city": "Cabot", "region": "Arkansas"}]}
produces office/gw/out/<id>.json with, per query, what ChatGPT (OpenAI API + web search) and
Gemini (Gemini API, Google Search grounding when the key's plan allows it) actually answered.

Privacy: questions are town-level ("best roofers in Cabot"), never about a named lead, so the
public repo holds no prospect list. Keys are never printed. Stdlib only.
"""
import json, os, sys, time, urllib.request, urllib.error

OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")
GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
OPENAI_MODELS = [m for m in [os.environ.get("OPENAI_MODEL", "")] if m] + ["gpt-5.5-mini", "gpt-5.5", "gpt-5-mini", "gpt-4.1-mini"]
GEMINI_MODELS = [m for m in [os.environ.get("GEMINI_MODEL", "")] if m] + ["gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash"]
STYLE = " Answer the way you would for a homeowner: name the specific local companies you'd recommend and why. Keep it under 200 words."


def post(url, body, headers, timeout=90):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST", headers={"content-type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"error": {"message": f"HTTP {e.code}"}}
    except Exception as e:
        return 0, {"error": {"message": f"{e.__class__.__name__}: {e}"}}


def err(d):
    e = d.get("error") if isinstance(d, dict) else None
    return (e.get("message") if isinstance(e, dict) else str(e or d))[:300]


def ask_openai(q):
    if not OPENAI_KEY:
        return {"ok": False, "error": "OPENAI_API_KEY secret is missing"}
    tool = {"type": "web_search", "user_location": {"type": "approximate", "country": "US", "city": q.get("city", ""), "region": q.get("region", ""), "timezone": "America/Chicago"}}
    last = ""
    for model in OPENAI_MODELS:
        code, d = post("https://api.openai.com/v1/responses", {"model": model, "tools": [tool], "input": q["question"] + STYLE},
                       {"authorization": f"Bearer {OPENAI_KEY}"})
        if code == 200:
            text, cites = "", []
            for item in d.get("output", []):
                if item.get("type") == "message":
                    for c in item.get("content", []):
                        text += c.get("text", "")
                        cites += [{"url": a.get("url"), "title": a.get("title")} for a in c.get("annotations", []) if a.get("type") == "url_citation"]
            return {"ok": True, "model": model, "web_search": True, "text": text.strip(), "sources": cites[:10]}
        last = f"{model}: {code} {err(d)}"
        if code in (401, 429) or "quota" in last.lower() or "billing" in last.lower():
            break
    return {"ok": False, "error": last}


def ask_gemini(q):
    if not GEMINI_KEY:
        return {"ok": False, "error": "GEMINI_API_KEY secret is missing"}
    last = ""
    for model in GEMINI_MODELS:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        for grounded in (True, False):
            body = {"contents": [{"parts": [{"text": q["question"] + STYLE}]}]}
            if grounded:
                body["tools"] = [{"google_search": {}}]
            code, d = post(url, body, {"x-goog-api-key": GEMINI_KEY})
            if code == 200:
                cand = (d.get("candidates") or [{}])[0]
                text = "".join(p.get("text", "") for p in (cand.get("content") or {}).get("parts", []))
                gm = cand.get("groundingMetadata") or {}
                cites = [{"url": (c.get("web") or {}).get("uri"), "title": (c.get("web") or {}).get("title")} for c in gm.get("groundingChunks", [])]
                return {"ok": True, "model": model, "google_search": grounded, "text": text.strip(), "sources": cites[:10],
                        "note": "" if grounded else "Google Search grounding not available on this key's plan; answer is from the model alone"}
            last = f"{model} (grounded={grounded}): {code} {err(d)}"
            if code in (401, 403) and "API key" in last:
                return {"ok": False, "error": last}
    return {"ok": False, "error": last}


def main(job_path, out_dir):
    job = json.load(open(job_path))
    out = {"id": job.get("id"), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "results": []}
    for q in job.get("queries", [])[:12]:
        out["results"].append({"key": q.get("key"), "question": q["question"], "chatgpt": ask_openai(q), "gemini": ask_gemini(q)})
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, os.path.basename(job_path))
    json.dump(out, open(path, "w"), indent=1)
    oks = sum(r["chatgpt"]["ok"] for r in out["results"]), sum(r["gemini"]["ok"] for r in out["results"])
    print(f"{path}: {len(out['results'])} queries, chatgpt ok {oks[0]}, gemini ok {oks[1]}")
    if out["results"] and oks[0] == 0 and oks[1] == 0:
        print("BOTH TOOLS FAILED on every query:", out["results"][0]["chatgpt"].get("error"), "|", out["results"][0]["gemini"].get("error"))
        return 2
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--selftest":
        print("keys present:", {"openai": bool(OPENAI_KEY), "gemini": bool(GEMINI_KEY)})
        sys.exit(0)
    sys.exit(main(sys.argv[1], sys.argv[2]))
