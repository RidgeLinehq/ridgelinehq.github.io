#!/usr/bin/env python3
"""AI visibility score for one business, from AI check gateway output (office/gw/out/*.json).

The score is the one written on guarantee.html, so it must stay exactly this:
  for each answer (ChatGPT and Gemini, for each of the client's 3 questions = 6 answers):
    1 point   if the business is named among the first three businesses the answer mentions
    0.5 point if it is named further down
    0         if it is not named, or the tool errored (an errored answer still counts in the 6)
  score = round(points / answers * 100)

Usage:
  python3 office/tools/ai_score.py --name "Main St. Barbershop" --keys k1,k2,k3 office/gw/out/<file>.json [more files]
  -> prints JSON {score, points, answers, detail:[{key, tool, named, rank, competitors}]}
A key missing from every file is an error (exit 2): never score from partial data.
"""
import argparse, json, re, sys

GENERIC = {"the", "a", "an", "and", "&", "of", "llc", "inc", "co", "company", "corp", "ltd", "services", "service",
           "group", "pllc", "pc", "dds", "md"}


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9&' ]+", " ", s.lower().replace("’", "'"))).strip()


def name_variants(name):
    n = norm(name)
    words = [w for w in n.split() if w not in GENERIC]
    v = {n}
    if len(words) >= 2:
        v.add(" ".join(words[:2]))
    elif words:
        v.add(words[0]) if len(words[0]) >= 6 else None
    return [x for x in v if x]


def entries(text):
    """The businesses an answer lists, in order: numbered/bulleted lines first, else bold names."""
    out = []
    for line in text.splitlines():
        m = re.match(r"\s*(?:\d+[.)]|[-*•])\s+(.*)", line)
        if m:
            out.append(m.group(1))
    if len(out) < 2:
        bold = re.findall(r"\*\*([^*]{2,80})\*\*", text)
        if len(bold) >= 2:
            out = bold
    return out


def rank_of(text, variants):
    t = norm(text)
    if not any(v in t for v in variants):
        return None
    for i, e in enumerate(entries(text), 1):
        if any(v in norm(e) for v in variants):
            return i
    return 99  # named, but not as one of the listed businesses


def competitors(text, variants):
    names = []
    for e in entries(text):
        head = re.split(r"\s[—–-]\s|:|\(|,", re.sub(r"\*\*", "", e))[0].strip()
        if head and not any(v in norm(head) for v in variants) and len(head) < 70:
            names.append(head)
    return names[:5]


def score(name, keys, files):
    variants = name_variants(name)
    results = {}
    for f in files:
        for r in json.load(open(f)).get("results", []):
            results[r.get("key")] = r
    missing = [k for k in keys if k not in results]
    if missing:
        raise SystemExit(json.dumps({"error": "missing keys", "missing": missing}))
    detail, points = [], 0.0
    for k in keys:
        for tool in ("chatgpt", "gemini"):
            a = results[k].get(tool) or {}
            rank = rank_of(a.get("text", ""), variants) if a.get("ok") else None
            p = 0.0 if rank is None else (1.0 if rank <= 3 else 0.5)
            points += p
            detail.append({"key": k, "tool": tool, "ok": bool(a.get("ok")), "named": rank is not None, "rank": rank,
                           "points": p, "competitors": competitors(a.get("text", ""), variants) if a.get("ok") else []})
    answers = len(keys) * 2
    return {"name": name, "score": round(points / answers * 100), "points": points, "answers": answers, "detail": detail}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--keys", required=True)
    ap.add_argument("files", nargs="+")
    a = ap.parse_args()
    try:
        print(json.dumps(score(a.name, [k for k in a.keys.split(",") if k], a.files), indent=1))
    except SystemExit as e:
        print(e.code if isinstance(e.code, str) else e, file=sys.stderr)
        sys.exit(2)
