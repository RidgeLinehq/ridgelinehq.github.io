#!/usr/bin/env python3
"""Call desk numbers for the crew: the same rules the office page uses for cold call sessions.

  stock: how many call-ready leads each niche has in each town, and what Scout should fill today
         python3 office/tools/call_desk.py stock <leads dir> [--towns "Owasso,OK;Cabot,AR"] [--min 25]
  stats: what's working on calls (by niche, town, pitch line, hour), for Sage and callstats/main
         python3 office/tools/call_desk.py stats <leads dir> [--json]

<leads dir> = the folder ArtifactData wrote with out_dir (it holds leads/<id>.json, or the files
directly). Reads only; writes nothing. Niches and outcomes come from office/call_kit/kit.json.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
KIT = os.path.join(HERE, "..", "call_kit", "kit.json")

NEVER_STATUSES = {"Suppressed", "Not a fit", "Client"}
DONE_CALL_STATUSES = {"Sold", "Not interested", "Do not contact"}
WIN = {"Interested", "Sold"}
NO_TALK = {"No answer", "Voicemail"}


def load_kit(path=KIT):
    with open(path) as f:
        return json.load(f)


def load_leads(folder):
    files = glob.glob(os.path.join(folder, "leads", "*.json")) or glob.glob(os.path.join(folder, "*.json"))
    out = []
    for f in sorted(files):
        try:
            with open(f) as fh:
                d = json.load(fh)
        except (OSError, ValueError):
            continue
        if isinstance(d, dict) and isinstance(d.get("data"), dict) and "businessName" not in d:
            d = d["data"]
        d.setdefault("id", os.path.splitext(os.path.basename(f))[0])
        out.append(d)
    return out


def niche_of(lead, niches):
    """The lead's niche id: lead.niche when set, else the first niche whose words match its trade
    (then its business name). None when nothing matches."""
    ids = {n["id"] for n in niches}
    if lead.get("niche") in ids:
        return lead["niche"]
    for field in ("trade", "businessName"):
        text = str(lead.get(field) or "").lower()
        for n in niches:
            if any(re.search(r"\b" + re.escape(w), text) for w in n.get("match", [])):
                return n["id"]
    return None


def parse_t(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def central_day(t):
    try:
        from zoneinfo import ZoneInfo
        return t.astimezone(ZoneInfo("America/Chicago")).date()
    except Exception:  # no tz database: CDT is close enough for a day key
        return (t - dt.timedelta(hours=5)).date()


def call_status(lead):
    """Same as the page's callStatusOf(): Grayson's call word, derived for leads from before Oct 26."""
    if lead.get("callStatus"):
        return lead["callStatus"]
    if lead.get("status") == "Suppressed":
        return "Do not contact"
    if lead.get("status") == "Client":
        return "Sold"
    calls = lead.get("calls") or []
    last = canon_outcome(calls[-1].get("outcome")) if calls else ""
    if last == "Not interested" or (lead.get("followUp") or {}).get("kind") == "close_lead":
        return "Not interested"
    if last in ("Interested", "Sold", "Callback", "Voicemail", "Do not contact"):
        return last
    return "Called" if calls else "New"


def callable_lead(lead, now):
    """Same test as the page's sessionEligible(): a published phone, not test, not closed, due today."""
    if lead.get("test") is True or not lead.get("phone"):
        return False
    status = lead.get("status") or "New"
    if status in NEVER_STATUSES:
        return False
    cs = call_status(lead)
    if cs in DONE_CALL_STATUSES or (cs == "Interested" and not lead.get("nextCallAt")):
        return False
    if lead.get("callDone") is True or (lead.get("followUp") or {}).get("kind") == "close_lead":
        return False
    nx = parse_t(lead.get("nextCallAt")) if lead.get("nextCallAt") else None
    if nx and central_day(nx) > central_day(now):
        return False
    if status == "Contacted":
        ts = [parse_t(t.get("t")) for t in lead.get("touches") or [] if isinstance(t, dict) and t.get("t")]
        ts = [t for t in ts if t]
        if ts and now - max(ts) < dt.timedelta(days=2):
            return False
    return True


def town_key(lead):
    return "%s, %s" % (lead.get("town") or "?", lead.get("state") or "?")


def stock(leads, niches, now, towns=None, minimum=25):
    table = {}
    for l in leads:
        n = niche_of(l, niches)
        if not n or not callable_lead(l, now):
            continue
        k = (n, town_key(l))
        row = table.setdefault(k, {"callable": 0, "fresh": 0})
        row["callable"] += 1
        if not l.get("calls"):
            row["fresh"] += 1
    per_niche = {n["id"]: 0 for n in niches}
    best_town = {}
    for (n, t), row in table.items():
        per_niche[n] = per_niche.get(n, 0) + row["callable"]
        if row["callable"] > best_town.get(n, ("", -1))[1]:
            best_town[n] = (t, row["callable"])
    # The fill plan: every niche whose best town is under the minimum, biggest gap first.
    town_list = towns or sorted({t for (_, t) in table}) or []
    plan = []
    for i, n in enumerate(niches):
        # A niche with no leads yet gets the target towns in turn, so the stock spreads out.
        t, have = best_town.get(n["id"], (town_list[i % len(town_list)] if town_list else "", 0))
        if have < minimum:
            plan.append({"niche": n["id"], "label": n["label"], "town": t, "have": have, "need": minimum - have})
    plan.sort(key=lambda p: (-p["need"], p["niche"]))
    return {"table": {"%s|%s" % k: v for k, v in sorted(table.items())}, "perNiche": per_niche,
            "bestTown": {k: {"town": v[0], "callable": v[1]} for k, v in best_town.items()},
            "plan": plan, "minimum": minimum}


def smoothed(wins, calls, a=1.0, b=9.0):
    return (wins + a) / (calls + a + b)


def stats(leads, niches):
    def bump(bucket, key, outcome):
        r = bucket.setdefault(key or "unknown", {"calls": 0, "talked": 0, "interested": 0, "sold": 0})
        r["calls"] += 1
        if outcome not in NO_TALK:
            r["talked"] += 1
        if outcome == "Interested":
            r["interested"] += 1
        if outcome == "Sold":
            r["sold"] += 1

    by = {"niche": {}, "town": {}, "pitchLine": {}, "hour": {}}
    total = 0
    for l in leads:
        if l.get("test") is True:
            continue
        n = niche_of(l, niches)
        for c in l.get("calls") or []:
            outcome = canon_outcome(c.get("outcome"))
            if not outcome:
                continue
            total += 1
            bump(by["niche"], c.get("niche") or n, outcome)
            bump(by["town"], c.get("town") or town_key(l), outcome)
            bump(by["pitchLine"], c.get("pitchLine"), outcome)
            t = parse_t(c.get("t"))
            if t:
                ct = t.astimezone(dt.timezone(dt.timedelta(hours=-5)))  # Central (CDT); close enough for hour buckets
                bump(by["hour"], "%02d" % ct.hour, outcome)
    for bucket in by.values():
        for r in bucket.values():
            wins = r["interested"] + r["sold"]
            r["winRate"] = round(100.0 * wins / r["calls"], 1) if r["calls"] else 0.0
            r["score"] = round(smoothed(wins, r["calls"]), 4)
    order = sorted((n["id"] for n in niches), key=lambda i: -(by["niche"].get(i, {}).get("score", smoothed(0, 0))))
    lines = [k for k, r in by["pitchLine"].items() if k != "unknown" and r["calls"] >= 10]
    best_line = max(lines, key=lambda k: by["pitchLine"][k]["score"]) if lines else None
    return {"calls": total, "byNiche": by["niche"], "byTown": by["town"], "byLine": by["pitchLine"],
            "byHour": by["hour"], "nicheOrder": order, "bestLine": best_line,
            "tooEarly": total < 20}


def canon_outcome(o):
    """Old page logs used lower-case words ('no answer', 'interested'); map them to the labels."""
    m = {"no answer": "No answer", "voicemail": "Voicemail", "call back": "Callback", "callback": "Callback",
         "interested": "Interested", "sold": "Sold", "not interested": "Not interested",
         "do not call": "Do not contact", "do not contact": "Do not contact", "answered": "Called",
         "send the free check": "Interested"}
    s = str(o or "").strip()
    return m.get(s.lower(), s) if s else None


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["stock", "stats"])
    ap.add_argument("leads_dir")
    ap.add_argument("--towns", default="", help='"Owasso,OK;Cabot,AR" (settings.targets)')
    ap.add_argument("--min", type=int, default=None)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--kit", default=KIT)
    a = ap.parse_args(argv)
    kit = load_kit(a.kit)
    niches = kit.get("niches") or []
    leads = load_leads(a.leads_dir)
    now = dt.datetime.now(dt.timezone.utc)
    if a.cmd == "stock":
        towns = [", ".join(p.strip() for p in t.split(",")) for t in a.towns.split(";") if t.strip()]
        r = stock(leads, niches, now, towns, a.min or (kit.get("rules") or {}).get("session_min_leads", 25))
        if a.json:
            print(json.dumps(r, indent=1))
            return 0
        print("Call-ready leads per niche (best town), minimum %d:" % r["minimum"])
        for n in niches:
            bt = r["bestTown"].get(n["id"], {})
            print("  %-18s %3d total · best %s (%d)" % (n["label"], r["perNiche"].get(n["id"], 0), bt.get("town", "-"), bt.get("callable", 0)))
        print("Fill today (biggest gap first):")
        for p in r["plan"]:
            print("  %s in %s: have %d, need %d more" % (p["label"], p["town"] or "(pick a target town)", p["have"], p["need"]))
        return 0
    r = stats(leads, niches)
    if a.json:
        print(json.dumps(r, indent=1))
        return 0
    print("Calls logged: %d%s" % (r["calls"], " (under 20: too early for a lesson)" if r["tooEarly"] else ""))
    for name, key in (("Niche", "byNiche"), ("Town", "byTown"), ("Pitch line", "byLine"), ("Hour (Central)", "byHour")):
        print(name + ":")
        for k, v in sorted(r[key].items(), key=lambda kv: -kv[1]["score"]):
            print("  %-22s %3d calls · %d talked · %d interested · %d sold · %.1f%%" % (k, v["calls"], v["talked"], v["interested"], v["sold"], v["winRate"]))
    print("Niche order (best first):", ", ".join(r["nicheOrder"]))
    print("Best pitch line:", r["bestLine"] or "not enough calls yet (10+ per line)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
