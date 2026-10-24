#!/usr/bin/env python3
"""Ridgeline Lead Finder: public posts where people ask for a local business recommendation.

Source: the official Reddit Data API (OAuth app-only, read-only search). Only what the API
returns is used: the post's id, link, title, subreddit and time. No usernames, no private
data, no scraping, no posting, no messages. The client decides whether to answer the post.

Job  office/leadfinder/jobs/<id>.json = {"id": "...", "searches": [{"key": "tulsa-ok-barber",
      "town": "Tulsa", "state": "OK", "terms": ["barber", "barbershop", "haircut"],
      "subreddits": ["tulsa"], "days": 7}]}
      (town-level only: never a client's name, so the public repo holds no client list)
Out  office/leadfinder/out/<id>.json = {"id", "at", "source": "reddit", "results":
      [{"key", "posts": [{"id", "url", "title", "subreddit", "created", "why"}], "error"}]}

Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET (a Reddit "script" or "web" app), optional
REDDIT_USER_AGENT. Missing secrets = the out file says "not set up" (no alert; SETUP_NEEDED.md
lists it). An API error with secrets present = exit 1 (the alert fires). Stdlib only.
"""
import base64, glob, json, os, re, sys, time, urllib.parse, urllib.request

CID = os.environ.get("REDDIT_CLIENT_ID", "").strip()
SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
UA = os.environ.get("REDDIT_USER_AGENT", "").strip() or "web:ridgeline-lead-finder:1.0 (by Ridgeline Local)"
ASK = re.compile(r"\b(recommend\w*|suggest\w*|looking for|anyone know|any (good|decent)|best|who do you use|where (can|should|do) i|need (a|an)|can anyone)\b", re.I)
NOT_ASK = re.compile(r"\b(hiring|job opening|we are hiring|for hire|selling|for sale|giveaway|promo code)\b", re.I)


def token():
    req = urllib.request.Request("https://www.reddit.com/api/v1/access_token", method="POST",
                                 data=b"grant_type=client_credentials",
                                 headers={"Authorization": "Basic " + base64.b64encode(f"{CID}:{SECRET}".encode()).decode(), "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())["access_token"]


def get(tok, path, params):
    url = "https://oauth.reddit.com" + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "bearer " + tok, "User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def search(tok, s):
    days = int(s.get("days", 7))
    since = time.time() - days * 86400
    terms = [t for t in s.get("terms", []) if t][:5]
    town = s.get("town", "")
    q = "(" + " OR ".join(f'"{t}"' for t in terms) + ")"
    found = {}
    calls = [("/search", {"q": f'{q} "{town}"', "sort": "new", "t": "month", "limit": 50, "type": "link"})]
    for sub in s.get("subreddits", [])[:3]:
        if re.fullmatch(r"[A-Za-z0-9_]{2,30}", sub):
            calls.append((f"/r/{sub}/search", {"q": q, "restrict_sr": "1", "sort": "new", "t": "month", "limit": 50}))
    for path, params in calls:
        for child in get(tok, path, params).get("data", {}).get("children", []):
            d = child.get("data", {})
            text = (d.get("title", "") + "\n" + d.get("selftext", ""))[:4000]
            if d.get("created_utc", 0) < since or d.get("over_18"):
                continue
            if not any(t.lower() in text.lower() for t in terms):
                continue
            if not ASK.search(text) or NOT_ASK.search(text):
                continue
            in_town = town.lower() in text.lower() or d.get("subreddit", "").lower() in [x.lower() for x in s.get("subreddits", [])]
            if not in_town:
                continue
            found[d["id"]] = {"id": d["id"], "url": "https://www.reddit.com" + d.get("permalink", ""), "title": d.get("title", "")[:200],
                              "subreddit": d.get("subreddit", ""), "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(d.get("created_utc", 0))),
                              "why": "asks for a recommendation"}
        time.sleep(1.1)  # stay far under Reddit's rate limit
    return sorted(found.values(), key=lambda p: p["created"], reverse=True)[:15]


def main():
    bad = 0
    for f in sorted(glob.glob("office/leadfinder/jobs/*.json")):
        out = "office/leadfinder/out/" + os.path.basename(f)
        if os.path.exists(out):
            continue
        job = json.load(open(f))
        res = {"id": job.get("id"), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "reddit", "results": []}
        if not (CID and SECRET):
            res["note"] = "not set up: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET secrets are missing (SETUP_NEEDED.md)"
        else:
            try:
                tok = token()
                for s in job.get("searches", [])[:10]:
                    try:
                        res["results"].append({"key": s.get("key"), "posts": search(tok, s)})
                    except Exception as e:
                        bad = 1
                        res["results"].append({"key": s.get("key"), "posts": [], "error": f"{e.__class__.__name__}: {str(e)[:200]}"})
            except Exception as e:
                bad = 1
                res["error"] = f"token: {e.__class__.__name__}: {str(e)[:200]}"
        json.dump(res, open(out, "w"), indent=1)
        print(out, "posts:", sum(len(r["posts"]) for r in res["results"]), res.get("note", ""), res.get("error", ""))
    return bad


if __name__ == "__main__":
    sys.exit(main())
