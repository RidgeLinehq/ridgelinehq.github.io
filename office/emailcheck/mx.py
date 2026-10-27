#!/usr/bin/env python3
"""Run by the 'Ridgeline email check' Action. Reads office/emailcheck/jobs/*.json that have no
answer yet ({"id","domains":[...]}: domains only, never addresses) and writes
office/emailcheck/out/<id>.json = {"id","at","domains":{<domain>:{"mx":bool,"why":str}}}."""
import json, os, glob, datetime
import dns.resolver

ROOT = os.path.dirname(os.path.abspath(__file__))
for f in sorted(glob.glob(os.path.join(ROOT, "jobs", "*.json"))):
    jid = os.path.basename(f)[:-5]
    out = os.path.join(ROOT, "out", jid + ".json")
    if os.path.exists(out):
        continue
    job = json.load(open(f))
    res = {}
    for d in job.get("domains", [])[:200]:
        d = str(d).lower().strip()
        try:
            ans = dns.resolver.resolve(d, "MX", lifetime=8)
            hosts = [str(r.exchange).rstrip(".") for r in ans if str(r.exchange).strip(".")]
            res[d] = {"mx": bool(hosts), "why": "MX " + hosts[0] if hosts else "null MX"}
        except dns.resolver.NXDOMAIN:
            res[d] = {"mx": False, "why": "domain does not exist"}
        except dns.resolver.NoAnswer:
            try:
                dns.resolver.resolve(d, "A", lifetime=8)
                res[d] = {"mx": True, "why": "no MX but has A record (mail may still work)"}
            except Exception:
                res[d] = {"mx": False, "why": "no MX and no A record"}
        except Exception as e:
            res[d] = {"mx": True, "why": "lookup error, not blocking: " + type(e).__name__}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({"id": jid, "at": datetime.datetime.utcnow().isoformat() + "Z", "domains": res}, open(out, "w"), indent=1)
    print(jid, len(res))
