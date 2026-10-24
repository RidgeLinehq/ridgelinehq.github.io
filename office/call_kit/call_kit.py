#!/usr/bin/env python3
"""Ridgeline Cold Call Kit (V8 "The Turning Point", Oct 24, 2026).

Builds today's call list and the words Grayson says, for the Office page's "Calls" screen and
for Quinn (Day Shift stage 02). Stdlib only. The repo is PUBLIC, so this file never writes a
lead, a phone number or a name into the repo: the list is built from a LOCAL folder of lead
documents (ArtifactData out_dir shape, {"id", "data", "version"}) and written to a LOCAL file.

Usage
  python3 office/call_kit/call_kit.py --kit                      # print kit.json (script, objections, outcomes, rules)
  python3 office/call_kit/call_kit.py --leads <dir> [--out f]    # build today's call list from local lead JSON files
  python3 office/call_kit/call_kit.py --rank <dir> [--out f]     # the per-lead fields Quinn writes back (callRank, callWindow, aiResultLine)
  python3 office/call_kit/call_kit.py --selftest

The page ports the same rules in JavaScript (CALL_KIT in the office page) and reads kit.json
from https://ridgelinehq.github.io/office/call_kit/kit.json so the words have one home.
"""
import argparse, datetime as dt, glob, json, os, re, sys

VERSION = "8.0"

# ---- the words (Christian-honest tone: true, kind, no pressure, no made-up claims) ----
SCRIPT = {
    "opener": ("Hi, is this {owner_or_business}? This is Grayson with Ridgeline Local. "
               "I'll be quick. I ran a free check on how {business} shows up when people ask "
               "ChatGPT and Google's AI for a {trade} in {town}. Got 30 seconds?"),
    "value":  ("Right now when someone asks for a {trade} in {town}, the AI recommends "
               "{competitor_or_others} and {business} {ai_result}. We fix that: your Google "
               "profile, reviews and site details, so the AI starts recommending you."),
    "close":  ("Can I email you the free one-page report so you can see it yourself? "
               "No cost, no pressure."),
}

OBJECTIONS = {
    "Not interested":     "Totally fair. Can I still send the free report? If it's not useful, just delete it.",
    "We get enough work": "That's great to hear. This just makes sure the AI keeps sending people your way as more folks search that way.",
    "How much is it?":    "The check is free. If you want it done for you, it's $147 a month for the first three months, then $197, month to month, cancel by email. If you don't gain 15 real Google reviews in 60 days, the third month is free. Let me send the check first so you only pay for what you actually need.",
    "Is this a scam?":    "Fair question. I'll email the report from ridgelinemarketinghq@gmail.com and you can check it against ChatGPT yourself.",
    "How did you find me?": "Your website or your Google listing. I only work with a few local businesses at a time, and {town} is one of the towns I'm calling.",
    "Call me later":      "No problem. What's a better day and time? I'll put it down.",
    "Don't call again":   "Understood, I won't. Have a good one.",
}

# Tap a button on the page; the crew does the follow-up automatically (reply desk, Lane G).
OUTCOMES = {
    "no_answer":      {"label": "No answer",            "next": "retry_call", "after_days": 1, "max_tries": 3,
                       "then": "A second and third try on the next two call days; after 3 misses the lead stays on email only."},
    "not_interested": {"label": "Not interested",       "next": "close_lead",
                       "then": "Status Not a fit. No more calls or emails."},
    "call_back":      {"label": "Call back",            "next": "schedule_call", "ask": "when",
                       "then": "Back on the list at the time you pick."},
    "send_check":     {"label": "Send the free check",  "next": "email_ai_check", "template": "after_call_report", "ask": "email",
                       "then": "The reply desk runs the real ChatGPT + Gemini check and emails the one-page report within 2 hours."},
    "interested":     {"label": "Interested",           "next": "email_ai_check_plus_offer", "template": "after_call_offer", "ask": "email",
                       "alert_grayson": True,
                       "then": "The desk sends the report plus the founding offer and payment link, and tells you when it went out."},
    "do_not_call":    {"label": "Do not call",          "next": "suppress",
                       "then": "Suppressed the same minute. Never contacted again."},
}

RULES = {
    "list_size": 15,
    "skip_if_emailed_within_days": 2,
    "eligible_statuses": ["New", "Researching", "Qualified", "Contacted"],
    "never_statuses": ["Suppressed", "Not a fit", "Client", "Meeting", "Replied"],
    "legal": ["Dial by hand to the business's published number only.", "8 AM to 8 PM their time.",
              "Honor 'don't call again' at once (suppression).", "Never a recorded voicemail, never a text."],
}

JOB_SITE_TRADES = {"roofer", "roofing", "tree service", "tree services", "landscaper", "landscaping", "contractor",
                   "stump grinding", "tree removal", "construction", "fencing", "concrete", "painter", "painting"}


def best_call_time(trade):
    """Trades are on job sites midday: call early or late."""
    t = (trade or "").strip().lower()
    return "7:30-8:30 AM or 4:30-6 PM" if t in JOB_SITE_TRADES else "10-11:30 AM or 2-4 PM"


def trade_word(trade):
    t = (trade or "").strip().lower()
    return {"roofing": "roofer", "tree service": "tree service", "other": "business", "": "business"}.get(t, t)


def tel_link(phone):
    digits = "".join(c for c in (phone or "") if c.isdigit())
    if len(digits) == 10:
        digits = "1" + digits
    return "tel:+" + digits if digits else ""


def ai_result(lead):
    """One honest line from the gateway AI check. Unknown stays unknown."""
    ai = lead.get("aiCheck") or {}
    g, m = ai.get("chatgpt"), ai.get("gemini")
    if g == "not named" and m == "not named":
        return "isn't mentioned by ChatGPT or Gemini"
    if g == "not named" and m == "named":
        return "isn't mentioned by ChatGPT (Gemini names them)"
    if g == "named" and m == "not named":
        return "isn't mentioned by Gemini (ChatGPT names them)"
    if g == "not named":
        return "isn't mentioned by ChatGPT"
    if m == "not named":
        return "isn't mentioned by Gemini"
    if g == "named" and m == "named":
        return "is named by both (weak target)"
    if g == "named" or m == "named":
        return "is named by " + ("ChatGPT" if g == "named" else "Gemini")
    return "AI check not run yet"


def ai_rank_key(lead):
    """0 = not named by both (best target) ... 3 = named by both."""
    ai = lead.get("aiCheck") or {}
    g, m = ai.get("chatgpt"), ai.get("gemini")
    named = (g == "named") + (m == "named")
    notnamed = (g == "not named") + (m == "not named")
    if notnamed == 2: return 0
    if notnamed == 1 and named == 0: return 1
    if named == 0: return 2          # unknown
    if named == 1: return 3
    return 4


def _parse(iso):
    try:
        return dt.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except Exception:
        return None


def eligible(lead, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if lead.get("test") is True or not lead.get("phone"):
        return False
    st = lead.get("status") or "New"
    if st in RULES["never_statuses"] or st not in RULES["eligible_statuses"]:
        return False
    fu = lead.get("followUp") or {}
    if fu.get("kind") == "close_lead" or lead.get("callDone") is True:
        return False
    if st == "Contacted":
        touches = lead.get("touches") or []
        last = max((_parse(t.get("t")) for t in touches if _parse(t.get("t"))), default=None)
        if last and (now - last).days < RULES["skip_if_emailed_within_days"]:
            return False
    nxt = _parse(lead.get("nextCallAt"))
    if nxt and nxt > now + dt.timedelta(hours=12):
        return False          # call back later than today: not on today's list
    return True


def sort_key(lead):
    p = lead.get("profile") or {}
    nxt = _parse(lead.get("nextCallAt"))
    return (
        0 if nxt else 1,                                   # scheduled call-backs first
        ai_rank_key(lead),                                 # not named by AI first
        lead.get("callRank") if isinstance(lead.get("callRank"), int) else 999,
        -(lead.get("score") or 0),
        (p.get("reviews") if isinstance(p.get("reviews"), (int, float)) else 10**6),
    )


def competitor_phrase(lead):
    ai = lead.get("aiCheck") or {}
    comp = ai.get("competitors")
    if isinstance(comp, dict):
        comp = (comp.get("chatgpt") or comp.get("gemini") or [])
    if isinstance(comp, list) and comp:
        names = [str(c).split(" / ")[0].split(" (")[0].strip() for c in comp if c][:2]
        if names:
            return " and ".join(names)
    sc = lead.get("searchCheck") or {}
    top = sc.get("namedTop3") or []
    if top:
        return " and ".join(str(x).split(" (")[0].strip() for x in top[:2])
    return "other companies"


def fill_script(lead):
    biz = lead.get("businessName") or ""
    ctx = {
        "owner_or_business": lead.get("contactName") or biz,
        "business": biz,
        "trade": trade_word(lead.get("trade")),
        "town": lead.get("town") or "",
        "competitor_or_others": competitor_phrase(lead),
        "ai_result": ai_result(lead),
    }
    return {k: v.format(**ctx) for k, v in SCRIPT.items()}


def call_row(lead):
    tries = len([c for c in (lead.get("calls") or []) if c.get("outcome") in ("no answer", "no_answer", "voicemail")])
    return {
        "id": lead.get("id"),
        "business": lead.get("businessName"),
        "owner": lead.get("contactName") or None,
        "trade": lead.get("trade"),
        "town": lead.get("town"), "state": lead.get("state"),
        "phone": lead.get("phone"), "tel_link": tel_link(lead.get("phone")),
        "email": lead.get("contactEmail") or None,
        "ai_result_line": ai_result(lead),
        "best_time": lead.get("callWindow") or best_call_time(lead.get("trade")),
        "status": lead.get("status"),
        "score": lead.get("score"),
        "tries": tries,
        "nextCallAt": lead.get("nextCallAt"),
        "script": fill_script(lead),
    }


def load_leads(dirpath):
    out = []
    for f in sorted(glob.glob(os.path.join(dirpath, "*.json"))):
        try:
            d = json.load(open(f, encoding="utf-8"))
        except Exception:
            continue
        lead = d.get("data", d) if isinstance(d, dict) else None
        if not isinstance(lead, dict):
            continue
        lead = dict(lead)
        lead.setdefault("id", d.get("id") or os.path.splitext(os.path.basename(f))[0])
        out.append(lead)
    return out


def build_call_list(leads, limit=None, now=None):
    limit = limit or RULES["list_size"]
    ranked = sorted((l for l in leads if eligible(l, now)), key=sort_key)
    rows = [call_row(l) for l in ranked[:limit]]
    return {"version": VERSION, "date": str(dt.date.today()), "calls": rows,
            "eligible": len(ranked), "objections": OBJECTIONS, "outcomes": OUTCOMES, "rules": RULES}


def rank_updates(leads, now=None):
    """What Quinn writes back on each eligible lead (stage 02 step 6)."""
    ranked = sorted((l for l in leads if eligible(l, now)), key=sort_key)
    return [{"id": l.get("id"), "callRank": i + 1, "callWindow": best_call_time(l.get("trade")),
             "aiResultLine": ai_result(l)} for i, l in enumerate(ranked)]


def kit():
    return {"version": VERSION, "script": SCRIPT, "objections": OBJECTIONS, "outcomes": OUTCOMES, "rules": RULES}


def selftest():
    now = dt.datetime(2026, 10, 25, 13, 0, tzinfo=dt.timezone.utc)
    a = {"id": "a", "businessName": "Dads Roofing", "trade": "roofing", "town": "Foley", "state": "AL", "phone": "(251) 555-0100",
         "status": "Qualified", "score": 35, "aiCheck": {"chatgpt": "not named", "gemini": "not named", "competitors": ["Acme Roofing", "Best Roof Co"]}}
    b = {"id": "b", "businessName": "Named Co", "trade": "tree service", "town": "Foley", "state": "AL", "phone": "2515550101",
         "status": "Researching", "score": 30, "aiCheck": {"chatgpt": "named", "gemini": "named"}}
    c = {"id": "c", "businessName": "No Phone", "trade": "roofing", "town": "Foley", "state": "AL", "status": "Qualified", "score": 80}
    d = {"id": "d", "businessName": "Just Emailed", "trade": "roofing", "town": "Owasso", "state": "OK", "phone": "9185550102",
         "status": "Contacted", "touches": [{"t": "2026-10-25T12:00:00Z"}]}
    e = {"id": "e", "businessName": "Suppressed", "trade": "roofing", "town": "Owasso", "state": "OK", "phone": "9185550103", "status": "Suppressed"}
    f = {"id": "f", "businessName": "Call back", "trade": "roofing", "town": "Owasso", "state": "OK", "phone": "9185550104",
         "status": "Researching", "nextCallAt": "2026-10-25T21:30:00Z"}
    out = build_call_list([a, b, c, d, e, f], now=now)
    ids = [r["id"] for r in out["calls"]]
    assert ids == ["f", "a", "b"], ids
    assert out["calls"][1]["tel_link"] == "tel:+12515550100"
    s = out["calls"][1]["script"]
    assert "Dads Roofing isn't mentioned by ChatGPT or Gemini" in s["value"] and "Acme Roofing and Best Roof Co" in s["value"], s
    assert out["calls"][1]["best_time"] == "7:30-8:30 AM or 4:30-6 PM"
    assert best_call_time("barber") == "10-11:30 AM or 2-4 PM"
    assert ai_result({}) == "AI check not run yet"
    assert rank_updates([a, b], now=now)[0]["callRank"] == 1
    json.dumps(kit())
    print("call_kit selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kit", action="store_true")
    ap.add_argument("--leads", help="folder of lead JSON files (ArtifactData out_dir)")
    ap.add_argument("--rank", help="folder of lead JSON files; prints Quinn's write-back rows")
    ap.add_argument("--out", help="write the result here instead of stdout (keep it OUT of the repo)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.kit:
        res = kit()
    elif a.leads:
        res = build_call_list(load_leads(a.leads), a.limit)
    elif a.rank:
        res = rank_updates(load_leads(a.rank))
    else:
        ap.print_help(); return
    text = json.dumps(res, indent=1, ensure_ascii=False)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        open(a.out, "w", encoding="utf-8").write(text)
        print(a.out)
    else:
        print(text)


if __name__ == "__main__":
    main()
