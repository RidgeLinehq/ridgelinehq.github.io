#!/usr/bin/env python3
"""Build a Pro client's lead page: office/landing/<slug>.json -> p/<slug>/index.html.

Input (public facts only, the client approved them in onboarding):
{"slug": "mainst-barber-tulsa", "business": "Main St. Barbershop", "town": "Tulsa", "state": "OK",
 "phone": "(918) 555-0100", "services": ["Haircuts", "Beard trims"], "about": "One or two plain sentences.",
 "leadEmail": "owner@business.com", "hours": "Tue-Sat 9-6" }
The form posts to the Ridgeline inbox (FormSubmit) with subject "Lead for <slug> — <business>" and a copy
to leadEmail, so the owner gets it at once and the reply desk logs it. Tracking link: /p/<slug>/?src=<source>;
the src value is sent with the lead so we know where it came from.
Usage: python3 office/tools/make_landing.py office/landing/<slug>.json
"""
import html, json, os, re, sys

TPL = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{biz} — {town}, {state}</title>
<meta name="description" content="{biz} in {town}, {state}: {svc_line}. Call {phone} or send a request.">
<link rel="canonical" href="https://ridgelinehq.github.io/p/{slug}/">
<style>
:root{{--forest:#142f27;--ink:#15271f;--ivory:#f5f1e6;--white:#fffdf8;--brass:#d2b375;--muted:#5a6a60;--line:#e3ded0}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--white);color:var(--ink);font:17px/1.6 system-ui,-apple-system,"Segoe UI",Arial,sans-serif}}
.wrap{{width:min(640px,calc(100% - 32px));margin-inline:auto}}
header{{background:var(--forest);color:#fff;padding:40px 0 34px}}
h1{{font-size:clamp(1.9rem,7vw,2.6rem);line-height:1.08;margin:0 0 8px;letter-spacing:-.02em}}
header p{{margin:0;color:#cfd9cf}}
.call{{display:flex;justify-content:center;align-items:center;min-height:56px;margin-top:20px;border-radius:12px;background:var(--brass);color:var(--forest);font-weight:700;text-decoration:none;font-size:1.1rem}}
main{{padding:28px 0 48px}}
ul.svc{{padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:8px;margin:0 0 22px}}ul.svc li{{padding:7px 12px;border:1px solid var(--line);border-radius:20px;background:var(--ivory);font-size:.92rem}}
form{{padding:22px;border:1px solid var(--line);border-radius:16px;background:#fff}}
h2{{margin:0 0 4px;font-size:1.35rem}}label{{display:block;font-weight:600;font-size:.88rem;margin:14px 0 5px}}
input,textarea{{width:100%;min-height:50px;padding:12px;border:1px solid #b9b3a1;border-radius:9px;font:inherit}}textarea{{min-height:100px}}
button{{width:100%;min-height:54px;margin-top:18px;border:0;border-radius:10px;background:var(--forest);color:#fff;font:700 1.05rem system-ui,sans-serif}}
.ok{{display:none;padding:20px;border-radius:14px;background:#e9eee3}}.small{{font-size:.82rem;color:var(--muted);margin-top:24px}}
</style></head><body>
<header><div class="wrap"><h1>{biz}</h1><p>{town}, {state}{hours_line}</p><p style="margin-top:10px">{about}</p>
<a class="call" href="tel:{tel}">Call {phone}</a></div></header>
<main><div class="wrap">
<ul class="svc">{svc_items}</ul>
<form id="f" novalidate><h2>Request a call back</h2><p style="margin:0;color:var(--muted)">{biz} will get back to you.</p>
<label for="n">Your name</label><input id="n" required maxlength="100" autocomplete="name">
<label for="p">Phone</label><input id="p" type="tel" required maxlength="40" autocomplete="tel" inputmode="tel">
<label for="e">Email (optional)</label><input id="e" type="email" maxlength="160" autocomplete="email">
<label for="m">What do you need?</label><textarea id="m" maxlength="800"></textarea>
<input type="text" id="hp" style="display:none" tabindex="-1" autocomplete="off">
<button type="submit" id="b">Send my request</button></form>
<div class="ok" id="ok"><h2>Sent. Thank you!</h2><p>{biz} has your request. If it's urgent, call <a href="tel:{tel}">{phone}</a>.</p></div>
<p class="small">Page by Ridgeline Local for {biz}. Your details go only to {biz}.</p>
</div></main>
<script>
(function(){{
 var src=(new URLSearchParams(location.search).get("src")||"direct").replace(/[^a-z0-9_-]/gi,"").slice(0,30)||"direct";
 var f=document.getElementById("f");
 f.addEventListener("submit",function(ev){{ev.preventDefault();
  var g=function(i){{return document.getElementById(i).value.trim()}};
  if(g("hp"))return; if(!g("n")||!g("p")){{alert("Please add your name and phone.");return}}
  var b=document.getElementById("b");b.disabled=true;b.textContent="Sending…";
  var body={{_subject:"Lead for {slug} — {biz_js}",_cc:"{cc}",_template:"box",_captcha:"false",lead_for:"{slug}",business:"{biz_js}",name:g("n"),phone:g("p"),email:g("e")||"not given",message:g("m")||"not given",source:src}};
  function done(){{f.style.display="none";document.getElementById("ok").style.display="block"}}
  fetch("https://formsubmit.co/ajax/ridgelinemarketinghq@gmail.com",{{method:"POST",headers:{{"Content-Type":"application/json","Accept":"application/json"}},body:JSON.stringify(body)}})
   .then(function(r){{return r.json()}}).then(function(j){{if(String(j.success)==="false")throw 0;done()}})
   .catch(function(){{location.href="tel:{tel}"}});
 }});
}})();
</script></body></html>
"""


def build(path):
    d = json.load(open(path))
    slug = d["slug"]
    if not re.fullmatch(r"[a-z0-9-]{3,60}", slug):
        raise SystemExit("bad slug")
    e = lambda s: html.escape(str(s or ""), quote=True)
    js = lambda s: json.dumps(str(s or ""))[1:-1].replace("<", "\\u003c")
    cc = d.get("leadEmail", "")
    if cc and not re.fullmatch(r"[^\s@\"<>]+@[^\s@\"<>]+\.[^\s@\"<>]+", cc):
        raise SystemExit("bad leadEmail")
    svcs = [s for s in d.get("services", []) if s][:10]
    out = TPL.format(biz=e(d["business"]), biz_js=js(d["business"]), town=e(d["town"]), state=e(d["state"]), slug=slug,
                     phone=e(d["phone"]), tel=re.sub(r"[^0-9+]", "", d["phone"]), about=e(d.get("about", "")),
                     hours_line=(" · " + e(d["hours"])) if d.get("hours") else "", cc=js(cc),
                     svc_items="".join(f"<li>{e(s)}</li>" for s in svcs), svc_line=e(", ".join(svcs[:4])))
    os.makedirs(f"p/{slug}", exist_ok=True)
    open(f"p/{slug}/index.html", "w").write(out)
    print(f"p/{slug}/index.html  live at https://ridgelinehq.github.io/p/{slug}/  tracking: ?src=gbp | ?src=facebook | ?src=card | ?src=ridgeline")


if __name__ == "__main__":
    build(sys.argv[1])
