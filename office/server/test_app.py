"""Tests for the Ridgeline AI Office server edition: safety gates, business logic, worker."""
import datetime as dt
import json
import os
import tempfile

import pytest

_tmp = tempfile.mkdtemp(prefix="ridgeline-test-")
os.environ["RIDGELINE_DB"] = os.path.join(_tmp, "test.db")
os.environ["RIDGELINE_BACKUPS"] = os.path.join(_tmp, "backups")
os.environ["RIDGELINE_WORKER"] = "false"
os.environ["RIDGELINE_SCHEDULER"] = "false"
os.environ.pop("RIDGELINE_TOKEN", None)
for k in ("ANTHROPIC_API_KEY", "BRAVE_API_KEY", "SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD"):
    os.environ.pop(k, None)

from fastapi.testclient import TestClient  # noqa: E402

import app  # noqa: E402
import providers as prov  # noqa: E402

client = TestClient(app.app)


@pytest.fixture(autouse=True)
def _fresh_settings():
    app.init_db()
    yield


def clear_queue():
    """Earlier tests leave tasks queued; the worker always claims the oldest, so drain first."""
    with app.db() as conn:
        conn.execute("UPDATE tasks SET status='blocked', error='cleared by test' WHERE status IN ('queued','running')")


def lead(name="Example Roofing Test", town="Test City", state="TS", email="owner@example-roofing.test", **extra):
    data = {"business_name": name, "website": "https://example-roofing.test", "trade": "roofing", "town": town, "state": state,
            "source_url": "https://example-roofing.test/contact", "contact_email": email, "phone": "(555) 010-0100"}
    data.update(extra)
    r = client.post("/api/leads", json=data)
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------- basics
def test_dashboard_loads():
    r = client.get("/")
    assert r.status_code == 200
    assert "Ridgeline AI Office" in r.text and "Agent Floor" in r.text


def test_health_and_status_are_honest():
    h = client.get("/api/health").json()
    assert h["database"] == "connected"
    assert h["worker"] == "disabled"
    s = client.get("/api/status").json()
    assert s["providers"]["ai"]["configured"] is False
    assert s["providers"]["email"]["name"] == "draft-only"
    assert s["mode"] == "DRY RUN"


def test_agents_listed_with_real_state():
    agents = client.get("/api/agents").json()
    assert [a["id"] for a in agents] == ["mara", "scout", "quinn", "parker", "echo", "nova", "sage", "patch"]
    assert all(a["status"] == "idle" for a in agents)


# ----------------------------------------------------------------- leads
def test_create_lead_and_duplicate_blocked():
    lead(name="Dup Co", town="Dupville")
    r = client.post("/api/leads", json={"business_name": "Dup Co", "town": "Dupville", "state": "TS"})
    assert r.status_code == 409


def test_lead_status_validation():
    lid = lead(name="Status Co", town="Statusville")
    assert client.patch(f"/api/leads/{lid}/status?status_value=Nope").status_code == 400
    assert client.patch(f"/api/leads/{lid}/status?status_value=Qualified").status_code == 200
    assert client.get(f"/api/leads/{lid}").json()["status"] == "Qualified"


def test_scoring_is_deterministic_and_explained():
    l = {"profile": {"reviews": 12, "photos": 3, "yelpClaimed": False}, "search_check": {"namedYou": False},
         "website": "https://x.test", "contact_email": "a@x.test", "phone": "1", "contact_name": "Sam", "touches": [], "status": "New"}
    s, why = app.score_lead(l, 60)
    assert s == 20 + 10 + 15 + 5 + 15 + 5 + 5
    assert any("under 30 reviews" in w for w in why) and why[-1].startswith("= ")
    chain = dict(l, profile={"reviews": 500, "rating": 4.9, "chainOrFranchise": True})
    s2, _ = app.score_lead(chain, 60)
    assert s2 < s


def test_quinn_scores_new_leads_and_writes_ai_questions():
    lid = lead(name="Quinn Co", town="Quinnton")
    app.run_quinn({"id": "t", "agent_id": "quinn"})
    l = client.get(f"/api/leads/{lid}").json()
    assert l["score"] > 0 and l["score_why"]
    assert len(l["ai_check"]["questions"]) == 2 and l["ai_check"]["chatgpt"] == "unknown"


def test_call_log_do_not_call_suppresses():
    lid = lead(name="Call Co", town="Callville", email="call@call.test")
    r = client.post(f"/api/leads/{lid}/call", json={"outcome": "do not call"})
    assert r.json()["status"] == "Suppressed"
    assert any(s["email"] == "call@call.test" for s in client.get("/api/suppression").json())
    assert app.is_suppressed("call@call.test")


# ----------------------------------------------------------------- tasks
def test_create_task_and_unknown_agent():
    r = client.post("/api/tasks", json={"agent_id": "scout", "title": "Review approved research sources", "details": "dry-run"})
    assert r.status_code == 200 and r.json()["ok"] is True
    assert client.post("/api/tasks", json={"agent_id": "unknown", "title": "Invalid"}).status_code == 400


def test_pause_blocks_new_tasks_and_worker():
    client.post("/api/pause")
    assert client.post("/api/tasks", json={"agent_id": "mara", "title": "Blocked while paused"}).status_code == 423
    assert app.work_once() is False
    client.post("/api/resume")


def test_worker_claims_runs_and_completes(monkeypatch):
    clear_queue()
    calls = []
    monkeypatch.setitem(app.EXECUTORS, "mara", lambda t: calls.append(t["id"]) or "fake done")
    r = client.post("/api/tasks", json={"agent_id": "mara", "title": "Worker test"})
    tid = r.json()["id"]
    assert app.work_once() is True
    t = next(x for x in client.get("/api/tasks").json() if x["id"] == tid)
    assert t["status"] == "done" and t["result"] == "fake done" and t["attempts"] == 1 and calls == [tid]
    assert client.get("/api/agents").json()[0]["status"] == "idle"


def test_worker_retries_then_fails_within_limit(monkeypatch):
    def boom(t):
        raise RuntimeError("provider exploded")
    monkeypatch.setitem(app.EXECUTORS, "patch", boom)
    clear_queue()
    tid = client.post("/api/tasks", json={"agent_id": "patch", "title": "Retry test"}).json()["id"]
    assert app.work_once() is True
    t = next(x for x in client.get("/api/tasks").json() if x["id"] == tid)
    assert t["status"] == "queued" and t["attempts"] == 1 and "provider exploded" in t["error"]
    assert app.work_once() is True
    t = next(x for x in client.get("/api/tasks").json() if x["id"] == tid)
    assert t["status"] == "failed" and t["attempts"] == 2
    assert app.work_once() is False  # nothing left to claim


def test_not_configured_provider_fails_honestly_without_retry():
    clear_queue()
    tid = client.post("/api/tasks", json={"agent_id": "parker", "title": "Needs AI"}).json()["id"]
    lead(name="Angle Co", town="Angleton")
    client.patch(f"/api/leads/{app.slug('Angleton-TS-Angle Co')}/status?status_value=Qualified")
    assert app.work_once() is True
    t = next(x for x in client.get("/api/tasks").json() if x["id"] == tid)
    assert t["status"] == "failed" and "not configured" in t["error"]
    echo = next(a for a in client.get("/api/agents").json() if a["id"] == "parker")
    assert echo["status"] == "error"


def test_recover_stale_running_tasks():
    tid = client.post("/api/tasks", json={"agent_id": "scout", "title": "Stale"}).json()["id"]
    with app.db() as conn:
        conn.execute("UPDATE tasks SET status='running', lease_until='2000-01-01T00:00:00Z', attempts=1 WHERE id=?", (tid,))
    app.recover_stale()
    t = next(x for x in client.get("/api/tasks").json() if x["id"] == tid)
    assert t["status"] == "queued"


# ---------------------------------------------------------------- drafts
def test_draft_is_saved_not_sent():
    r = client.post("/api/drafts", json={"kind": "outreach", "title": "Test draft", "subject": "hi", "body": "A test message that has not been sent."})
    assert r.status_code == 200 and r.json()["status"] == "ready"
    assert client.get("/api/status").json()["sent_today"] == 0


def test_approve_requires_mailing_address():
    did = client.post("/api/drafts", json={"kind": "outreach", "title": "Needs address", "subject": "s", "body": "b"}).json()["id"]
    app.set_setting("mailing_address", "")
    assert client.post(f"/api/drafts/{did}/approve").status_code == 412
    app.set_setting("mailing_address", "1 Main St, Town, TS 00000")
    r = client.post(f"/api/drafts/{did}/approve")
    assert r.status_code == 200 and r.json()["status"] == "approved"


def test_sending_gates_block_in_dry_run_and_explain():
    lid = lead(name="Gate Co", town="Gateville", email="gate@gate.test")
    client.patch(f"/api/leads/{lid}/status?status_value=Qualified")
    did = client.post("/api/drafts", json={"kind": "outreach", "title": "Gate", "subject": "s", "body": "Gate Co in Gateville, want me to send it?", "lead_id": lid}).json()["id"]
    app.set_setting("mailing_address", "1 Main St")
    client.post(f"/api/drafts/{did}/approve")
    r = client.post(f"/api/drafts/{did}/send-now").json()
    assert r["sent"] is False
    assert "dry run is on" in r["reasons"] and "no email provider configured" in r["reasons"]
    d = next(x for x in client.get("/api/drafts").json() if x["id"] == did)
    assert d["status"] == "approved"  # still approved, nothing lost


def test_live_mode_cannot_be_enabled_without_provider():
    assert client.post("/api/settings", json={"key": "dry_run", "value": "false"}).status_code == 403
    assert client.post("/api/settings", json={"key": "auto_send", "value": "true"}).status_code == 403
    assert client.post("/api/settings", json={"key": "daily_email_cap", "value": "50"}).status_code == 400


def test_send_happens_only_when_every_gate_passes(monkeypatch):
    class FakeEmail(prov.EmailProvider):
        name = "fake"
        sent = []
        def configured(self):
            return True
        def send(self, to, subject, body, from_name, from_addr, reply_to=""):
            self.sent.append((to, subject, body))
            return prov.SendResult(sent=True, message_id="<fake-1@test>")
    fake = FakeEmail()
    monkeypatch.setattr(app.PROVIDERS, "email", fake)
    lid = lead(name="Live Co", town="Liveton", email="live@live.test")
    client.patch(f"/api/leads/{lid}/status?status_value=Qualified")
    app.set_setting("mailing_address", "1 Main St, Town, TS")
    app.set_setting("dry_run", "false")
    did = client.post("/api/drafts", json={"kind": "outreach", "title": "Live", "subject": "quick one", "body": "Live Co in Liveton. Want me to send it?", "lead_id": lid}).json()["id"]
    client.post(f"/api/drafts/{did}/approve")
    tuesday_8am = dt.datetime(2026, 10, 27, 8, 0, tzinfo=app._tz())
    r = app.try_send(did, when=tuesday_8am)
    assert r["sent"] is True and r["message_id"] == "<fake-1@test>"
    assert fake.sent[0][2].rstrip().endswith("1 Main St, Town, TS")  # footer with address
    d = next(x for x in client.get("/api/drafts").json() if x["id"] == did)
    assert d["status"] == "sent" and d["evidence"]["message_id"] == "<fake-1@test>"
    l = client.get(f"/api/leads/{lid}").json()
    assert l["status"] == "Contacted" and len(l["touches"]) == 1 and l["next_touch_at"]
    # a second send to the same approved draft is a no-op; weekend and suppression block others
    assert app.try_send(did, when=tuesday_8am)["note"] == "already sent"
    saturday = dt.datetime(2026, 10, 31, 8, 0, tzinfo=app._tz())
    did2 = client.post("/api/drafts", json={"kind": "followup", "title": "Live 2", "subject": "s", "body": "Live Co, Liveton?", "lead_id": lid}).json()["id"]
    client.post(f"/api/drafts/{did2}/approve")
    assert "weekend" in app.try_send(did2, when=saturday)["reasons"]
    client.post("/api/replies/opt-out?email=live@live.test&text=no thanks")
    assert "address or business is on the suppression list" in app.try_send(did2, when=tuesday_8am)["reasons"]
    app.set_setting("dry_run", "true")


def test_daily_cap_blocks(monkeypatch):
    app.set_setting("daily_email_cap", "1")
    app.set_setting("mailing_address", "1 Main St")
    with app.db() as conn:
        conn.execute("INSERT INTO sends(id,day,draft_id,lead_id,to_email,message_id,created_at) VALUES('x',?,'d','l','a@b.c','m','t')", (app.day_key(),))
    lid = lead(name="Cap Co", town="Capville", email="cap@cap.test")
    client.patch(f"/api/leads/{lid}/status?status_value=Qualified")
    did = client.post("/api/drafts", json={"kind": "outreach", "title": "Cap", "subject": "s", "body": "Cap Co, Capville?", "lead_id": lid}).json()["id"]
    client.post(f"/api/drafts/{did}/approve")
    reasons = app.sending_gates(app.one("SELECT * FROM drafts WHERE id=?", (did,)), app.one("SELECT * FROM leads WHERE id=?", (lid,)), app.all_settings(),
                                dt.datetime(2026, 10, 27, 8, 0, tzinfo=app._tz()))
    assert "daily cap reached" in reasons
    app.set_setting("daily_email_cap", "10")


def test_qa_gate_flags_hype_and_rewards_levers():
    st = app.all_settings()
    l = {"business_name": "Pine Hill Roofing", "town": "Cabot"}
    bad = app.qa_gate("UNLOCK GROWTH NOW", "Elevate your business with a seamless game-changer!!! 🎉", l, "outreach", st)
    assert bad["score"] < 60 and any("banned word" in f for f in bad["flags"]) and "emoji" in bad["flags"]
    good = app.qa_gate("what ChatGPT says about roofers in Cabot",
                       "When someone in Cabot asks ChatGPT for a roofer it names 3 companies. Not Pine Hill Roofing. Your profile shows 14 reviews. "
                       "I put together a free check with the screenshots and the 3 fixes. Want me to send it?", l, "outreach", st)
    assert good["score"] >= 80 and set(["their loss", "give first", "specificity", "tiny ask"]) <= set(good["levers"])


# -------------------------------------------------------------- learning
def test_lesson_is_saved():
    r = client.post("/api/lessons", json={"title": "Test lesson", "observation": "Verify outcomes before changing a workflow.", "evidence": "Automated test", "confidence": 90})
    assert r.status_code == 200


def test_workflow_version_lifecycle_and_rollback():
    r = client.post("/api/workflow", json={"stage": "echo", "change": "shorter subject", "prediction": "+2 points", "eval_sends": 10}).json()
    v = r["version"]
    assert client.get("/api/settings").json()["workflow_version"] == v
    e = client.post(f"/api/workflow/{v}/evaluate").json()
    assert e["verdict"] == "testing"  # no sends yet
    rb = client.post(f"/api/workflow/{v}/rollback").json()
    assert rb["active"] == "v1"
    assert next(w for w in client.get("/api/workflow").json() if w["version"] == v)["verdict"] == "rolled back"


def test_sage_refuses_lessons_under_20_sends():
    out = app.run_sage({"id": "t", "agent_id": "sage"})
    assert "too early" in out


# ------------------------------------------------------------ operations
def test_backup_creates_file_and_prunes():
    r = client.post("/api/backup").json()
    assert r["ok"] and r["file"].startswith("ridgeline-")
    assert r["file"] in client.get("/api/health").json()["backups"]


def test_patch_resets_stale_state_and_backs_up():
    with app.db() as conn:
        conn.execute("UPDATE crew SET state='working', last_activity='2000-01-01T00:00:00Z' WHERE id='scout'")
    out = app.run_patch({"id": "self", "agent_id": "patch"})
    assert "backup ridgeline-" in out and "stale crew state" in out
    assert next(a for a in client.get("/api/agents").json() if a["id"] == "scout")["status"] == "idle"


def test_day_shift_enqueues_pipeline():
    before = client.get("/api/status").json()["tasks_queued"]
    r = client.post("/api/run-day-shift").json()
    assert r["run_id"].startswith("run-")
    after = client.get("/api/status").json()["tasks_queued"]
    assert after - before >= 7
    assert client.get("/api/runs").json()[0]["id"] == r["run_id"]


def test_auth_required_when_token_set(monkeypatch):
    monkeypatch.setattr(app, "TOKEN", "secret-token")
    assert client.post("/api/pause").status_code == 401
    assert client.post("/api/pause", headers={"Authorization": "Bearer secret-token"}).status_code == 200
    client.post("/api/resume", headers={"Authorization": "Bearer secret-token"})
    assert client.get("/api/status").status_code == 200  # reads stay open


def test_providers_report_without_keys():
    p = prov.from_env()
    assert p.status() == {"ai": {"name": "none", "configured": False}, "research": {"name": "none", "configured": False}, "email": {"name": "draft-only", "configured": False}}
    with pytest.raises(prov.NotConfigured):
        p.ai.complete("s", "p")
    assert p.email.send("a@b.c", "s", "b", "n", "f").sent is False


def test_read_site_extracts_published_email_without_guessing():
    assert prov.read_site("")["ok"] is False
    assert prov.EMAIL_RE.findall("Call us or email office@pinehill.example today") == ["office@pinehill.example"]
    assert prov.PHONE_RE.search("Office (501) 555-0142 open daily").group(0).strip() == "(501) 555-0142"


def teardown_module():
    client.close()
