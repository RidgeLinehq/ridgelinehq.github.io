#!/usr/bin/env python3
"""Build a client's quote-request page (the lead page): office/landing/<slug>.json -> p/<slug>/index.html.

Every plan gets this page, so it is Ridgeline's main lead source. Every lead is opt-in: the person
fills the form to be contacted. The page promises no number of leads or results, asks for no health
or medical details, and loads one Google Fonts stylesheet (Inter) and nothing else from outside.

Input JSON (public facts only, approved by the client in onboarding):
  slug           required  [a-z0-9-]{3,60}; the page lives at /p/<slug>/ unless --out says otherwise
  business       required  the business name as customers know it
  phone          required  shown as written; the tel: link keeps only digits and +
  leadEmail      required  validated; gets a copy of every lead at once (FormSubmit _cc)
  town, state              shown under the name and in the title
  services                 list of up to 10 short labels: chips in the header and the "What do you need?" choices
  about                    one or two plain sentences
  leadCc                   optional list of extra addresses (same check as leadEmail), joined into _cc with
                           leadEmail. A carrier email-to-text address (5555551234@vtext.com,
                           5555551234@tmomail.net) turns every lead into a text alert on the owner's
                           phone where the carrier still runs one (AT&T closed txt.att.net in June 2025;
                           the live carrier list is in specs/client-delivery.md "Lead alerts"). Ridgeline
                           Instant texts through Twilio first when it is set up.
  hours                    optional, e.g. "Mon-Sat 7-6"
  industry                 optional slug (roofers, dentists, ...); kept on the page as data-industry
  cta                      optional form heading; default "Request a quote"
  reviewLine               optional trust line, e.g. "4.8 stars on Google from 120 reviews"; shown only
                           when given, and only ever a true, current number
  whenOptions              optional list for "When do you need it?"; default
                           ["As soon as possible", "This week", "This month", "Just getting prices"]
  extraQuestion            optional {"label": "...", "options": [...]} rendered as one more select, e.g.
                           {"label": "What are you looking for?", "options": ["Life insurance quote",
                           "Health insurance quote", "Both", "Not sure yet"]}
  noindex                  optional bool; true adds <meta name="robots" content="noindex"> (samples, tests)
  consentLine              optional; {business} is filled in. Default: "By sending this you're asking
                           {business} to contact you about your request. Your details go to {business}, delivered by Ridgeline Local, and to no one else."

Form fields: name*, phone*, email, what (services + "Something else"), when (whenOptions), the extra
question when given, area, details, and a honeypot. The page POSTs JSON to FormSubmit
(https://formsubmit.co/ajax/ridgelinemarketinghq@gmail.com) with _subject "Lead for <slug> — <business>:
<name> · <what> · <when>", _cc = leadEmail (+ leadCc), _template "box", _captcha "false" and, only when the
lead gave an email, an _autoresponse. The Ridgeline inbox logs every lead and the client gets the copy at
once through _cc. Body fields, in order: lead_for, business, name, phone, email, what, when, extra (when
asked), area, details, source (the tracking link's ?src= value, default "direct"), page (the page URL),
follow_up_tip (a call-back script with the lead's name and request filled in).

Usage: python3 office/tools/make_landing.py office/landing/<slug>.json [--out p/<slug>/index.html]
Tracking links: /p/<slug>/?src=gbp | ?src=card | ?src=facebook | ?src=ridgeline | ?src=ad
"""
import argparse
import html
import json
import os
import re
import string
import sys

SITE = "https://ridgelinehq.github.io"
INBOX = "ridgelinemarketinghq@gmail.com"
SLUG_RE = re.compile(r"[a-z0-9-]{3,60}")
EMAIL_RE = re.compile(r"[^\s@\"<>,]+@[^\s@\"<>,]+\.[^\s@\"<>,]+")
DEFAULT_WHEN = ["As soon as possible", "This week", "This month", "Just getting prices"]
DEFAULT_CTA = "Request a quote"
DEFAULT_CONSENT = ("By sending this you're asking {business} to contact you about your request. "
                   "Your details go to {business}, delivered by Ridgeline Local, and to no one else.")
FOLLOW_UP_TIP = ("Call back within 5 minutes if you can. A fast call back is the single biggest factor in "
                 "winning the job. Say: Hi {name}, this is {business}. You just sent us a request about {what}. "
                 "I can help with that. When works for a quick chat?")
AUTORESPONSE = ("Thanks {name}! {business} got your request about {what} and will reach out shortly. "
                "If it's urgent, call {phone}.")
TRACKING = "?src=gbp | ?src=card | ?src=facebook | ?src=ridgeline | ?src=ad"

# string.Template: $name placeholders. The CSS and JS below must not contain a bare "$".
TPL = string.Template("""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>$title</title>
<meta name="description" content="$description">$head_extra
<meta name="theme-color" content="#04211a">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"></noscript>
<style>
:root{--forest:#04211a;--forest-2:#082f28;--mint:#57f2af;--cream:#f6f4eb;--cream-2:#fbf7ec;--white:#fffdf7;--brass:#c9a85c;--brass-ink:#866a2c;--ink:#142721;--muted:#5c6b63;--sage:#e3efe7;--line:#e2ddcc;--bad:#9b2f2a}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--cream);color:var(--ink);font:16.5px/1.6 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
.wrap{width:min(680px,calc(100% - 32px));margin-inline:auto}
.hero{background:linear-gradient(165deg,var(--forest-2),var(--forest) 70%);color:#fff;padding:34px 0 40px}
.kicker{margin:0 0 10px;font-size:.82rem;font-weight:600;letter-spacing:.09em;text-transform:uppercase;color:var(--mint)}
h1{margin:0 0 10px;font-size:clamp(1.95rem,7vw,2.75rem);line-height:1.06;letter-spacing:-.025em;font-weight:700;overflow-wrap:anywhere}
.review{display:flex;align-items:center;gap:8px;margin:0 0 14px;color:var(--brass);font-weight:600;font-size:.95rem}
.review svg{width:18px;height:18px;flex:none}
.about{margin:0;max-width:58ch;font-size:1.03rem;color:#d4e2da}
.chips{padding:0;margin:18px 0 0;list-style:none;display:flex;flex-wrap:wrap;gap:8px}
.chips li{padding:6px 12px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(255,255,255,.07);font-size:.88rem;font-weight:500;color:#eaf3ee}
.call{display:flex;justify-content:center;align-items:center;gap:10px;min-height:58px;margin-top:24px;border-radius:14px;background:var(--mint);color:var(--forest);font-weight:700;font-size:1.12rem;letter-spacing:-.01em;text-decoration:none}
.call svg{width:20px;height:20px;flex:none}
.call:active{transform:translateY(1px)}
.call-dark{background:var(--forest);color:#fff}
.hours{margin:14px 0 0;font-size:.92rem;color:#b7cbc1}
main{padding:28px 0 44px}
.card{background:var(--white);border:1px solid var(--line);border-radius:18px;padding:24px 20px 22px;box-shadow:0 10px 30px rgba(4,33,26,.07)}
h2{margin:0 0 6px;font-size:1.5rem;line-height:1.2;letter-spacing:-.02em}
.sub{margin:0 0 4px;color:var(--muted)}
label{display:block;margin:18px 0 6px;font-size:.9rem;font-weight:600}
label .opt{font-weight:400;color:var(--muted)}
input,select,textarea{display:block;width:100%;min-height:50px;padding:12px 14px;border:1px solid #b6b19f;border-radius:10px;background:#fff;color:var(--ink);font:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid var(--forest);outline-offset:1px;border-color:var(--forest)}
textarea{min-height:110px;resize:vertical}
select{appearance:none;-webkit-appearance:none;padding-right:42px;background:#fff url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='9' viewBox='0 0 14 9'%3E%3Cpath d='M1 1l6 6 6-6' fill='none' stroke='%23142721' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 15px center}
.bad,.bad:focus{border-color:var(--bad);outline-color:var(--bad)}
.err{margin:6px 0 0;font-size:.86rem;font-weight:500;color:var(--bad)}
.hp{display:none}
button{display:block;width:100%;min-height:56px;margin-top:22px;border:0;border-radius:12px;background:var(--forest);color:#fff;font-family:inherit;font-size:1.08rem;font-weight:700;cursor:pointer}
button[disabled]{opacity:.7;cursor:default}
.consent{margin:14px 0 0;font-size:.82rem;line-height:1.5;color:var(--muted)}
.fail{margin-top:18px;padding:14px 16px;border:1px solid #e5cfa7;border-radius:12px;background:var(--cream-2);font-size:.95rem;line-height:1.5}
.fail a{color:var(--brass-ink);font-weight:600}
.ok{background:var(--sage);border-color:#cfe0d5}
.ok p{margin:0}
.foot{margin:28px 0 0;font-size:.82rem;color:var(--muted);text-align:center}
@media (min-width:720px){.hero{padding:48px 0 52px}.card{padding:32px 30px 28px}main{padding-top:34px}}
</style>
</head>
<body$body_attrs>
<header class="hero">
<div class="wrap">
$kicker_html<h1>$biz</h1>
$review_html<p class="about">$about</p>
$chips_html<a class="call" href="tel:$tel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z" fill="currentColor"/></svg>Call $phone</a>
$hours_html</div>
</header>
<main>
<div class="wrap">
<form id="f" class="card" novalidate>
<h2>$cta</h2>
<p class="sub">Tell us what you need and $biz will get back to you.</p>
<label for="n">Your name</label>
<input id="n" name="name" required maxlength="100" autocomplete="name" aria-describedby="n-err">
<p class="err" id="n-err" hidden></p>
<label for="p">Phone</label>
<input id="p" name="phone" type="tel" required maxlength="40" autocomplete="tel" inputmode="tel" aria-describedby="p-err">
<p class="err" id="p-err" hidden></p>
<label for="e">Email <span class="opt">(optional)</span></label>
<input id="e" name="email" type="email" maxlength="160" autocomplete="email" inputmode="email">
<label for="w">What do you need?</label>
<select id="w" name="what">$what_options</select>
<label for="t">When do you need it?</label>
<select id="t" name="when">$when_options</select>
$extra_html<label for="a">Your address or area <span class="opt">(optional)</span></label>
<input id="a" name="area" maxlength="160" autocomplete="street-address">
<label for="d">Anything else we should know? <span class="opt">(optional)</span></label>
<textarea id="d" name="details" maxlength="1000"></textarea>
<div class="hp" aria-hidden="true"><label for="hp">Leave this field empty</label><input id="hp" name="website" tabindex="-1" autocomplete="off"></div>
<button type="submit" id="b">Send request</button>
<p class="consent">$consent</p>
<div class="fail" id="fail" hidden role="alert"><strong>That didn't send.</strong> Call <a href="tel:$tel">$phone</a> or <a id="mail" href="mailto:$lead_email">email your request to $biz</a>; the email is already filled in.</div>
</form>
<div class="card ok" id="ok" hidden>
<h2 id="ok-h" tabindex="-1">Sent. Thank you!</h2>
<p>$biz has your request and will be in touch. If it's urgent, call now.</p>
<a class="call call-dark" href="tel:$tel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25c1.1.37 2.3.57 3.6.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8z" fill="currentColor"/></svg>Call $phone</a>
</div>
<p class="foot">Page by Ridgeline Local for $biz.</p>
</div>
</main>
<script>
(function(){
var C=$cfg;
function el(i){return document.getElementById(i)}
function val(i){var x=el(i);return x?x.value.trim():""}
function fill(t,m){return t.replace(/\\{(name|what)\\}/g,function(a,k){return m[k]})}
var src=(new URLSearchParams(location.search).get("src")||"direct").replace(/[^a-z0-9_-]/gi,"").slice(0,30)||"direct";
var f=el("f"),b=el("b"),fail=el("fail");
function mark(i,msg){var x=el(i),er=el(i+"-err");if(msg){x.classList.add("bad");x.setAttribute("aria-invalid","true");er.textContent=msg;er.hidden=false}else{x.classList.remove("bad");x.removeAttribute("aria-invalid");er.hidden=true}}
["n","p"].forEach(function(i){el(i).addEventListener("input",function(){mark(i,"")})});
function done(){f.hidden=true;var ok=el("ok");ok.hidden=false;window.scrollTo(0,0);el("ok-h").focus()}
function failed(body){
 var lines=["Name: "+body.name,"Phone: "+body.phone,"Email: "+body.email,"What: "+body.what,"When: "+body.when];
 if(body.extra)lines.push(C.extraLabel+" "+body.extra);
 lines.push("Area: "+body.area,"Details: "+body.details,"Source: "+body.source,"Page: "+body.page);
 el("mail").href="mailto:"+C.leadEmail+"?subject="+encodeURIComponent("Quote request from "+body.name)+"&body="+encodeURIComponent(lines.join("\\n"));
 fail.hidden=false;b.disabled=false;b.textContent="Try again";fail.scrollIntoView({block:"nearest"});
}
f.addEventListener("submit",function(ev){
 ev.preventDefault();
 if(val("hp"))return;
 var n=val("n"),p=val("p"),ok=true;
 if(!n){mark("n","Please add your name.");ok=false}
 if(p.replace(/\\D/g,"").length<7){mark("p","Please add a phone number we can call.");ok=false}
 if(!ok){var first=f.querySelector(".bad");if(first)first.focus();return}
 var w=val("w"),t=val("t"),e=val("e"),m={name:n,what:w};
 var body={_subject:"Lead for "+C.slug+" \\u2014 "+C.biz+": "+n+" \\u00b7 "+w+" \\u00b7 "+t,_cc:C.cc,_template:"box",_captcha:"false",lead_for:C.slug,business:C.biz,name:n,phone:p,email:e||"not given",what:w,when:t};
 if(el("x"))body.extra=val("x");
 body.area=val("a")||"not given";body.details=val("d")||"not given";body.source=src;body.page=location.href;body.follow_up_tip=fill(C.tip,m);
 if(e)body._autoresponse=fill(C.auto,m);
 b.disabled=true;b.textContent="Sending\\u2026";fail.hidden=true;
 fetch("https://formsubmit.co/ajax/"+C.inbox,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json"},body:JSON.stringify(body)})
  .then(function(r){return r.json()}).then(function(j){if(String(j.success)==="false")throw 0;done()})
  .catch(function(){failed(body)});
});
})();
</script>
</body>
</html>
""")

STAR = ('<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.7.8-4.9 4.6 1.3 6.6L12 17.3 '
        '6 20.6l1.3-6.6L2.4 9.4l6.7-.8z" fill="currentColor"/></svg>')


def fail(msg):
    raise SystemExit(f"make_landing: {msg}")


def esc(s):
    return html.escape("" if s is None else str(s), quote=True)


def text(d, key, required=False):
    v = d.get(key)
    if v is None or (isinstance(v, str) and not v.strip()):
        if required:
            fail(f"{key} is required")
        return ""
    if not isinstance(v, str):
        fail(f"{key} must be a string")
    return " ".join(v.split())


def str_list(d, key, limit):
    v = d.get(key)
    if v is None:
        return None
    if not isinstance(v, list):
        fail(f"{key} must be a list")
    out = []
    for x in v:
        if not isinstance(x, str) or not x.strip():
            fail(f"{key}: every entry must be a non-empty string")
        out.append(" ".join(x.split()))
    if len(out) > limit:
        fail(f"{key}: at most {limit} entries")
    return out


def load(path):
    with open(path, encoding="utf-8") as fh:
        d = json.load(fh)
    if not isinstance(d, dict):
        fail("the JSON must be an object")
    slug = d.get("slug")
    if not isinstance(slug, str) or not SLUG_RE.fullmatch(slug):
        fail("slug is required and must match [a-z0-9-]{3,60}")
    lead = text(d, "leadEmail", required=True)
    if not EMAIL_RE.fullmatch(lead):
        fail("leadEmail must be an email address")
    cc = [lead]
    for a in str_list(d, "leadCc", 10) or []:
        if not EMAIL_RE.fullmatch(a):
            fail(f"leadCc: {a!r} is not an email address")
        cc.append(a)
    phone = text(d, "phone", required=True)
    tel = re.sub(r"[^0-9+]", "", phone)
    if len(re.sub(r"\D", "", tel)) < 7:
        fail("phone needs at least 7 digits")
    industry = text(d, "industry")
    if industry and not re.fullmatch(r"[a-z0-9-]{2,40}", industry):
        fail("industry must be a slug like roofers")
    extra = d.get("extraQuestion")
    if extra is not None:
        if not isinstance(extra, dict):
            fail("extraQuestion must be an object with label and options")
        label = text(extra, "label", required=True)
        options = str_list(extra, "options", 20)
        if not options:
            fail("extraQuestion.options must be a non-empty list")
        extra = {"label": label, "options": options}
    noindex = d.get("noindex", False)
    if not isinstance(noindex, bool):
        fail("noindex must be true or false")
    business = text(d, "business", required=True)
    return {
        "slug": slug, "business": business, "town": text(d, "town"), "state": text(d, "state"),
        "phone": phone, "tel": tel, "services": str_list(d, "services", 10) or [], "about": text(d, "about"),
        "leadEmail": lead, "cc": cc, "hours": text(d, "hours"), "industry": industry,
        "cta": text(d, "cta") or DEFAULT_CTA, "reviewLine": text(d, "reviewLine"),
        "whenOptions": str_list(d, "whenOptions", 10) or DEFAULT_WHEN, "extraQuestion": extra,
        "noindex": noindex, "consentLine": (text(d, "consentLine") or DEFAULT_CONSENT).replace("{business}", business),
    }


def options_html(items):
    return "".join(f'<option value="{esc(x)}">{esc(x)}</option>' for x in items)


def render(c, page_url):
    biz = c["business"]
    location = ", ".join(x for x in (c["town"], c["state"]) if x)
    svc_line = ", ".join(c["services"][:4])
    description = f"{biz}" + (f" in {location}" if location else "") + (f": {svc_line}." if svc_line else ".") \
        + f" Call {c['phone']} or send a quote request online."
    head_extra = ""
    if c["noindex"]:
        head_extra += '\n<meta name="robots" content="noindex">'
    else:
        head_extra += f'\n<link rel="canonical" href="{esc(page_url)}">'
    extra_html = ""
    extra_label = ""
    if c["extraQuestion"]:
        extra_label = c["extraQuestion"]["label"]
        extra_html = (f'<label for="x">{esc(extra_label)}</label>\n'
                      f'<select id="x" name="extra">{options_html(c["extraQuestion"]["options"])}</select>\n')
    cfg = {
        "slug": c["slug"], "biz": biz, "phone": c["phone"], "inbox": INBOX, "cc": ",".join(c["cc"]),
        "leadEmail": c["leadEmail"], "extraLabel": extra_label,
        "tip": FOLLOW_UP_TIP.replace("{business}", biz),
        "auto": AUTORESPONSE.replace("{business}", biz).replace("{phone}", c["phone"]),
    }
    return TPL.substitute(
        title=esc(f"{biz} — {location}" if location else biz),
        description=esc(description),
        head_extra=head_extra,
        body_attrs=f' data-industry="{esc(c["industry"])}"' if c["industry"] else "",
        kicker_html=f'<p class="kicker">{esc(location)}</p>\n' if location else "",
        biz=esc(biz),
        review_html=f'<p class="review">{STAR}<span>{esc(c["reviewLine"])}</span></p>\n' if c["reviewLine"] else "",
        about=esc(c["about"]),
        chips_html=('<ul class="chips">' + "".join(f"<li>{esc(s)}</li>" for s in c["services"]) + "</ul>\n") if c["services"] else "",
        tel=esc(c["tel"]),
        phone=esc(c["phone"]),
        hours_html=f'<p class="hours">Hours: {esc(c["hours"])}</p>\n' if c["hours"] else "",
        cta=esc(c["cta"]),
        what_options=options_html(c["services"] + ["Something else"]),
        when_options=options_html(c["whenOptions"]),
        extra_html=extra_html,
        consent=esc(c["consentLine"]),
        lead_email=esc(c["leadEmail"]),
        cfg=json.dumps(cfg, ensure_ascii=True).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026"),
    )


def page_url_for(out, slug):
    """Public URL of the built page: the out path relative to the repo root (the cwd), else /p/<slug>/."""
    rel = os.path.relpath(os.path.abspath(out), os.getcwd()).replace(os.sep, "/")
    if rel.startswith(".."):
        return f"{SITE}/p/{slug}/"
    parts = [p for p in rel.split("/") if p]
    if parts and parts[-1] == "index.html":
        parts = parts[:-1]
        return SITE + "/" + ("/".join(parts) + "/" if parts else "")
    return SITE + "/" + "/".join(parts)


def build(path, out=None):
    c = load(path)
    out = out or os.path.join("p", c["slug"], "index.html")
    url = page_url_for(out, c["slug"])
    page = render(c, url)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(page)
    print(f"{out}  live at {url}  tracking: {TRACKING}")
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Build a client's quote-request page from office/landing/<slug>.json.")
    ap.add_argument("json_path", help="office/landing/<slug>.json")
    ap.add_argument("--out", help="where to write the page (default p/<slug>/index.html, relative to the repo root)")
    a = ap.parse_args(argv)
    build(a.json_path, a.out)


if __name__ == "__main__":
    main()
