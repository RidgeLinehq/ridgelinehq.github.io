#!/usr/bin/env python3
"""Ridgeline Stripe operations (runs in GitHub Actions; STRIPE_SECRET_KEY lives in repo secrets only).

Two jobs, both idempotent:

1. setup (every run): make sure the products, prices (monthly + yearly), the guarantee coupon
   and one payment link per plan+billing exist, then write their public URLs to
   data/stripe-links.json (the website's checkout buttons read that file). Objects are found
   again by metadata / lookup_key, so re-running never makes duplicates.

2. jobs: every office/stripe/jobs/<id>.json without an office/stripe/out/<id>.json gets done:
   {"id": "...", "action": "guarantee", "session": "cs_..."}            (preferred), or
   {"id": "...", "action": "guarantee", "emailHash": "<sha256 hex>"}    (sha256 of "ridgeline:" + lowercased email)
   -> monthly plan: 100%-off-once coupon on the subscription (covers the next invoice); if the
      month-2 invoice was already paid, it is refunded in full instead.
   -> yearly plan: one month's price is refunded on the latest paid invoice.
   {"id": "...", "action": "lookup", "session": "cs_..."} -> writes plan, billing, status only.
   {"id": "...", "action": "cancel", "session"|"emailHash": ...} -> cancel at period end (no more charges).
   {"id": "...", "action": "refund_last", "session"|"emailHash": ..., "cancel": true, "reason": "duplicate"|"grayson",
      "approvedBy": "grayson"} -> ONLY a duplicate/mistaken charge or a refund Grayson approved (payments are final, terms.html).
   The public repo never holds an email, a name or a card detail: jobs carry an opaque Checkout
   Session id or a salted hash; outputs carry ok/what/error only.

Exit code 1 when anything failed, so the Action goes red and the alert workflow fires.
Stdlib only. Keys are never printed.
"""
import glob, hashlib, json, os, sys, time, urllib.error, urllib.parse, urllib.request

KEY = os.environ.get("STRIPE_SECRET_KEY", "").strip()
API = "https://api.stripe.com/v1/"
VERSION = "2024-06-20"
SITE = "https://ridgelinehq.github.io"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LINKS = os.path.join(ROOT, "data", "stripe-links.json")
JOBS = os.path.join(ROOT, "office", "stripe", "jobs")
OUT = os.path.join(ROOT, "office", "stripe", "out")
COUPON = "rl-second-month-free"
TERMS_TEXT = "By subscribing you agree to the Ridgeline Local Terms (ridgelinehq.github.io/terms.html). All payments are final and non-refundable; cancel anytime by replying \"cancel\" to any email to stop future charges."

PLANS = {
    "starter": {"name": "Ridgeline Local Starter", "monthly": 7500, "yearly": 75000,
                "desc": "Google Business Profile cleanup + optimization, monthly AI visibility report, review request system."},
    "growth": {"name": "Ridgeline Local Growth", "monthly": 12500, "yearly": 125000,
               "desc": "Everything in Starter + AI Lead Finder, lead tracking, Second Month Free Guarantee."},
    "pro": {"name": "Ridgeline Local Pro", "monthly": 19900, "yearly": 199000,
            "desc": "Everything in Growth + priority lead alerts, lead-capture page, monthly promo video, competitor tracking."},
}


class StripeError(Exception):
    pass


def call(method, path, params=None, idem=None):
    data = None
    url = API + path
    if params:
        enc = urllib.parse.urlencode(flatten(params))
        if method == "GET":
            url += "?" + enc
        else:
            data = enc.encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + KEY, "Stripe-Version": VERSION,
        **({"Idempotency-Key": idem} if idem else {})})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            try:
                msg = json.loads(e.read().decode()).get("error", {}).get("message", "")
            except Exception:
                msg = ""
            if e.code in (429, 500, 502, 503) and attempt < 2:
                time.sleep(3 * (attempt + 1))
                continue
            raise StripeError(f"{method} {path.split('?')[0]}: HTTP {e.code} {msg}"[:300])
        except Exception as e:
            if attempt < 2:
                time.sleep(3)
                continue
            raise StripeError(f"{method} {path}: {e.__class__.__name__}")


def flatten(d, prefix=""):
    out = []
    if isinstance(d, dict):
        for k, v in d.items():
            out += flatten(v, f"{prefix}[{k}]" if prefix else k)
    elif isinstance(d, list):
        for i, v in enumerate(d):
            out += flatten(v, f"{prefix}[{i}]")
    elif isinstance(d, bool):
        out.append((prefix, "true" if d else "false"))
    else:
        out.append((prefix, str(d)))
    return out


def all_pages(path, params):
    items, params = [], dict(params, limit=100)
    while True:
        r = call("GET", path, params)
        items += r.get("data", [])
        if not r.get("has_more") or not r.get("data"):
            return items
        params["starting_after"] = r["data"][-1]["id"]


# ---------------- setup ----------------
def ensure_product(plan, p):
    found = call("GET", "products/search", {"query": f"metadata['rl_plan']:'{plan}' AND active:'true'"}).get("data", [])
    if found:
        return found[0]["id"]
    return call("POST", "products", {"name": p["name"], "description": p["desc"], "metadata": {"rl_plan": plan}},
                idem=f"rl-product-{plan}")["id"]


def ensure_price(plan, billing, product, amount):
    lk = f"rl_{plan}_{billing}"
    found = call("GET", "prices", {"lookup_keys": [lk], "active": "true"}).get("data", [])
    if found and found[0]["unit_amount"] == amount:
        return found[0]["id"]
    interval = "month" if billing == "monthly" else "year"
    return call("POST", "prices", {"product": product, "currency": "usd", "unit_amount": amount,
                                   "recurring": {"interval": interval}, "lookup_key": lk, "transfer_lookup_key": "true",
                                   "metadata": {"rl_plan": plan, "rl_billing": billing}})["id"]


def ensure_coupon():
    try:
        call("GET", f"coupons/{COUPON}")
    except StripeError as e:
        if "404" not in str(e) and "No such coupon" not in str(e):
            raise
        call("POST", "coupons", {"id": COUPON, "percent_off": 100, "duration": "once",
                                 "name": "Second Month Free Guarantee"})


def ensure_link(plan, billing, price):
    for link in all_pages("payment_links", {"active": "true"}):
        md = link.get("metadata") or {}
        if md.get("rl_plan") == plan and md.get("rl_billing") == billing and md.get("rl_price") == price:
            if (((link.get("custom_text") or {}).get("submit") or {}).get("message") or "") != TERMS_TEXT:
                call("POST", f"payment_links/{link['id']}", {"custom_text": {"submit": {"message": TERMS_TEXT}}})
                print(f"terms line added to {plan} {billing} checkout")
            return link["url"]
    redirect = f"{SITE}/welcome.html?plan={plan}&billing={billing}&session_id={{CHECKOUT_SESSION_ID}}"
    link = call("POST", "payment_links", {
        "line_items": [{"price": price, "quantity": 1}],
        "after_completion": {"type": "redirect", "redirect": {"url": redirect}},
        "allow_promotion_codes": True,
        "custom_text": {"submit": {"message": TERMS_TEXT}},
        "billing_address_collection": "auto",
        "phone_number_collection": {"enabled": True},
        "metadata": {"rl_plan": plan, "rl_billing": billing, "rl_price": price},
        "subscription_data": {"metadata": {"rl_plan": plan, "rl_billing": billing}},
    }, idem=f"rl-link-{plan}-{billing}-{price}")
    return link["url"]


def setup():
    links = {}
    for plan, p in PLANS.items():
        product = ensure_product(plan, p)
        links[plan] = {}
        for billing in ("monthly", "yearly"):
            price = ensure_price(plan, billing, product, p[billing])
            links[plan][billing] = ensure_link(plan, billing, price)
    ensure_coupon()
    old = json.load(open(LINKS)) if os.path.exists(LINKS) else {}
    if old.get("links") != links:
        json.dump({"note": "Written by the 'Ridgeline Stripe' Action. Do not edit by hand; the next run rewrites it.",
                   "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "links": links},
                  open(LINKS, "w"), indent=2)
        print("stripe-links.json updated")
    else:
        print("stripe links unchanged")


# ---------------- jobs ----------------
def find_subscription(job):
    if job.get("session"):
        s = call("GET", f"checkout/sessions/{job['session']}")
        if not s.get("subscription"):
            raise StripeError("checkout session has no subscription")
        return call("GET", f"subscriptions/{s['subscription']}")
    h = (job.get("emailHash") or "").lower()
    if not h:
        raise StripeError("job has neither session nor emailHash")
    since = int(time.time()) - 200 * 86400
    for c in all_pages("customers", {"created[gte]": since}):
        email = (c.get("email") or "").strip().lower()
        if email and hashlib.sha256(("ridgeline:" + email).encode()).hexdigest() == h:
            subs = call("GET", "subscriptions", {"customer": c["id"], "status": "all", "limit": 10}).get("data", [])
            live = [s for s in subs if s["status"] in ("active", "trialing", "past_due")]
            if live:
                return live[0]
            raise StripeError("customer found but no active subscription")
    raise StripeError("no customer matches that email hash")


def plan_of(sub):
    md = sub.get("metadata") or {}
    item = sub["items"]["data"][0]
    interval = item["price"]["recurring"]["interval"]
    return md.get("rl_plan", "unknown"), ("yearly" if interval == "year" else "monthly"), item["price"]["unit_amount"]


def paid_invoices(sub_id):
    return [i for i in call("GET", "invoices", {"subscription": sub_id, "limit": 12}).get("data", [])
            if i.get("status") == "paid" and (i.get("amount_paid") or 0) > 0]


def refund_invoice(inv, amount, job_id):
    pi = inv.get("payment_intent")
    if isinstance(pi, dict):
        pi = pi.get("id")
    if pi:
        return call("POST", "refunds", {"payment_intent": pi, "amount": amount,
                                        "metadata": {"rl_job": job_id, "rl_reason": "second-month-free"}}, idem=f"rl-refund-{job_id}")["id"]
    ch = inv.get("charge")
    if not ch:
        raise StripeError("paid invoice has no payment to refund")
    return call("POST", "refunds", {"charge": ch, "amount": amount, "metadata": {"rl_job": job_id}}, idem=f"rl-refund-{job_id}")["id"]


def guarantee(job):
    sub = find_subscription(job)
    plan, billing, unit = plan_of(sub)
    if plan not in ("growth", "pro", "unknown"):
        raise StripeError(f"plan {plan} has no Second Month Free Guarantee")
    monthly_price = PLANS.get(plan, {}).get("monthly", 0)
    if billing == "yearly":
        invs = paid_invoices(sub["id"])
        if not invs:
            raise StripeError("yearly plan has no paid invoice to refund")
        rid = refund_invoice(invs[0], monthly_price or unit // 10, job["id"])
        return {"what": "refunded one month on a yearly plan", "refund": rid[-6:], "plan": plan, "billing": billing}
    invs = paid_invoices(sub["id"])
    cycle = [i for i in invs if i.get("billing_reason") == "subscription_cycle"]
    if cycle:  # month 2 was already charged: refund it in full
        rid = refund_invoice(cycle[-1], cycle[-1]["amount_paid"], job["id"])
        return {"what": "month 2 was already charged, refunded in full", "refund": rid[-6:], "plan": plan, "billing": billing}
    if not any((d.get("coupon") or {}).get("id") == COUPON for d in (sub.get("discounts") or []) if isinstance(d, dict)) \
            and ((sub.get("discount") or {}).get("coupon") or {}).get("id") != COUPON:
        call("POST", f"subscriptions/{sub['id']}", {"coupon": COUPON}, idem=f"rl-coupon-{job['id']}")
    return {"what": "100% off coupon applied to month 2", "plan": plan, "billing": billing,
            "nextInvoiceAt": sub.get("current_period_end")}


def cancel(job):
    sub = find_subscription(job)
    if sub.get("cancel_at_period_end") or sub["status"] == "canceled":
        return {"what": "already cancelled", "periodEnd": sub.get("current_period_end")}
    call("POST", f"subscriptions/{sub['id']}", {"cancel_at_period_end": True}, idem=f"rl-cancel-{job['id']}")
    return {"what": "cancels at the end of the paid period, no further charges", "periodEnd": sub.get("current_period_end")}


def refund_last(job):
    """Only for a charge made by mistake (duplicate) or one Grayson approved: terms.html says payments are final."""
    sub = find_subscription(job)
    invs = paid_invoices(sub["id"])
    if not invs:
        return {"what": "nothing to refund (no paid charge)"}
    inv = invs[0]
    age_days = (time.time() - (inv.get("status_transitions", {}).get("paid_at") or inv.get("created") or 0)) / 86400
    if age_days > 45 and not job.get("approvedBy"):
        raise StripeError(f"latest charge is {int(age_days)} days old: needs approvedBy (Grayson)")
    rid = refund_invoice(inv, inv["amount_paid"], job["id"])
    if job.get("cancel", True) and not sub.get("cancel_at_period_end"):
        call("POST", f"subscriptions/{sub['id']}", {"cancel_at_period_end": True}, idem=f"rl-cancel-{job['id']}")
    return {"what": f"refunded ${inv['amount_paid'] / 100:.2f} in full" + (" and cancelled renewal" if job.get("cancel", True) else ""), "refund": rid[-6:]}


def lookup(job):
    sub = find_subscription(job)
    plan, billing, unit = plan_of(sub)
    return {"what": "lookup", "plan": plan, "billing": billing, "status": sub["status"], "amount": unit,
            "startedAt": sub.get("start_date"), "periodEnd": sub.get("current_period_end")}


def run_jobs():
    failed = 0
    os.makedirs(OUT, exist_ok=True)
    for f in sorted(glob.glob(os.path.join(JOBS, "*.json"))):
        out = os.path.join(OUT, os.path.basename(f))
        if os.path.exists(out):
            continue
        res = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        try:
            job = json.load(open(f))
            job.setdefault("id", os.path.basename(f)[:-5])
            res["id"] = job["id"]
            fn = {"guarantee": guarantee, "lookup": lookup, "cancel": cancel, "refund_last": refund_last}.get(job.get("action"))
            if not fn:
                raise StripeError(f"unknown action {job.get('action')!r}")
            res.update(fn(job), ok=True)
        except Exception as e:
            failed += 1
            res.update(ok=False, error=str(e)[:300])
        json.dump(res, open(out, "w"), indent=1)
        print(os.path.basename(out), "ok" if res.get("ok") else "FAILED: " + res.get("error", ""))
    return failed


def main():
    if not KEY:
        print("STRIPE_SECRET_KEY secret is missing: checkout links cannot be created yet (see SETUP_NEEDED.md).")
        pending = [f for f in glob.glob(os.path.join(JOBS, "*.json")) if not os.path.exists(os.path.join(OUT, os.path.basename(f)))]
        sys.exit(1 if pending else 0)  # only go red when a client job is actually waiting
    errors = 0
    try:
        setup()
    except Exception as e:
        print("SETUP FAILED:", str(e)[:300])
        errors += 1
    errors += run_jobs()
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--hash":
        print(hashlib.sha256(("ridgeline:" + sys.argv[2].strip().lower()).encode()).hexdigest())
        sys.exit(0)
    main()
