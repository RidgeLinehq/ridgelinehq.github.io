#!/usr/bin/env python3
"""Catch bad prospect emails BEFORE we send (Grayson, Oct 27, 2026: 4+ free checks and
follow-ups bounced in two days, and bounces hurt the Ridgeline Gmail's reputation).

Two layers:
  1. Local, no network (runs anywhere): syntax, obvious domain typos (atnt.net, gmial.com ...),
     and junk addresses (noreply@, example.com, image file names).
  2. MX lookup through the GitHub Action (office/emailcheck): jobs carry DOMAINS ONLY, never a
     full address or a name (this repo is public). Results land in office/emailcheck/out/.

Usage:
  python3 office/tools/email_check.py check someone@atnt.net [more ...]
      -> one JSON line per email: {"email","ok","reason","fix"}; uses any MX result already in
         office/emailcheck/out/ for that domain.
  python3 office/tools/email_check.py job someone@a.com other@b.net
      -> writes office/emailcheck/jobs/<id>.json with the unknown domains; commit + push it, the
         Action answers in office/emailcheck/out/<id>.json in about a minute.
"""
import json, os, re, sys, glob, secrets, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)  # office/
OUT = os.path.join(ROOT, "emailcheck", "out")
JOBS = os.path.join(ROOT, "emailcheck", "jobs")

TYPOS = {
    "atnt.net": "att.net", "att.com": "att.net", "gmial.com": "gmail.com", "gmai.com": "gmail.com",
    "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gamil.com": "gmail.com", "gnail.com": "gmail.com",
    "yahoo.co": "yahoo.com", "yahooo.com": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.con": "yahoo.com",
    "hotmial.com": "hotmail.com", "hotmail.co": "hotmail.com", "hotmai.com": "hotmail.com",
    "outlook.co": "outlook.com", "outlok.com": "outlook.com", "aol.co": "aol.com", "icloud.co": "icloud.com",
    "comcast.com": "comcast.net", "sbcglobal.com": "sbcglobal.net", "bellsouth.com": "bellsouth.net",
}
JUNK_LOCAL = re.compile(r"^(no-?reply|donotreply|do-not-reply|example|test|user|email|name|your\.?email)$", re.I)
JUNK_DOMAIN = re.compile(r"(example\.(com|org|net)|domain\.com|sentry\.io|wixpress\.com|email\.com)$", re.I)
FILE_EXT = re.compile(r"\.(png|jpe?g|gif|webp|svg)$", re.I)
SYNTAX = re.compile(r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$")


def mx_results():
    known = {}
    for f in sorted(glob.glob(os.path.join(OUT, "*.json"))):
        try:
            d = json.load(open(f))
        except Exception:
            continue
        for dom, r in (d.get("domains") or {}).items():
            known[dom.lower()] = r
    return known


def check(email, known=None):
    known = mx_results() if known is None else known
    e = (email or "").strip().strip("<>").strip()
    if not SYNTAX.match(e) or FILE_EXT.search(e):
        return {"email": e, "ok": False, "reason": "not a real email address", "fix": "get the right email on the next call"}
    local, dom = e.rsplit("@", 1)
    dom = dom.lower()
    if dom in TYPOS:
        return {"email": e, "ok": False, "reason": f"typo domain {dom}", "fix": f"probably {local}@{TYPOS[dom]}: confirm on the next call"}
    if JUNK_LOCAL.match(local) or JUNK_DOMAIN.search(dom):
        return {"email": e, "ok": False, "reason": "placeholder or no-reply address", "fix": "get a real inbox on the next call"}
    r = known.get(dom)
    if r is None:
        return {"email": e, "ok": True, "reason": "syntax ok, domain not MX-checked yet", "fix": "", "mx": "unknown"}
    if r.get("mx"):
        return {"email": e, "ok": True, "reason": "domain accepts mail", "fix": "", "mx": "yes"}
    return {"email": e, "ok": False, "reason": f"{dom} can't receive email ({r.get('why','no MX')})", "fix": "get a working email on the next call", "mx": "no"}


def write_job(emails):
    known = mx_results()
    doms = sorted({e.rsplit("@", 1)[1].lower() for e in emails if "@" in e} - set(known))
    if not doms:
        print(json.dumps({"job": None, "note": "all domains already checked"}))
        return
    os.makedirs(JOBS, exist_ok=True)
    jid = "ec-" + datetime.date.today().isoformat() + "-" + secrets.token_hex(2)
    json.dump({"id": jid, "domains": doms}, open(os.path.join(JOBS, jid + ".json"), "w"))
    print(json.dumps({"job": jid, "domains": len(doms), "result": f"office/emailcheck/out/{jid}.json"}))


if __name__ == "__main__":
    if len(sys.argv) < 3 or sys.argv[1] not in ("check", "job"):
        print(__doc__); sys.exit(2)
    if sys.argv[1] == "job":
        write_job(sys.argv[2:])
    else:
        k = mx_results()
        for em in sys.argv[2:]:
            print(json.dumps(check(em, k)))
