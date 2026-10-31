#!/usr/bin/env python3
"""Build a Ridgeline cold email (plain text + HTML with the card) and check its shape.

Grayson, Oct 31, 2026: cold emails are short (three short paragraphs, under 90 words), carry one
small picture (the Ridgeline card) and go out every weekday without failing. This tool is how Echo
and Mara build EVERY cold email, follow-up and break-up, so the shape never drifts.

Usage:
  python3 office/tools/cold_email.py build spec.json        -> JSON {ok, flags, words, subject, body, htmlBody, card}
  python3 office/tools/cold_email.py build spec.json --no-net  (skip the card URL check; card still on)
  python3 office/tools/cold_email.py selftest

Spec (JSON):
  {"kind": "first" | "followup" | "breakup",
   "subject": "what ChatGPT says about dentists in Bryant",
   "greeting": "Hi Dana,",                       # or "Hi there,"
   "paragraphs": ["<loss, 1-2 sentences>", "<give, 1 sentence>"],   # follow-up/break-up: 1 paragraph
   "ask": "Want me to send it? Just reply yes.",
   "signature": "Grayson\nRidgeline Local",     # settings.signature
   "optOutLine": "If you'd rather not hear from me, reply 'no thanks' and I'll stop.",
   "mailingAddress": "123 Main St, Town, ST 12345",   # settings.mailingAddress, complete
   "card": true}                                 # false only for a reply inside an existing thread

Send with mcp__Gmail__send_message using BOTH fields: body = the plain text, htmlBody = the HTML.
The card is the email's ONE link. No other URL may appear in the paragraphs or the ask.
"""
import html
import json
import re
import sys
import urllib.request

SITE = "https://ridgelinehq.github.io/"
CARD_URL = "https://ridgelinehq.github.io/assets/email/free-ai-check.png"
CARD_ALT = ("Free AI check: what does ChatGPT say about your business? Then we run your AI "
            "visibility for $39.99 a month. No contract.")
LIMITS = {"first": 90, "followup": 60, "breakup": 45}          # words before the footer
MAX_PARAGRAPHS = {"first": 2, "followup": 1, "breakup": 1}     # body paragraphs, the ask is extra
BANNED = ["elevate", "unlock", "seamless", "game-changer", "game changer", "dive into", "leverage",
          "synergy", "look no further", "in today's digital landscape", "#1", "spots left",
          "limited time", "just launched", "beta", "guaranteed results", "urgent"]
EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿\U0001F000-\U0001F2FF]")


def words(text):
    return len(re.findall(r"\S+", text))


def sentences(text):
    return len([s for s in re.split(r"[.!?]+(?:\s|$)", text.strip()) if s.strip()])


def card_online(timeout=5):
    try:
        req = urllib.request.Request(CARD_URL, method="HEAD", headers={"User-Agent": "ridgeline-office"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 300
    except Exception:
        return False


def build(spec, check_net=True):
    flags = []
    kind = spec.get("kind", "first")
    if kind not in LIMITS:
        flags.append(f"kind must be one of {sorted(LIMITS)}")
        kind = "first"
    subject = (spec.get("subject") or "").strip()
    greeting = (spec.get("greeting") or "Hi there,").strip()
    paras = [p.strip() for p in spec.get("paragraphs", []) if p and p.strip()]
    ask = (spec.get("ask") or "").strip()
    signature = (spec.get("signature") or "Grayson\nRidgeline Local").strip()
    opt_out = (spec.get("optOutLine") or "").strip()
    address = (spec.get("mailingAddress") or "").strip()
    want_card = bool(spec.get("card", True))

    # Shape
    if not subject:
        flags.append("subject missing")
    if len(subject) > 60:
        flags.append(f"subject over 60 characters ({len(subject)})")
    if subject.upper() == subject and any(c.isalpha() for c in subject):
        flags.append("subject is ALL CAPS")
    if re.match(r"(?i)\s*(re|fwd?)\s*:", subject):
        flags.append("subject fakes a thread (RE:/FWD:)")
    if not paras:
        flags.append("no paragraphs")
    if len(paras) > MAX_PARAGRAPHS[kind]:
        flags.append(f"{len(paras)} paragraphs; a {kind} email has at most {MAX_PARAGRAPHS[kind]} plus the ask")
    for i, p in enumerate(paras, 1):
        if sentences(p) > 2:
            flags.append(f"paragraph {i} has {sentences(p)} sentences (max 2)")
        if re.search(r"(^|\n)\s*([-*•]|\d+[.)])\s", p):
            flags.append(f"paragraph {i} is a list; write sentences")
    if not ask:
        flags.append("ask missing")
    elif sentences(ask) > 2:
        flags.append("ask is longer than 2 sentences")
    body_text = " ".join([greeting] + paras + [ask, signature])
    n_words = words(body_text)
    if n_words >= LIMITS[kind]:
        flags.append(f"{n_words} words; a {kind} email is under {LIMITS[kind]} (before the footer)")
    joined = " ".join(paras + [ask, subject]).lower()
    for b in BANNED:
        if b in joined:
            flags.append(f"banned word: {b}")
    if EMOJI.search(" ".join(paras + [ask, subject, signature])):
        flags.append("emoji")
    if re.search(r"https?://|www\.", " ".join(paras + [ask])):
        flags.append("a URL in the body; the card is the only link")
    # Law
    if not opt_out:
        flags.append("optOutLine missing")
    if not re.search(r"\b\d{5}(-\d{4})?\b", address) or len(address) < 12:
        flags.append("mailingAddress incomplete (street, city, state, 5-digit ZIP)")

    card = want_card
    if want_card and check_net and not card_online():
        card = False
        flags.append("card offline: image URL did not answer 200, sent without the card (not a fail)")

    # Plain text (the alternative every client can read)
    plain = [greeting, ""]
    for p in paras:
        plain += [p, ""]
    plain += [ask, "", signature, ""]
    if card:
        plain += ["Free AI check: " + SITE, ""]
    plain += [opt_out, address]
    body = "\n".join(plain).strip() + "\n"

    # HTML: a plain note, one card, the footer. Nothing else.
    P = 'style="margin:0 0 14px;"'
    h = ['<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">',
         '<div style="max-width:600px;margin:0;padding:8px 0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;'
         'font-size:16px;line-height:1.5;color:#142721;">',
         f'<p {P}>{html.escape(greeting)}</p>']
    for p in paras:
        h.append(f'<p {P}>{html.escape(p)}</p>')
    h.append(f'<p {P}>{html.escape(ask)}</p>')
    h.append('<p style="margin:0 0 18px;">' + "<br>".join(html.escape(x) for x in signature.split("\n")) + "</p>")
    if card:
        h.append(f'<a href="{SITE}" style="text-decoration:none;"><img src="{CARD_URL}" width="600" '
                 f'alt="{html.escape(CARD_ALT)}" style="display:block;width:100%;max-width:600px;height:auto;'
                 'border:0;border-radius:12px;"></a>')
    h.append('<p style="margin:18px 0 0;font-size:13px;line-height:1.4;color:#5c6b63;">'
             + html.escape(opt_out) + "<br>" + html.escape(address) + "</p>")
    h.append("</div></body></html>")
    html_body = "\n".join(h)

    hard = [f for f in flags if not f.startswith("card offline")]
    return {"ok": not hard, "flags": flags, "words": n_words, "kind": kind, "subject": subject,
            "body": body, "htmlBody": html_body, "card": card}


def selftest():
    good = {"kind": "first", "subject": "what ChatGPT says about dentists in Bryant",
            "greeting": "Hi Dana,",
            "paragraphs": ["When someone in Bryant asks ChatGPT for a dentist, it names Smile Arkansas and Bryant Family Dental. Not Saline Family Dental.",
                           "I ran a free AI check on your practice: what ChatGPT and Gemini say, who they name instead, and the 3 fixes. It's free and yours to keep."],
            "ask": "Want me to send it? Just reply yes.",
            "signature": "Grayson\nRidgeline Local",
            "optOutLine": "If you'd rather not hear from me, reply 'no thanks' and I'll stop.",
            "mailingAddress": "100 Example Rd, Springfield, MO 65801", "card": True}
    r = build(good, check_net=False)
    assert r["ok"], r["flags"]
    assert r["words"] < 90 and CARD_URL in r["htmlBody"] and "Free AI check: " + SITE in r["body"]
    assert r["htmlBody"].count("<img") == 1 and r["htmlBody"].count("<a ") == 1
    long = dict(good, paragraphs=good["paragraphs"] + ["One more paragraph about how our team of specialists can elevate your brand in today's digital landscape with a seamless process."])
    r2 = build(long, check_net=False)
    assert not r2["ok"] and any("paragraphs" in f for f in r2["flags"]) and any("banned" in f for f in r2["flags"])
    bad = dict(good, mailingAddress="", subject="RE: URGENT", ask="See https://x.y")
    r3 = build(bad, check_net=False)
    assert not r3["ok"] and len(r3["flags"]) >= 3
    fu = dict(good, kind="followup", subject="one more thing about your Google profile",
              paragraphs=["I also noticed your Google profile shows no services and 4 photos. That is a 10-minute fix."],
              ask="Want the free check? Just reply yes.")
    r4 = build(fu, check_net=False)
    assert r4["ok"] and r4["words"] < 60, r4
    print("cold_email selftest ok:", r["words"], "words first,", r4["words"], "words follow-up")


def main(argv):
    if len(argv) >= 2 and argv[1] == "selftest":
        return selftest()
    if len(argv) >= 3 and argv[1] == "build":
        with open(argv[2]) as f:
            spec = json.load(f)
        out = build(spec, check_net="--no-net" not in argv)
        print(json.dumps(out, indent=1))
        return 0 if out["ok"] else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv) or 0)
