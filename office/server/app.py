"""Ridgeline AI Office — server edition (FastAPI + SQLite).

Run:    uvicorn app:app --host 127.0.0.1 --port 8000
Tests:  pytest -q
Worker: starts inside the app (RIDGELINE_WORKER=true, the default) or separately: python worker.py

Everything that reaches the outside world goes through providers.py and through the gates in
`sending_gates()`. The default install is DRY RUN + draft-only: it researches (if a research
provider is configured), scores, writes, queues, learns and reports, and sends nothing.
Honesty rules: counts come from the database; nothing is invented; a draft is never called sent
without a provider message id; integration status is reported as configured/not configured.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

import providers as prov

APP_NAME = "Ridgeline AI Office"
VERSION = "2.0.0"
HERE = Path(__file__).resolve().parent
DB_PATH = os.getenv("RIDGELINE_DB", str(HERE / "ridgeline.db"))
BACKUP_DIR = Path(os.getenv("RIDGELINE_BACKUPS", str(HERE / "backups")))
TOKEN = os.getenv("RIDGELINE_TOKEN", "")
WORKER_ENABLED = os.getenv("RIDGELINE_WORKER", "true").lower() == "true"
SCHEDULER_ENABLED = os.getenv("RIDGELINE_SCHEDULER", "true").lower() == "true"
TZ = os.getenv("RIDGELINE_TZ", "America/Chicago")

AGENTS = [
    {"id": "mara", "name": "Mara", "role": "Commander"},
    {"id": "scout", "name": "Scout", "role": "Lead research"},
    {"id": "quinn", "name": "Quinn", "role": "Qualification"},
    {"id": "parker", "name": "Parker", "role": "Offer strategist"},
    {"id": "echo", "name": "Echo", "role": "Outreach writer"},
    {"id": "nova", "name": "Nova", "role": "Creative studio"},
    {"id": "sage", "name": "Sage", "role": "Learning and review"},
    {"id": "patch", "name": "Patch", "role": "Maintenance"},
]
AGENT_IDS = {a["id"] for a in AGENTS}
LEAD_STATUSES = ["New", "Researching", "Qualified", "Contacted", "Replied", "Meeting", "Client", "Not a fit", "Suppressed"]
DRAFT_STATUSES = ["draft", "ready", "approved", "sent", "rejected", "failed", "brief", "filmed", "posted"]
TASK_STATUSES = ["queued", "running", "done", "failed", "blocked"]
BANNED_WORDS = ["elevate", "unlock", "seamless", "game-changer", "dive into", "leverage", "synergy", "look no further", "in today's digital landscape"]
DEFAULT_SETTINGS: dict[str, Any] = {
    "paused": "false", "dry_run": "true", "auto_send": "false", "daily_email_cap": "10",
    "follow_up_days": "4", "max_touches": "3", "score_gate": "60", "founding_spots": "10",
    "business_name": "Ridgeline Local", "from_name": "Grayson at Ridgeline Local",
    "from_email": "ridgelinemarketinghq@gmail.com", "signature": "Grayson\nRidgeline Local",
    "opt_out_line": "If you'd rather not hear from me, reply 'no thanks' and I'll stop.",
    "mailing_address": "", "site_url": "https://ridgelinehq.github.io",
    "targets": json.dumps([{"town": "Owasso", "state": "OK", "trades": ["roofing", "tree service"]},
                           {"town": "Cabot", "state": "AR", "trades": ["roofing", "tree service"]},
                           {"town": "Foley", "state": "AL", "trades": ["roofing", "tree service"]}]),
    "next_target": "0", "send_window": "07:00-09:30", "day_shift_time": "06:41",
    "workflow_version": "v1", "sending_since": "",
}

app = FastAPI(title=APP_NAME, version=VERSION)
PROVIDERS = prov.from_env()
_worker_state = {"alive": False, "heartbeat": "", "last_task": "", "thread": None, "stop": threading.Event()}
_scheduler_state = {"alive": False, "last_tick": "", "last_fired": "", "thread": None}


# ============================================================================ time
def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _tz():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(TZ)
    except Exception:
        return dt.timezone.utc


def local_now() -> dt.datetime:
    return dt.datetime.now(_tz())


def day_key(when: Optional[dt.datetime] = None) -> str:
    return (when or local_now()).strftime("%Y-%m-%d")


def parse_iso(s: str) -> Optional[dt.datetime]:
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


# ============================================================================== db
@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("BEGIN")
        yield conn
        if conn.in_transaction:
            conn.execute("COMMIT")
    except Exception:
        if conn.in_transaction:
            with contextlib.suppress(Exception):
                conn.execute("ROLLBACK")
        raise
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY, business_name TEXT NOT NULL, trade TEXT DEFAULT '', town TEXT DEFAULT '', state TEXT DEFAULT '',
  website TEXT DEFAULT '', phone TEXT DEFAULT '', phone_source TEXT DEFAULT '', contact_email TEXT DEFAULT '',
  email_source TEXT DEFAULT '', contact_name TEXT DEFAULT '', source_url TEXT DEFAULT '', industry TEXT DEFAULT '',
  location TEXT DEFAULT '', notes TEXT DEFAULT '', profile TEXT DEFAULT '{}', search_check TEXT DEFAULT '{}',
  ai_check TEXT DEFAULT '{}', angle TEXT DEFAULT '{}', score INTEGER DEFAULT 0, score_why TEXT DEFAULT '[]',
  status TEXT DEFAULT 'New', touches TEXT DEFAULT '[]', next_touch_at TEXT DEFAULT '', calls TEXT DEFAULT '[]',
  source TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL, details TEXT DEFAULT '', kind TEXT DEFAULT 'manual',
  payload TEXT DEFAULT '{}', status TEXT DEFAULT 'queued', result TEXT DEFAULT '', error TEXT DEFAULT '',
  attempts INTEGER DEFAULT 0, max_attempts INTEGER DEFAULT 2, lease_until TEXT DEFAULT '', run_id TEXT DEFAULT '',
  started_at TEXT DEFAULT '', finished_at TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, lead_id TEXT DEFAULT '', title TEXT NOT NULL, subject TEXT DEFAULT '',
  body TEXT NOT NULL, touch INTEGER DEFAULT 1, status TEXT DEFAULT 'draft', qa TEXT DEFAULT '{}',
  evidence TEXT DEFAULT '{}', error TEXT DEFAULT '', approved_at TEXT DEFAULT '', edited_at TEXT DEFAULT '',
  created_by TEXT DEFAULT '', workflow_version TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lessons (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, observation TEXT NOT NULL, evidence TEXT DEFAULT '',
  confidence INTEGER DEFAULT 50, agent TEXT DEFAULT '', predicted TEXT DEFAULT '', observed TEXT DEFAULT '',
  workflow_version TEXT DEFAULT '', status TEXT DEFAULT 'active', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow (
  version TEXT PRIMARY KEY, stage TEXT NOT NULL, change TEXT NOT NULL, prediction TEXT DEFAULT '',
  template TEXT DEFAULT '', previous_version TEXT DEFAULT '', eval_sends INTEGER DEFAULT 30,
  result TEXT DEFAULT '{}', verdict TEXT DEFAULT 'testing', proposed_at TEXT NOT NULL, decided_at TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS suppression (
  id TEXT PRIMARY KEY, email TEXT DEFAULT '', domain TEXT DEFAULT '', business_name TEXT DEFAULT '',
  reason TEXT DEFAULT '', by_who TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, summary TEXT NOT NULL, detail TEXT DEFAULT '', status TEXT DEFAULT 'pending',
  decided_at TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY, lead_id TEXT DEFAULT '', business_name TEXT NOT NULL, plan TEXT DEFAULT 'founding',
  monthly INTEGER DEFAULT 147, started_at TEXT DEFAULT '', reviews_at_start INTEGER, reviews_now INTEGER,
  status TEXT DEFAULT 'active', notes TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, task TEXT NOT NULL, day TEXT NOT NULL, town TEXT DEFAULT '', status TEXT DEFAULT 'running',
  stages TEXT DEFAULT '[]', counts TEXT DEFAULT '{}', summary TEXT DEFAULT '', needs_you TEXT DEFAULT '[]',
  started_at TEXT NOT NULL, finished_at TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY, event TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS usage (id TEXT PRIMARY KEY, provider TEXT NOT NULL, model TEXT DEFAULT '', input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0, task_id TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sends (id TEXT PRIMARY KEY, day TEXT NOT NULL, draft_id TEXT NOT NULL, lead_id TEXT DEFAULT '',
  to_email TEXT NOT NULL, message_id TEXT DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS crew (id TEXT PRIMARY KEY, state TEXT DEFAULT 'idle', task TEXT DEFAULT '', last_activity TEXT DEFAULT '',
  last_result TEXT DEFAULT '', last_error TEXT DEFAULT '', runs INTEGER DEFAULT 0, done INTEGER DEFAULT 0, failed INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
CREATE INDEX IF NOT EXISTS idx_sends_day ON sends(day);
"""


def init_db() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    with db() as conn:
        conn.executescript(SCHEMA)
        for k, v in DEFAULT_SETTINGS.items():
            conn.execute("INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)", (k, v))
        for a in AGENTS:
            conn.execute("INSERT OR IGNORE INTO crew(id, state, task) VALUES (?, 'idle', 'Available')", (a["id"],))


def setting(key: str, default: str = "") -> str:
    with db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default


def set_setting(key: str, value: Any) -> None:
    with db() as conn:
        conn.execute("INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, str(value)))


def all_settings() -> dict[str, Any]:
    with db() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    out = {r["key"]: r["value"] for r in rows}
    out["targets"] = json.loads(out.get("targets") or "[]")
    for k in ("paused", "dry_run", "auto_send"):
        out[k] = out.get(k, "false") == "true"
    for k in ("daily_email_cap", "follow_up_days", "max_touches", "score_gate", "founding_spots", "next_target"):
        out[k] = int(out.get(k, 0) or 0)
    return out


def flag(key: str) -> bool:
    return setting(key, "false") == "true"


def audit(event: str, details: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute("INSERT INTO audit(id, event, details, created_at) VALUES (?, ?, ?, ?)", (str(uuid.uuid4()), event, json.dumps(details)[:4000], now()))


def rows(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with db() as conn:
        return [dict(r) for r in conn.execute(sql, params).fetchall()]


def one(sql: str, params: tuple = ()) -> Optional[dict[str, Any]]:
    with db() as conn:
        r = conn.execute(sql, params).fetchone()
        return dict(r) if r else None


def count(table: str, where: str = "1=1", params: tuple = ()) -> int:
    allowed = {"leads", "tasks", "drafts", "lessons", "suppression", "approvals", "clients", "runs", "sends", "workflow", "usage"}
    if table not in allowed:
        raise ValueError("Unsupported table")
    with db() as conn:
        return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", params).fetchone()[0]


JSON_FIELDS = {"leads": ("profile", "search_check", "ai_check", "angle", "score_why", "touches", "calls"),
               "drafts": ("qa", "evidence"), "tasks": ("payload",), "runs": ("stages", "counts", "needs_you"), "workflow": ("result",)}


def hydrate(table: str, row: dict[str, Any]) -> dict[str, Any]:
    for f in JSON_FIELDS.get(table, ()):
        if isinstance(row.get(f), str):
            try:
                row[f] = json.loads(row[f] or "null")
            except Exception:
                pass
    return row


def slug(s: str) -> str:
    s = re.sub(r"&", " and ", s.lower())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:80] or "x"


def crew_set(agent: str, state: str, task: str = "", result: str = "", error: str = "") -> None:
    with db() as conn:
        conn.execute("UPDATE crew SET state=?, task=?, last_activity=?, last_result=COALESCE(NULLIF(?, ''), last_result), last_error=? WHERE id=?",
                     (state, task[:120], now(), result[:300], error[:300], agent))


# ========================================================================== models
class LeadInput(BaseModel):
    business_name: str = Field(min_length=2, max_length=200)
    trade: str = Field(default="", max_length=60)
    town: str = Field(default="", max_length=120)
    state: str = Field(default="", max_length=2)
    website: str = Field(default="", max_length=500)
    contact_name: str = Field(default="", max_length=200)
    contact_email: str = Field(default="", max_length=320)
    phone: str = Field(default="", max_length=40)
    source_url: str = Field(default="", max_length=1000)
    industry: str = Field(default="", max_length=200)
    location: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=5000)
    score: int = Field(default=0, ge=0, le=100)


class TaskInput(BaseModel):
    agent_id: str
    title: str = Field(min_length=2, max_length=200)
    details: str = Field(default="", max_length=5000)
    kind: str = Field(default="manual", max_length=40)


class DraftInput(BaseModel):
    kind: str = Field(default="content", max_length=50)
    title: str = Field(min_length=2, max_length=200)
    subject: str = Field(default="", max_length=200)
    body: str = Field(min_length=1, max_length=20000)
    lead_id: str = Field(default="", max_length=120)


class DraftEdit(BaseModel):
    subject: Optional[str] = Field(default=None, max_length=200)
    body: Optional[str] = Field(default=None, max_length=20000)


class LessonInput(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    observation: str = Field(min_length=1, max_length=5000)
    evidence: str = Field(default="", max_length=2000)
    confidence: int = Field(default=50, ge=0, le=100)
    agent: str = Field(default="", max_length=40)


class SettingInput(BaseModel):
    key: str
    value: str = Field(max_length=5000)


class SuppressionInput(BaseModel):
    value: str = Field(min_length=2, max_length=320)
    reason: str = Field(default="asked to stop", max_length=200)


class WorkflowInput(BaseModel):
    stage: str = Field(min_length=2, max_length=40)
    change: str = Field(min_length=2, max_length=2000)
    prediction: str = Field(default="", max_length=500)
    template: str = Field(default="", max_length=8000)
    eval_sends: int = Field(default=30, ge=10, le=500)


class CallLog(BaseModel):
    outcome: str = Field(min_length=2, max_length=40)
    note: str = Field(default="", max_length=500)


# ============================================================================ auth
EDITABLE_SETTINGS = {"paused", "dry_run", "auto_send", "daily_email_cap", "follow_up_days", "max_touches", "score_gate",
                     "founding_spots", "business_name", "from_name", "from_email", "signature", "opt_out_line",
                     "mailing_address", "site_url", "targets", "next_target", "send_window", "day_shift_time"}


def require_auth(request: Request) -> None:
    """State-changing endpoints: a bearer token when RIDGELINE_TOKEN is set; otherwise loopback only."""
    if TOKEN:
        header = request.headers.get("authorization", "")
        if header != f"Bearer {TOKEN}":
            raise HTTPException(401, "Missing or wrong token. Send Authorization: Bearer <RIDGELINE_TOKEN>.")
        return
    host = request.client.host if request.client else ""
    if host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(403, "Set RIDGELINE_TOKEN before exposing this office beyond localhost.")


# ========================================================================= startup
@app.on_event("startup")
def startup() -> None:
    init_db()
    recover_stale()
    audit("application_started", {"dry_run": flag("dry_run"), "providers": PROVIDERS.status()})
    if WORKER_ENABLED:
        start_worker()
    if SCHEDULER_ENABLED:
        start_scheduler()


@app.on_event("shutdown")
def shutdown() -> None:
    _worker_state["stop"].set()


# ======================================================================== dashboard
@app.get("/", response_class=HTMLResponse)
def home() -> HTMLResponse:
    path = HERE / "dashboard.html"
    if not path.exists():
        return HTMLResponse("<h1>Ridgeline AI Office</h1><p>dashboard.html is missing next to app.py.</p>", status_code=200)
    return HTMLResponse(path.read_text(encoding="utf-8"))


# ============================================================================ status
def lead_counts() -> dict[str, int]:
    out = {s: 0 for s in LEAD_STATUSES}
    for r in rows("SELECT status, COUNT(*) AS n FROM leads GROUP BY status"):
        out[r["status"]] = r["n"]
    return out


def sent_today() -> int:
    return count("sends", "day = ?", (day_key(),))


@app.get("/api/status")
def status() -> dict[str, Any]:
    st = all_settings()
    c = lead_counts()
    mode = "PAUSED" if st["paused"] else ("DRY RUN" if st["dry_run"] else ("LIVE · AUTOSEND" if st["auto_send"] else "LIVE · APPROVE EACH"))
    return {
        "app": APP_NAME, "version": VERSION, "time": now(), "day": day_key(), "mode": mode,
        "paused": st["paused"], "dry_run": st["dry_run"], "auto_send": st["auto_send"],
        "worker": {"enabled": WORKER_ENABLED, "alive": _worker_state["alive"], "heartbeat": _worker_state["heartbeat"], "last_task": _worker_state["last_task"]},
        "scheduler": {"enabled": SCHEDULER_ENABLED, "alive": _scheduler_state["alive"], "last_tick": _scheduler_state["last_tick"], "last_fired": _scheduler_state["last_fired"], "day_shift_time": st["day_shift_time"]},
        "providers": PROVIDERS.status(),
        "leads": sum(c.values()), "leads_by_status": c,
        "tasks_queued": count("tasks", "status='queued'"), "tasks_running": count("tasks", "status='running'"),
        "tasks_done": count("tasks", "status='done'"), "tasks_failed": count("tasks", "status='failed'"),
        "drafts": count("drafts"), "drafts_ready": count("drafts", "status='ready'"), "drafts_approved": count("drafts", "status='approved'"),
        "sent_today": sent_today(), "daily_email_cap": st["daily_email_cap"], "lessons": count("lessons"),
        "clients": count("clients", "status='active'"), "monthly_revenue": (one("SELECT COALESCE(SUM(monthly),0) AS s FROM clients WHERE status='active'") or {}).get("s", 0),
        "mailing_address_set": bool(st["mailing_address"]), "needs_you": needs_you(),
    }


def needs_you() -> list[dict[str, str]]:
    st = all_settings()
    out: list[dict[str, str]] = []
    if not st["mailing_address"]:
        out.append({"t": "Add a mailing address in Settings", "s": "Email law requires one in the footer; nothing can be sent without it."})
    n = count("drafts", "status='ready'")
    if n:
        out.append({"t": f"Approve {n} email{'s' if n != 1 else ''} waiting for your OK", "s": "Outreach → Ready."})
    for t in rows("SELECT id, title, details FROM tasks WHERE agent_id='grayson' AND status='queued' ORDER BY created_at LIMIT 10"):
        out.append({"t": t["title"], "s": t["details"] or ""})
    for a in rows("SELECT summary, detail FROM approvals WHERE status='pending' ORDER BY created_at DESC LIMIT 10"):
        out.append({"t": a["summary"], "s": a["detail"] or ""})
    if not PROVIDERS.ai.configured():
        out.append({"t": "No AI provider configured", "s": "Set ANTHROPIC_API_KEY so Quinn, Parker and Echo can work; until then tasks report 'not configured'."})
    return out


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        with db() as conn:
            conn.execute("SELECT 1").fetchone()
    except Exception:
        raise HTTPException(503, "Database health check failed")
    hb = parse_iso(_worker_state["heartbeat"]) if _worker_state["heartbeat"] else None
    worker_ok = _worker_state["alive"] and hb is not None and (dt.datetime.now(dt.timezone.utc) - hb).total_seconds() < 120
    return {"ok": True, "database": "connected", "worker": "running" if worker_ok else ("disabled" if not WORKER_ENABLED else "not running"),
            "scheduler": "running" if _scheduler_state["alive"] else ("disabled" if not SCHEDULER_ENABLED else "not running"),
            "providers": PROVIDERS.status(), "dry_run": flag("dry_run"), "paused": flag("paused"), "timestamp": now(),
            "backups": sorted(p.name for p in BACKUP_DIR.glob("*.db")) if BACKUP_DIR.exists() else []}


@app.get("/api/agents")
def get_agents() -> list[dict[str, Any]]:
    crew = {r["id"]: r for r in rows("SELECT * FROM crew")}
    paused = flag("paused")
    out = []
    for a in AGENTS:
        c = crew.get(a["id"], {})
        out.append({**a, "status": "paused" if paused else (c.get("state") or "idle"), "current_task": c.get("task") or "Available",
                    "last_activity": c.get("last_activity", ""), "last_result": c.get("last_result", ""), "last_error": c.get("last_error", ""),
                    "stats": {"runs": c.get("runs", 0), "done": c.get("done", 0), "failed": c.get("failed", 0)}})
    return out


# ============================================================================= leads
@app.get("/api/leads")
def get_leads(status_value: str = "", limit: int = 500) -> list[dict[str, Any]]:
    if status_value:
        data = rows("SELECT * FROM leads WHERE status=? ORDER BY score DESC, updated_at DESC LIMIT ?", (status_value, min(limit, 2000)))
    else:
        data = rows("SELECT * FROM leads ORDER BY score DESC, updated_at DESC LIMIT ?", (min(limit, 2000),))
    return [hydrate("leads", r) for r in data]


@app.get("/api/leads/{lead_id}")
def get_lead(lead_id: str) -> dict[str, Any]:
    r = one("SELECT * FROM leads WHERE id=?", (lead_id,))
    if not r:
        raise HTTPException(404, "Lead not found")
    r = hydrate("leads", r)
    r["drafts"] = [hydrate("drafts", d) for d in rows("SELECT * FROM drafts WHERE lead_id=? ORDER BY created_at DESC", (lead_id,))]
    return r


def is_suppressed(email: str, business_name: str = "") -> bool:
    email = (email or "").lower().strip()
    domain = email.split("@")[-1] if "@" in email else ""
    with db() as conn:
        if email and conn.execute("SELECT 1 FROM suppression WHERE email=?", (email,)).fetchone():
            return True
        if domain and conn.execute("SELECT 1 FROM suppression WHERE domain=? AND domain != ''", (domain,)).fetchone():
            return True
        if business_name and conn.execute("SELECT 1 FROM suppression WHERE lower(business_name)=lower(?) AND business_name != ''", (business_name,)).fetchone():
            return True
    return False


def create_lead_record(data: dict[str, Any], source: str) -> str:
    town = data.get("town") or data.get("location") or ""
    lead_id = slug(f"{town}-{data.get('state','')}-{data['business_name']}")
    ts = now()
    with db() as conn:
        if conn.execute("SELECT 1 FROM leads WHERE id=?", (lead_id,)).fetchone():
            raise HTTPException(409, "A matching business already exists.")
        dup = conn.execute("SELECT id FROM leads WHERE lower(trim(business_name))=lower(trim(?)) AND lower(trim(town))=lower(trim(?))",
                           (data["business_name"], town)).fetchone()
        if dup:
            raise HTTPException(409, "A matching business already exists.")
        profile = {"sources": [{"url": data["source_url"], "what": source, "at": ts}] if data.get("source_url") else []}
        conn.execute("""INSERT INTO leads(id,business_name,trade,town,state,website,phone,phone_source,contact_email,email_source,contact_name,
                        source_url,industry,location,notes,profile,score,status,source,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (lead_id, data["business_name"], data.get("trade") or data.get("industry", ""), town, (data.get("state") or "").upper(),
                      data.get("website", ""), data.get("phone", ""), data.get("source_url", "") if data.get("phone") else "",
                      (data.get("contact_email") or "").lower(), data.get("source_url", "") if data.get("contact_email") else "",
                      data.get("contact_name", ""), data.get("source_url", ""), data.get("industry", ""), data.get("location", ""),
                      data.get("notes", ""), json.dumps(profile), int(data.get("score", 0) or 0), "New", source, ts, ts))
    audit("lead_created", {"id": lead_id, "business_name": data["business_name"], "source": source})
    return lead_id


@app.post("/api/leads", dependencies=[Depends(require_auth)])
def create_lead(data: LeadInput) -> dict[str, Any]:
    lead_id = create_lead_record(data.model_dump(), "added on the dashboard")
    return {"ok": True, "id": lead_id}


@app.patch("/api/leads/{lead_id}/status", dependencies=[Depends(require_auth)])
def update_lead_status(lead_id: str, status_value: str) -> dict[str, Any]:
    if status_value not in LEAD_STATUSES:
        raise HTTPException(400, "Invalid lead status")
    with db() as conn:
        r = conn.execute("UPDATE leads SET status=?, updated_at=? WHERE id=?", (status_value, now(), lead_id))
        if r.rowcount == 0:
            raise HTTPException(404, "Lead not found")
    if status_value == "Suppressed":
        lead = one("SELECT contact_email, business_name FROM leads WHERE id=?", (lead_id,)) or {}
        add_suppression(lead.get("contact_email") or lead.get("business_name") or lead_id, "marked on the dashboard", "grayson")
    audit("lead_status_updated", {"id": lead_id, "status": status_value})
    return {"ok": True}


@app.post("/api/leads/{lead_id}/call", dependencies=[Depends(require_auth)])
def log_call(lead_id: str, data: CallLog) -> dict[str, Any]:
    allowed = {"answered", "voicemail", "no answer", "interested", "not interested", "do not call", "wrong number"}
    if data.outcome not in allowed:
        raise HTTPException(400, "Unknown outcome")
    lead = one("SELECT * FROM leads WHERE id=?", (lead_id,))
    if not lead:
        raise HTTPException(404, "Lead not found")
    calls = json.loads(lead["calls"] or "[]")
    calls.append({"t": now(), "who": "grayson", "outcome": data.outcome, "note": data.note})
    status_value = lead["status"]
    if data.outcome == "interested":
        status_value = "Replied"
    if data.outcome == "do not call":
        status_value = "Suppressed"
        add_suppression(lead["contact_email"] or lead["business_name"], "asked on call", "grayson")
    with db() as conn:
        conn.execute("UPDATE leads SET calls=?, status=?, updated_at=? WHERE id=?", (json.dumps(calls), status_value, now(), lead_id))
    audit("call_logged", {"id": lead_id, "outcome": data.outcome})
    return {"ok": True, "status": status_value}


@app.get("/api/calls")
def call_list() -> list[dict[str, Any]]:
    """Qualified leads with a published phone, ranked. The office never dials; this is for a human."""
    data = [hydrate("leads", r) for r in rows("SELECT * FROM leads WHERE status='Qualified' AND phone != '' ORDER BY score DESC LIMIT 100")]
    for i, l in enumerate(data, 1):
        l["call_rank"] = i
        l["call_window"] = "7:00-8:15 AM" if i % 2 else "4:00-6:00 PM"
    return data


# ============================================================================= tasks
@app.get("/api/tasks")
def get_tasks(limit: int = 300) -> list[dict[str, Any]]:
    return [hydrate("tasks", r) for r in rows("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (min(limit, 1000),))]


def enqueue(agent_id: str, title: str, details: str = "", kind: str = "manual", payload: Optional[dict[str, Any]] = None, run_id: str = "") -> str:
    if agent_id not in AGENT_IDS and agent_id != "grayson":
        raise HTTPException(400, "Unknown agent")
    task_id = str(uuid.uuid4())
    ts = now()
    with db() as conn:
        conn.execute("INSERT INTO tasks(id,agent_id,title,details,kind,payload,status,run_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                     (task_id, agent_id, title, details, kind, json.dumps(payload or {}), "queued", run_id, ts, ts))
    audit("task_queued", {"id": task_id, "agent": agent_id, "kind": kind})
    return task_id


@app.post("/api/tasks", dependencies=[Depends(require_auth)])
def create_task(data: TaskInput) -> dict[str, Any]:
    if data.agent_id not in AGENT_IDS:
        raise HTTPException(400, "Unknown agent")
    if flag("paused"):
        raise HTTPException(423, "Office is paused")
    task_id = enqueue(data.agent_id, data.title, data.details, data.kind or "manual")
    return {"ok": True, "id": task_id, "note": "Queued. The worker picks it up within a few seconds when running."}


@app.post("/api/tasks/{task_id}/complete", dependencies=[Depends(require_auth)])
def complete_task(task_id: str, result: str = "") -> dict[str, Any]:
    with db() as conn:
        r = conn.execute("UPDATE tasks SET status='done', result=?, finished_at=?, updated_at=? WHERE id=? AND status IN ('queued','running')",
                         (result[:5000], now(), now(), task_id))
        if r.rowcount == 0:
            raise HTTPException(404, "Active task not found")
    audit("task_marked_completed", {"id": task_id, "by": "human"})
    return {"ok": True, "note": "Marked done by a human; this does not prove external work occurred."}


@app.post("/api/tasks/{task_id}/retry", dependencies=[Depends(require_auth)])
def retry_task(task_id: str) -> dict[str, Any]:
    with db() as conn:
        r = conn.execute("UPDATE tasks SET status='queued', error='', lease_until='', updated_at=? WHERE id=? AND status='failed'", (now(), task_id))
        if r.rowcount == 0:
            raise HTTPException(404, "Failed task not found")
    return {"ok": True}


# ============================================================================ drafts
@app.get("/api/drafts")
def get_drafts(status_value: str = "", limit: int = 300) -> list[dict[str, Any]]:
    if status_value:
        data = rows("SELECT * FROM drafts WHERE status=? ORDER BY created_at DESC LIMIT ?", (status_value, min(limit, 1000)))
    else:
        data = rows("SELECT * FROM drafts ORDER BY created_at DESC LIMIT ?", (min(limit, 1000),))
    return [hydrate("drafts", r) for r in data]


def insert_draft(kind: str, title: str, subject: str, body: str, lead_id: str = "", touch: int = 1, status_value: str = "draft",
                 qa: Optional[dict[str, Any]] = None, created_by: str = "") -> str:
    draft_id = str(uuid.uuid4())
    ts = now()
    with db() as conn:
        conn.execute("""INSERT INTO drafts(id,kind,lead_id,title,subject,body,touch,status,qa,created_by,workflow_version,created_at,updated_at)
                        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (draft_id, kind, lead_id, title, subject, body, touch, status_value, json.dumps(qa or {}), created_by, setting("workflow_version", "v1"), ts, ts))
    audit("draft_created", {"id": draft_id, "kind": kind, "status": status_value})
    return draft_id


@app.post("/api/drafts", dependencies=[Depends(require_auth)])
def create_draft(data: DraftInput) -> dict[str, Any]:
    status_value = "ready" if data.kind in ("outreach", "followup", "breakup") else "draft"
    draft_id = insert_draft(data.kind, data.title, data.subject, data.body, data.lead_id, status_value=status_value, created_by="human")
    return {"ok": True, "id": draft_id, "status": status_value}


@app.patch("/api/drafts/{draft_id}", dependencies=[Depends(require_auth)])
def edit_draft(draft_id: str, data: DraftEdit) -> dict[str, Any]:
    d = one("SELECT * FROM drafts WHERE id=?", (draft_id,))
    if not d:
        raise HTTPException(404, "Draft not found")
    if d["status"] == "sent":
        raise HTTPException(409, "A sent email cannot be edited")
    with db() as conn:
        conn.execute("UPDATE drafts SET subject=COALESCE(?, subject), body=COALESCE(?, body), edited_at=?, updated_at=? WHERE id=?",
                     (data.subject, data.body, now(), now(), draft_id))
    return {"ok": True}


@app.post("/api/drafts/{draft_id}/approve", dependencies=[Depends(require_auth)])
def approve_draft(draft_id: str) -> dict[str, Any]:
    d = one("SELECT * FROM drafts WHERE id=?", (draft_id,))
    if not d:
        raise HTTPException(404, "Draft not found")
    if d["status"] not in ("ready", "draft"):
        raise HTTPException(409, f"Draft is {d['status']}, not ready")
    if not setting("mailing_address"):
        raise HTTPException(412, "Add a mailing address in Settings first (required in every email footer).")
    with db() as conn:
        conn.execute("UPDATE drafts SET status='approved', approved_at=?, updated_at=? WHERE id=?", (now(), now(), draft_id))
    audit("draft_approved", {"id": draft_id})
    enqueue("echo", f"Send approved email: {d['title']}", kind="send", payload={"draft_id": draft_id})
    return {"ok": True, "status": "approved", "note": "Queued for Echo. It goes out only if every sending gate passes."}


@app.post("/api/drafts/{draft_id}/reject", dependencies=[Depends(require_auth)])
def reject_draft(draft_id: str) -> dict[str, Any]:
    with db() as conn:
        r = conn.execute("UPDATE drafts SET status='rejected', updated_at=? WHERE id=? AND status IN ('ready','approved','draft')", (now(), draft_id))
        if r.rowcount == 0:
            raise HTTPException(404, "Draft not found or not rejectable")
    audit("draft_rejected", {"id": draft_id})
    return {"ok": True}


# ============================================================================ sending
def in_send_window(when: Optional[dt.datetime] = None) -> bool:
    w = setting("send_window", "07:00-09:30")
    try:
        a, b = w.split("-")
        t = (when or local_now()).time()
        ta = dt.time(*map(int, a.split(":")))
        tb = dt.time(*map(int, b.split(":")))
        return ta <= t <= tb
    except Exception:
        return False


def footer(st: dict[str, Any]) -> str:
    return f"\n\n{st['signature']}\n{st['opt_out_line']}\n{st['mailing_address']}".rstrip()


def sending_gates(draft: dict[str, Any], lead: Optional[dict[str, Any]], st: dict[str, Any], when: Optional[dt.datetime] = None) -> list[str]:
    """Every reason this email must NOT go out right now. Empty list = clear to send."""
    reasons = []
    if st["paused"]:
        reasons.append("office paused")
    if st["dry_run"]:
        reasons.append("dry run is on")
    if not st["mailing_address"]:
        reasons.append("no mailing address")
    if not lead:
        reasons.append("no lead")
    else:
        if not lead.get("contact_email"):
            reasons.append("lead has no email")
        if not lead.get("email_source"):
            reasons.append("email has no source URL")
        if lead.get("status") in ("Suppressed", "Not a fit", "Client"):
            reasons.append(f"lead is {lead.get('status')}")
        if is_suppressed(lead.get("contact_email", ""), lead.get("business_name", "")):
            reasons.append("address or business is on the suppression list")
        touches = json.loads(lead.get("touches") or "[]") if isinstance(lead.get("touches"), str) else (lead.get("touches") or [])
        if len(touches) >= st["max_touches"]:
            reasons.append("max touches reached")
    w = when or local_now()
    if w.weekday() >= 5:
        reasons.append("weekend")
    if not in_send_window(w):
        reasons.append("outside send window")
    if sent_today() >= st["daily_email_cap"]:
        reasons.append("daily cap reached")
    if draft.get("status") == "approved":
        pass
    elif st["auto_send"] and draft.get("status") == "ready" and (json.loads(draft.get("qa") or "{}") if isinstance(draft.get("qa"), str) else draft.get("qa") or {}).get("score", 0) >= 80:
        pass
    else:
        reasons.append("not approved (and autosend is off or QA under 80)")
    if not draft.get("subject") or not draft.get("body"):
        reasons.append("missing subject or body")
    if not PROVIDERS.email.configured():
        reasons.append("no email provider configured")
    return reasons


def try_send(draft_id: str, when: Optional[dt.datetime] = None) -> dict[str, Any]:
    st = all_settings()
    d = one("SELECT * FROM drafts WHERE id=?", (draft_id,))
    if not d:
        return {"sent": False, "reasons": ["draft not found"]}
    if d["status"] == "sent":
        return {"sent": True, "reasons": [], "note": "already sent"}
    lead = one("SELECT * FROM leads WHERE id=?", (d["lead_id"],)) if d["lead_id"] else None
    reasons = sending_gates(d, lead, st, when)
    if reasons:
        with db() as conn:
            conn.execute("UPDATE drafts SET error=?, updated_at=? WHERE id=?", ("blocked: " + "; ".join(reasons), now(), draft_id))
        audit("send_blocked", {"draft": draft_id, "reasons": reasons})
        return {"sent": False, "reasons": reasons}
    body = d["body"] if d["body"].rstrip().endswith(st["mailing_address"]) else d["body"].rstrip() + footer(st)
    res = PROVIDERS.email.send(to=lead["contact_email"], subject=d["subject"], body=body, from_name=st["from_name"], from_addr=st["from_email"], reply_to=st["from_email"])
    if not res.sent or not res.message_id:
        with db() as conn:
            conn.execute("UPDATE drafts SET status='failed', error=?, updated_at=? WHERE id=?", (res.note[:300], now(), draft_id))
        audit("send_failed", {"draft": draft_id, "note": res.note})
        return {"sent": False, "reasons": [res.note]}
    ts = now()
    touches = json.loads(lead["touches"] or "[]")
    touches.append({"n": len(touches) + 1, "t": ts, "channel": "email", "draft_id": draft_id, "message_id": res.message_id})
    next_touch = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=st["follow_up_days"])).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db() as conn:
        conn.execute("UPDATE drafts SET status='sent', evidence=?, error='', updated_at=? WHERE id=?",
                     (json.dumps({"message_id": res.message_id, "sent_at": ts, "provider": PROVIDERS.email.name}), ts, draft_id))
        conn.execute("UPDATE leads SET status=CASE WHEN status='Qualified' THEN 'Contacted' ELSE status END, touches=?, next_touch_at=?, updated_at=? WHERE id=?",
                     (json.dumps(touches), next_touch, ts, lead["id"]))
        conn.execute("INSERT INTO sends(id,day,draft_id,lead_id,to_email,message_id,created_at) VALUES(?,?,?,?,?,?,?)",
                     (str(uuid.uuid4()), day_key(when), draft_id, lead["id"], lead["contact_email"], res.message_id, ts))
    if not st["sending_since"]:
        set_setting("sending_since", day_key(when))
    audit("email_sent", {"draft": draft_id, "lead": lead["id"], "message_id": res.message_id})
    return {"sent": True, "reasons": [], "message_id": res.message_id}


@app.post("/api/drafts/{draft_id}/send-now", dependencies=[Depends(require_auth)])
def send_now(draft_id: str) -> dict[str, Any]:
    """Runs the gates right now and sends only if every one passes. Returns the blocking reasons otherwise."""
    return try_send(draft_id)


# ======================================================================= suppression
def add_suppression(value: str, reason: str, by_who: str) -> str:
    value = (value or "").strip()
    if not value:
        return ""
    sid = slug(value)
    is_email = "@" in value
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO suppression(id,email,domain,business_name,reason,by_who,created_at) VALUES(?,?,?,?,?,?,?)",
                     (sid, value.lower() if is_email else "", "", "" if is_email else value, reason, by_who, now()))
        if is_email:
            conn.execute("UPDATE leads SET status='Suppressed', updated_at=? WHERE lower(contact_email)=?", (now(), value.lower()))
    audit("suppressed", {"id": sid, "reason": reason})
    return sid


@app.get("/api/suppression")
def get_suppression() -> list[dict[str, Any]]:
    return rows("SELECT * FROM suppression ORDER BY created_at DESC LIMIT 1000")


@app.post("/api/suppression", dependencies=[Depends(require_auth)])
def post_suppression(data: SuppressionInput) -> dict[str, Any]:
    return {"ok": True, "id": add_suppression(data.value, data.reason, "grayson")}


@app.delete("/api/suppression/{sid}", dependencies=[Depends(require_auth)])
def delete_suppression(sid: str) -> dict[str, Any]:
    with db() as conn:
        conn.execute("DELETE FROM suppression WHERE id=?", (sid,))
    audit("unsuppressed", {"id": sid})
    return {"ok": True}


@app.post("/api/replies/opt-out", dependencies=[Depends(require_auth)])
def record_opt_out(email: str, text: str = "") -> dict[str, Any]:
    """Record a reply that says stop/no/unsubscribe. Honored immediately, forever."""
    sid = add_suppression(email, f"opted out: {text[:80]}" if text else "opted out", "reply")
    return {"ok": True, "id": sid}


# =========================================================================== lessons
@app.get("/api/lessons")
def get_lessons() -> list[dict[str, Any]]:
    return rows("SELECT * FROM lessons ORDER BY created_at DESC LIMIT 500")


@app.post("/api/lessons", dependencies=[Depends(require_auth)])
def create_lesson(data: LessonInput) -> dict[str, Any]:
    lesson_id = str(uuid.uuid4())
    with db() as conn:
        conn.execute("INSERT INTO lessons(id,title,observation,evidence,confidence,agent,workflow_version,created_at) VALUES(?,?,?,?,?,?,?,?)",
                     (lesson_id, data.title, data.observation, data.evidence, data.confidence, data.agent or "human", setting("workflow_version", "v1"), now()))
    audit("lesson_saved", {"id": lesson_id, "confidence": data.confidence})
    return {"ok": True, "id": lesson_id}


@app.get("/api/workflow")
def get_workflow() -> list[dict[str, Any]]:
    return [hydrate("workflow", r) for r in rows("SELECT * FROM workflow ORDER BY proposed_at DESC LIMIT 100")]


@app.post("/api/workflow", dependencies=[Depends(require_auth)])
def propose_workflow(data: WorkflowInput) -> dict[str, Any]:
    current = setting("workflow_version", "v1")
    n = count("workflow") + 2
    version = f"v{n}-{slug(data.stage)[:12]}"
    with db() as conn:
        conn.execute("INSERT INTO workflow(version,stage,change,prediction,template,previous_version,eval_sends,proposed_at) VALUES(?,?,?,?,?,?,?,?)",
                     (version, data.stage, data.change, data.prediction, data.template, current, data.eval_sends, now()))
    set_setting("workflow_version", version)
    audit("workflow_proposed", {"version": version, "previous": current})
    return {"ok": True, "version": version, "note": f"Testing. Drafts from now on carry {version}; evaluate after {data.eval_sends} sends."}


def reply_rate(version: str) -> dict[str, Any]:
    sent = rows("SELECT d.lead_id FROM drafts d WHERE d.status='sent' AND d.workflow_version=?", (version,))
    n = len(sent)
    if n == 0:
        return {"sends": 0, "replies": 0, "rate": None}
    ids = tuple({r["lead_id"] for r in sent if r["lead_id"]})
    if not ids:
        return {"sends": n, "replies": 0, "rate": 0.0}
    q = f"SELECT COUNT(*) AS c FROM leads WHERE id IN ({','.join('?' * len(ids))}) AND status IN ('Replied','Meeting','Client')"
    replies = (one(q, ids) or {}).get("c", 0)
    return {"sends": n, "replies": replies, "rate": round(replies / n * 100, 1)}


@app.post("/api/workflow/{version}/evaluate", dependencies=[Depends(require_auth)])
def evaluate_workflow(version: str) -> dict[str, Any]:
    w = one("SELECT * FROM workflow WHERE version=?", (version,))
    if not w:
        raise HTTPException(404, "Version not found")
    cur = reply_rate(version)
    base = reply_rate(w["previous_version"]) if w["previous_version"] else {"sends": 0, "replies": 0, "rate": None}
    verdict = "testing"
    if cur["sends"] >= w["eval_sends"]:
        if cur["rate"] is not None and (base["rate"] is None or cur["rate"] >= base["rate"] + 2):
            verdict = "adopted"
        else:
            verdict = "rolled back"
            set_setting("workflow_version", w["previous_version"] or "v1")
    result = {"current": cur, "baseline": base, "evaluated_at": now()}
    with db() as conn:
        conn.execute("UPDATE workflow SET result=?, verdict=?, decided_at=? WHERE version=?",
                     (json.dumps(result), verdict, now() if verdict != "testing" else "", version))
    audit("workflow_evaluated", {"version": version, "verdict": verdict})
    return {"ok": True, "verdict": verdict, "result": result, "note": "Needs more sends." if verdict == "testing" else ""}


@app.post("/api/workflow/{version}/rollback", dependencies=[Depends(require_auth)])
def rollback_workflow(version: str) -> dict[str, Any]:
    w = one("SELECT * FROM workflow WHERE version=?", (version,))
    if not w:
        raise HTTPException(404, "Version not found")
    set_setting("workflow_version", w["previous_version"] or "v1")
    with db() as conn:
        conn.execute("UPDATE workflow SET verdict='rolled back', decided_at=? WHERE version=?", (now(), version))
    audit("workflow_rolled_back", {"version": version})
    return {"ok": True, "active": setting("workflow_version")}


# ========================================================================== settings
@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return all_settings()


@app.post("/api/settings", dependencies=[Depends(require_auth)])
def update_setting(data: SettingInput) -> dict[str, Any]:
    if data.key not in EDITABLE_SETTINGS:
        raise HTTPException(400, "Setting is not editable through this endpoint")
    if data.key in {"paused", "dry_run", "auto_send"} and data.value not in {"true", "false"}:
        raise HTTPException(400, "Expected true or false")
    if data.key == "dry_run" and data.value == "false" and not PROVIDERS.email.configured():
        raise HTTPException(403, "Live mode needs an email provider. Set SMTP_HOST, SMTP_USER and SMTP_PASSWORD first.")
    if data.key == "auto_send" and data.value == "true" and (flag("dry_run") or not setting("mailing_address")):
        raise HTTPException(403, "Autosend needs dry run off and a mailing address set.")
    if data.key == "daily_email_cap":
        v = int(data.value)
        if v < 1 or v > 20:
            raise HTTPException(400, "The cap stays between 1 and 20.")
    if data.key == "targets":
        try:
            parsed = json.loads(data.value)
            assert isinstance(parsed, list)
        except Exception:
            raise HTTPException(400, "targets must be a JSON list")
    set_setting(data.key, data.value)
    audit("setting_updated", {"key": data.key, "value": data.value[:200]})
    return {"ok": True}


@app.post("/api/pause", dependencies=[Depends(require_auth)])
def pause_all() -> dict[str, Any]:
    set_setting("paused", "true")
    audit("office_paused", {})
    return {"ok": True, "paused": True}


@app.post("/api/resume", dependencies=[Depends(require_auth)])
def resume() -> dict[str, Any]:
    set_setting("paused", "false")
    audit("office_resumed", {})
    return {"ok": True, "paused": False}


@app.get("/api/approvals")
def get_approvals() -> list[dict[str, Any]]:
    return rows("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 200")


@app.post("/api/approvals/{aid}/{decision}", dependencies=[Depends(require_auth)])
def decide_approval(aid: str, decision: str) -> dict[str, Any]:
    if decision not in ("approved", "rejected"):
        raise HTTPException(400, "decision must be approved or rejected")
    with db() as conn:
        r = conn.execute("UPDATE approvals SET status=?, decided_at=? WHERE id=? AND status='pending'", (decision, now(), aid))
        if r.rowcount == 0:
            raise HTTPException(404, "Pending approval not found")
    return {"ok": True}


@app.get("/api/audit")
def get_audit() -> list[dict[str, Any]]:
    return rows("SELECT * FROM audit ORDER BY created_at DESC LIMIT 300")


@app.get("/api/usage")
def get_usage() -> dict[str, Any]:
    u = one("SELECT COALESCE(SUM(input_tokens),0) AS i, COALESCE(SUM(output_tokens),0) AS o, COUNT(*) AS n FROM usage") or {}
    cin = float(os.getenv("RIDGELINE_COST_PER_MTOK_IN", "0") or 0)
    cout = float(os.getenv("RIDGELINE_COST_PER_MTOK_OUT", "0") or 0)
    est = (u.get("i", 0) / 1e6) * cin + (u.get("o", 0) / 1e6) * cout
    return {"calls": u.get("n", 0), "input_tokens": u.get("i", 0), "output_tokens": u.get("o", 0),
            "estimated_cost_usd": round(est, 4) if (cin or cout) else None,
            "note": "Set RIDGELINE_COST_PER_MTOK_IN/OUT from the provider's current price list to estimate dollars; otherwise cost is unknown."}


@app.get("/api/runs")
def get_runs() -> list[dict[str, Any]]:
    return [hydrate("runs", r) for r in rows("SELECT * FROM runs ORDER BY started_at DESC LIMIT 60")]


@app.get("/api/clients")
def get_clients() -> list[dict[str, Any]]:
    return rows("SELECT * FROM clients ORDER BY created_at DESC LIMIT 500")


@app.post("/api/backup", dependencies=[Depends(require_auth)])
def backup_now() -> dict[str, Any]:
    return make_backup()


def make_backup() -> dict[str, Any]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    dest = BACKUP_DIR / f"ridgeline-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(DB_PATH)
    try:
        dst = sqlite3.connect(str(dest))
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    files = sorted(BACKUP_DIR.glob("ridgeline-*.db"))
    for old in files[:-14]:
        old.unlink(missing_ok=True)
    audit("backup_created", {"file": dest.name})
    return {"ok": True, "file": dest.name, "kept": min(len(files), 14)}


@app.post("/api/run-day-shift", dependencies=[Depends(require_auth)])
def run_day_shift_now() -> dict[str, Any]:
    if flag("paused"):
        raise HTTPException(423, "Office is paused")
    return {"ok": True, "run_id": start_day_shift("manual")}


# ===================================================================== agent engine
def record_usage(res: prov.AIResult, task_id: str) -> None:
    with db() as conn:
        conn.execute("INSERT INTO usage(id,provider,model,input_tokens,output_tokens,task_id,created_at) VALUES(?,?,?,?,?,?,?)",
                     (str(uuid.uuid4()), PROVIDERS.ai.name, res.model, res.input_tokens, res.output_tokens, task_id, now()))


def ai_json(system: str, prompt: str, task_id: str, max_tokens: int = 1200) -> dict[str, Any]:
    res = PROVIDERS.ai.complete(system, prompt + "\n\nAnswer with one JSON object and nothing else.", max_tokens=max_tokens)
    record_usage(res, task_id)
    text = res.text.strip()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        raise prov.ProviderError("AI answer was not JSON")
    return json.loads(m.group(0))


SYSTEM_RULES = ("You are part of the Ridgeline Office, an AI crew for Ridgeline Local, a one-person service that helps independent "
                "roofers and tree services get recommended by ChatGPT, Gemini and Google. Rules that never bend: real facts only, never "
                "invent a business, contact, number or result; never promise rankings; no AI-sounding hype words (elevate, unlock, seamless, "
                "game-changer, dive into, leverage, synergy); plain, specific, confident writing that sounds like one person to one person.")


def score_lead(lead: dict[str, Any], gate: int) -> tuple[int, list[str]]:
    """Deterministic rubric (mirrors office/stages/day-shift/references/scoring.md). Unknown = 0."""
    p = lead.get("profile") or {}
    if isinstance(p, str):
        p = json.loads(p or "{}")
    sc = lead.get("search_check") or {}
    if isinstance(sc, str):
        sc = json.loads(sc or "{}")
    why: list[str] = []
    s = 0
    reviews = p.get("reviews")
    if isinstance(reviews, (int, float)):
        if reviews < 30:
            s += 20; why.append(f"+20 under 30 reviews ({int(reviews)})")
        elif reviews <= 80:
            s += 10; why.append(f"+10 30 to 80 reviews ({int(reviews)})")
        elif reviews > 150 and (p.get("rating") or 0) >= 4.7:
            why.append("+0 already strong (150+ reviews, 4.7+)")
    if (isinstance(p.get("photos"), (int, float)) and p["photos"] < 10) or p.get("servicesListed") is False or p.get("hoursListed") is False:
        s += 10; why.append("+10 thin profile (photos, services or hours)")
    if sc.get("namedYou") is False:
        s += 15; why.append("+15 not named in the search check")
    if p.get("yelpClaimed") is False:
        s += 5; why.append("+5 Yelp unclaimed")
    if lead.get("website") and lead.get("contact_email"):
        s += 15; why.append("+15 website with a published email")
    elif lead.get("website"):
        s += 5; why.append("+5 website, no published email (form only)")
    else:
        s += 10; why.append("+10 no website found")
    if lead.get("phone"):
        s += 5; why.append("+5 published phone")
    if lead.get("contact_name"):
        s += 5; why.append("+5 owner first name known")
    if p.get("activeRecently"):
        s += 5; why.append("+5 active in the last 90 days")
    if p.get("chainOrFranchise"):
        s -= 30; why.append("-30 chain, franchise or agency-run")
    if p.get("hasAgency"):
        s -= 20; why.append("-20 already has marketing help")
    touches = lead.get("touches") or []
    if isinstance(touches, str):
        touches = json.loads(touches or "[]")
    if touches and lead.get("status") == "Contacted":
        s -= 40; why.append("-40 already contacted, no reply yet")
    s = max(0, min(100, s))
    why.append(f"= {s} (gate {gate})")
    return s, why


def qa_gate(subject: str, body: str, lead: dict[str, Any], kind: str, st: dict[str, Any]) -> dict[str, Any]:
    """Mirrors office/specs/email-rules.md. Returns {score, flags, levers}."""
    flags: list[str] = []
    words = len(re.findall(r"\b\w+\b", body))
    limit = {"outreach": 120, "followup": 80, "breakup": 60}.get(kind, 120)
    if words > limit:
        flags.append(f"too long ({words} words, limit {limit})")
    low = (subject + " " + body).lower()
    for w in BANNED_WORDS:
        if w in low:
            flags.append(f"banned word: {w}")
    if subject.isupper() or subject.lower().startswith(("re:", "fwd:", "fw:")):
        flags.append("subject trick")
    if re.search(r"[\U0001F300-\U0001FAFF]", body):
        flags.append("emoji")
    if len(re.findall(r"https?://", body)) > 1:
        flags.append("more than one link")
    name = (lead.get("business_name") or "").lower()
    if name and name.split()[0] not in body.lower():
        flags.append("does not name the business")
    if (lead.get("town") or "").lower() not in body.lower():
        flags.append("does not name the town")
    if re.search(r"#1|number one|guarantee(?!.*reviews)|rank you", body, re.I):
        flags.append("promise beyond the offer")
    if body.count("?") == 0:
        flags.append("no ask")
    levers = []
    if re.search(r"not you|didn.t come up|not mentioned|not on (it|the list)|names\b[^.]*\.\s*not\b|\bnot (?=[A-Z])", body, re.I | re.S) or re.search(r"\. Not [A-Z]", body):
        levers.append("their loss")
    if re.search(r"free", body, re.I):
        levers.append("give first")
    if re.search(r"\d", body):
        levers.append("specificity")
    if re.search(r"want me to|best email|should i send|send it", body, re.I):
        levers.append("tiny ask")
    if re.search(r"founding|spots", body, re.I) and st.get("founding_spots", 0) > 0:
        levers.append("real scarcity")
    score = 100 - 12 * len(flags) + 3 * len(levers)
    score = max(0, min(100, score))
    if len(levers) < 3:
        flags.append("fewer than three levers")
        score = min(score, 79)
    return {"score": score, "flags": flags, "levers": levers, "words": words, "at": now()}


def run_scout(task: dict[str, Any]) -> str:
    st = all_settings()
    targets = st["targets"]
    if not targets:
        return "No target towns set."
    t = targets[st["next_target"] % len(targets)]
    if not PROVIDERS.research.configured():
        raise prov.NotConfigured("No research provider configured (set BRAVE_API_KEY). Scout cannot search; add leads on the Lead Desk instead.")
    found = new = 0
    for trade in t.get("trades", ["roofing"]):
        query = f"{trade} {t['town']} {t['state']}"
        for cand in PROVIDERS.research.search(query, count=10)[:8]:
            found += 1
            site = prov.read_site(cand.website)
            name = (site.get("title") or cand.business_name).split("|")[0].split(" - ")[0].strip()[:120]
            if not name or any(x in cand.website for x in ("yelp.com", "facebook.com", "google.com", "angi.com", "homeadvisor", "bbb.org", "yellowpages", "thumbtack")):
                continue
            try:
                create_lead_record({"business_name": name, "trade": trade, "town": t["town"], "state": t["state"], "website": cand.website,
                                    "contact_email": site.get("email", ""), "phone": site.get("phone", ""), "source_url": cand.website,
                                    "notes": cand.snippet}, source=f"scout {day_key()}")
                new += 1
            except HTTPException:
                continue
    set_setting("next_target", (st["next_target"] + 1) % len(targets))
    return f"{t['town']}, {t['state']}: {found} results read, {new} new leads"


def run_quinn(task: dict[str, Any]) -> str:
    st = all_settings()
    leads = [hydrate("leads", r) for r in rows("SELECT * FROM leads WHERE status IN ('New','Researching') LIMIT 50")]
    n = 0
    for l in leads:
        s, why = score_lead(l, st["score_gate"])
        p = l.get("profile") or {}
        known = isinstance(p.get("reviews"), (int, float)) or (l.get("search_check") or {}).get("namedYou") is not None or p.get("chainOrFranchise") or p.get("hasAgency")
        named = (l.get("search_check") or {}).get("namedYou")
        if s >= st["score_gate"]:
            status_value = "Qualified"
        elif not isinstance(p.get("reviews"), (int, float)) and s >= 35 and (l.get("contact_email") or l.get("phone")) and named is False:
            status_value = "Qualified"
            why.append("qualified on reachable evidence; Google count unknown")
        elif known:
            status_value = "Not a fit"
        else:
            status_value = "Researching"
            why.append("needs profile facts (review count, search check) before a verdict")
        plural, singular = TRADE_WORDS.get(l.get("trade") or "roofing", ((l.get("trade") or "roofer") + "s", l.get("trade") or "roofer"))
        questions = [f"Who are the best {plural} in {l['town']}, {l['state']}?", f"I need a {singular} in {l['town']} {l['state']}, who should I call?"]
        ai = l.get("ai_check") or {}
        ai.setdefault("chatgpt", "unknown"); ai.setdefault("gemini", "unknown"); ai["questions"] = questions
        with db() as conn:
            conn.execute("UPDATE leads SET score=?, score_why=?, status=?, ai_check=?, updated_at=? WHERE id=?",
                         (s, json.dumps(why), status_value, json.dumps(ai), now(), l["id"]))
        n += 1
    return f"scored {n} leads"


def run_parker(task: dict[str, Any]) -> str:
    st = all_settings()
    leads = [hydrate("leads", r) for r in rows("SELECT * FROM leads WHERE status='Qualified' AND contact_email != '' AND angle='{}' ORDER BY score DESC LIMIT ?", (st["daily_email_cap"] * 2,))]
    if not leads:
        return "no qualified leads need an angle"
    if not PROVIDERS.ai.configured():
        raise prov.NotConfigured("No AI provider configured; Parker cannot write angles.")
    n = 0
    for i, l in enumerate(leads):
        sc = l.get("search_check") or {}
        prompt = (f"Lead: {json.dumps({k: l.get(k) for k in ('business_name','trade','town','state','website','contact_name','profile','search_check','score_why')})}\n"
                  f"Pick ONE primary lever from: their loss, specificity, give first, tiny ask, proof, real scarcity. Write the exact hook sentence "
                  f"(specific to this business: its name, town, a number or the competitors named in search_check). Subject pattern: {'A' if i % 2 == 0 else 'B'}.\n"
                  f"JSON keys: lever, hook, detail, subjectPattern.")
        data = ai_json(SYSTEM_RULES, prompt, task["id"], max_tokens=400)
        angle = {"lever": str(data.get("lever", ""))[:40], "hook": str(data.get("hook", ""))[:300], "detail": str(data.get("detail", ""))[:300],
                 "subjectPattern": str(data.get("subjectPattern", "A"))[:2], "by": "parker", "at": now()}
        if not angle["hook"]:
            continue
        with db() as conn:
            conn.execute("UPDATE leads SET angle=?, updated_at=? WHERE id=?", (json.dumps(angle), now(), l["id"]))
        n += 1
    return f"{n} angles set"


def run_echo(task: dict[str, Any]) -> str:
    st = all_settings()
    payload = task.get("payload") or {}
    if task.get("kind") == "send" and payload.get("draft_id"):
        r = try_send(payload["draft_id"])
        return "sent " + r.get("message_id", "") if r.get("sent") else "blocked: " + "; ".join(r.get("reasons", []))
    leads = [hydrate("leads", r) for r in rows("SELECT * FROM leads WHERE status='Qualified' AND contact_email != '' AND angle != '{}' ORDER BY score DESC LIMIT ?", (st["daily_email_cap"],))]
    written = 0
    for l in leads:
        if one("SELECT 1 FROM drafts WHERE lead_id=? AND status IN ('ready','approved','sent')", (l["id"],)):
            continue
        if is_suppressed(l["contact_email"], l["business_name"]):
            continue
        if not PROVIDERS.ai.configured():
            raise prov.NotConfigured("No AI provider configured; Echo cannot write emails.")
        prompt = (f"Write a first cold email (under 120 words before the footer) from Grayson at Ridgeline Local to this business. Facts only from the lead. "
                  f"Open with their loss (the competitors named in search_check, 'not you'), one verified detail, then the free AI check (screenshots of what ChatGPT and "
                  f"Gemini say plus the three fixes), then ONE ask as a one-tap reply. Plain text, no emoji, at most one link ({st['site_url']}). "
                  f"Angle: {json.dumps(l.get('angle'))}. Lead: {json.dumps({k: l.get(k) for k in ('business_name','trade','town','state','contact_name','profile','search_check')})}\n"
                  f"JSON keys: subject, body (no signature or footer; those are added).")
        data = ai_json(SYSTEM_RULES, prompt, task["id"], max_tokens=700)
        subject, body = str(data.get("subject", ""))[:150], str(data.get("body", ""))[:3000]
        qa = qa_gate(subject, body, l, "outreach", st)
        if qa["score"] < 80:
            data = ai_json(SYSTEM_RULES, prompt + f"\nThe previous attempt failed QA: {qa['flags']}. Fix every flag.", task["id"], max_tokens=700)
            subject, body = str(data.get("subject", ""))[:150], str(data.get("body", ""))[:3000]
            qa = qa_gate(subject, body, l, "outreach", st)
        full = body.rstrip() + footer(st)
        status_value = "draft" if (st["dry_run"] or qa["score"] < 80) else "ready"
        did = insert_draft("outreach", f"{l['business_name']} · touch 1", subject, full, l["id"], 1, status_value, qa, "echo")
        written += 1
        if status_value == "ready" and st["auto_send"]:
            try_send(did)
    return f"{written} drafts written"


def run_nova(task: dict[str, Any]) -> str:
    if not PROVIDERS.ai.configured():
        raise prov.NotConfigured("No AI provider configured; Nova cannot write briefs.")
    st = all_settings()
    lead = one("SELECT business_name, town, state, trade, search_check FROM leads WHERE status='Qualified' ORDER BY updated_at DESC LIMIT 1") or {}
    prompt = (f"Write one 20-40 second face-to-camera video brief for Instagram Reels and Facebook, vertical, captions on. Format: hook (the loss, first 2 seconds), "
              f"demo (an AI answer card with the competitor names from this real search check, labeled Example), the proof number (45% of consumers used AI to find a local "
              f"business in the past year, BrightLocal 2026), what Ridgeline does, risk gone + CTA 'Free AI check, link in bio'. Lead for the demo: {json.dumps(lead)}. "
              f"JSON keys: title, hook, lines (array of {{second, say, popup}}), caption (under 150 chars), hashtags (5-8), capcut (3 steps), postPlan {{platform, day, time}}.")
    data = ai_json(SYSTEM_RULES, prompt, task["id"], max_tokens=1200)
    did = insert_draft("script", str(data.get("title", "Video brief"))[:150], "", json.dumps(data, indent=1), status_value="brief", created_by="nova")
    return f"brief {did[:8]} ready"


def run_sage(task: dict[str, Any]) -> str:
    """Learns only from verified outcomes already recorded (statuses, sends, calls). Replies arrive via the dashboard or the opt-out endpoint."""
    st = all_settings()
    version = st["workflow_version"]
    rr = reply_rate(version)
    notes = [f"version {version}: {rr['sends']} sends, {rr['replies']} replies, rate {rr['rate']}"]
    if rr["sends"] < 20:
        notes.append("too early for lessons (under 20 sends)")
    else:
        lesson_id = str(uuid.uuid4())
        with db() as conn:
            conn.execute("INSERT INTO lessons(id,title,observation,evidence,confidence,agent,observed,workflow_version,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                         (lesson_id, f"Reply rate on {version}", f"{rr['replies']} replies from {rr['sends']} sends.", f"{rr['rate']}% reply rate",
                          70 if rr["sends"] >= 30 else 55, "sage", f"{rr['rate']}%", version, now()))
        notes.append("lesson recorded")
    for w in rows("SELECT version, eval_sends FROM workflow WHERE verdict='testing'"):
        if reply_rate(w["version"])["sends"] >= w["eval_sends"]:
            with contextlib.suppress(Exception):
                verdict = evaluate_workflow(w["version"])["verdict"]
                notes.append(f"{w['version']}: {verdict}")
    return "; ".join(notes)


def run_patch(task: dict[str, Any]) -> str:
    fixed = []
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db() as conn:
        r = conn.execute("UPDATE tasks SET status='failed', error='timed out', updated_at=? WHERE status='running' AND started_at < ? AND id != ?", (now(), cutoff, task["id"]))
        if r.rowcount:
            fixed.append(f"{r.rowcount} stuck task(s) marked failed")
        r = conn.execute("UPDATE tasks SET status='queued', error='', lease_until='', updated_at=? WHERE status='failed' AND attempts < max_attempts AND kind != 'manual'", (now(),))
        if r.rowcount:
            fixed.append(f"{r.rowcount} failed task(s) queued once more")
        r = conn.execute("UPDATE crew SET state='idle', last_error='reset by Patch' WHERE state='working' AND last_activity < ?", (cutoff,))
        if r.rowcount:
            fixed.append(f"{r.rowcount} stale crew state(s) reset")
    site = prov.read_site(setting("site_url"))
    site_ok = site.get("ok") and site.get("status") == 200
    b = make_backup()
    return f"site {'up' if site_ok else 'problem (' + str(site.get('status')) + ')'}; backup {b['file']}; " + ("; ".join(fixed) if fixed else "nothing to fix")


def run_mara(task: dict[str, Any]) -> str:
    payload = task.get("payload") or {}
    run_id = payload.get("run_id") or task.get("run_id") or ""
    c = lead_counts()
    counts = {"leads": sum(c.values()), "qualified": c["Qualified"], "ready": count("drafts", "status='ready'"), "sent_today": sent_today(), "failed_tasks": count("tasks", "status='failed'")}
    summary = f"{counts['leads']} leads, {counts['qualified']} qualified, {counts['ready']} ready for OK, {counts['sent_today']} sent today"
    if run_id:
        with db() as conn:
            conn.execute("UPDATE runs SET status='done', counts=?, summary=?, needs_you=?, finished_at=? WHERE id=?",
                         (json.dumps(counts), summary, json.dumps([n["t"] for n in needs_you()]), now(), run_id))
    return summary


TRADE_WORDS = {"roofing": ("roofers", "roofer"), "tree service": ("tree services", "tree service"), "other": ("local businesses", "local business")}


EXECUTORS = {"scout": run_scout, "quinn": run_quinn, "parker": run_parker, "echo": run_echo, "nova": run_nova, "sage": run_sage, "patch": run_patch, "mara": run_mara}


def execute(task: dict[str, Any]) -> str:
    fn = EXECUTORS.get(task["agent_id"])
    if not fn:
        raise RuntimeError(f"No executor for agent {task['agent_id']}")
    return fn(task)


# ============================================================================ worker
def claim_task() -> Optional[dict[str, Any]]:
    """Atomic claim: one worker gets the task, attempts +1, a 15-minute lease."""
    lease = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=15)).strftime("%Y-%m-%dT%H:%M:%SZ")
    with db() as conn:
        row = conn.execute("SELECT id FROM tasks WHERE status='queued' AND agent_id != 'grayson' ORDER BY created_at LIMIT 1").fetchone()
        if not row:
            return None
        r = conn.execute("UPDATE tasks SET status='running', attempts=attempts+1, lease_until=?, started_at=?, updated_at=? WHERE id=? AND status='queued'",
                         (lease, now(), now(), row["id"]))
        if r.rowcount == 0:
            return None
        t = conn.execute("SELECT * FROM tasks WHERE id=?", (row["id"],)).fetchone()
        return hydrate("tasks", dict(t))


def finish_task(task_id: str, ok: bool, text: str) -> None:
    with db() as conn:
        t = conn.execute("SELECT attempts, max_attempts, agent_id FROM tasks WHERE id=?", (task_id,)).fetchone()
        if ok:
            conn.execute("UPDATE tasks SET status='done', result=?, error='', finished_at=?, updated_at=? WHERE id=?", (text[:5000], now(), now(), task_id))
            conn.execute("UPDATE crew SET runs=runs+1, done=done+1 WHERE id=?", (t["agent_id"],))
        else:
            retry = t and t["attempts"] < t["max_attempts"]
            conn.execute("UPDATE tasks SET status=?, error=?, finished_at=?, updated_at=? WHERE id=?",
                         ("queued" if retry else "failed", text[:2000], "" if retry else now(), now(), task_id))
            conn.execute("UPDATE crew SET runs=runs+1, failed=failed+1 WHERE id=?", (t["agent_id"],))


def work_once() -> bool:
    """Claim and run one task. Returns True if a task was processed."""
    if flag("paused"):
        return False
    task = claim_task()
    if not task:
        return False
    _worker_state["last_task"] = task["id"]
    crew_set(task["agent_id"], "working", task["title"])
    try:
        result = execute(task)
        finish_task(task["id"], True, result)
        crew_set(task["agent_id"], "idle", "Available", result=result)
        audit("task_done", {"id": task["id"], "agent": task["agent_id"], "result": result[:200]})
    except prov.NotConfigured as e:
        finish_task(task["id"], False, f"not configured: {e}")
        with db() as conn:  # a missing provider is not worth retrying
            conn.execute("UPDATE tasks SET status='failed', finished_at=? WHERE id=?", (now(), task["id"]))
        crew_set(task["agent_id"], "error", "Needs setup", error=str(e))
        audit("task_not_configured", {"id": task["id"], "error": str(e)[:200]})
    except Exception as e:  # noqa: BLE001
        finish_task(task["id"], False, f"{e.__class__.__name__}: {e}")
        crew_set(task["agent_id"], "error", "Failed", error=f"{e.__class__.__name__}: {str(e)[:200]}")
        audit("task_failed", {"id": task["id"], "error": f"{e.__class__.__name__}: {str(e)[:200]}"})
    return True


def recover_stale() -> None:
    """On start: running tasks with an expired lease go back to queued (or failed when out of attempts)."""
    with db() as conn:
        conn.execute("UPDATE tasks SET status=CASE WHEN attempts < max_attempts THEN 'queued' ELSE 'failed' END, error=CASE WHEN attempts < max_attempts THEN error ELSE 'lease expired' END, updated_at=? WHERE status='running' AND (lease_until='' OR lease_until < ?)", (now(), now()))
        conn.execute("UPDATE crew SET state='idle' WHERE state='working'")


def worker_loop(stop: threading.Event, idle_sleep: float = 3.0) -> None:
    _worker_state["alive"] = True
    try:
        while not stop.is_set():
            _worker_state["heartbeat"] = now()
            try:
                busy = work_once()
            except Exception as e:  # noqa: BLE001
                audit("worker_error", {"error": str(e)[:300]})
                busy = False
            if not busy:
                stop.wait(idle_sleep)
    finally:
        _worker_state["alive"] = False


def start_worker() -> None:
    if _worker_state["thread"] and _worker_state["thread"].is_alive():
        return
    _worker_state["stop"].clear()
    t = threading.Thread(target=worker_loop, args=(_worker_state["stop"],), name="ridgeline-worker", daemon=True)
    _worker_state["thread"] = t
    t.start()


# ========================================================================= scheduler
PIPELINE = [("scout", "Find businesses in today's town"), ("quinn", "Score new leads"), ("parker", "Pick angles"),
            ("echo", "Write and gate the emails"), ("sage", "Learn from verified outcomes"), ("patch", "Health, retries, backup"), ("mara", "Report")]


def start_day_shift(trigger: str) -> str:
    run_id = f"run-{local_now().strftime('%Y-%m-%d-%H%M')}"
    st = all_settings()
    t = st["targets"][st["next_target"] % len(st["targets"])] if st["targets"] else {}
    with db() as conn:
        conn.execute("INSERT OR IGNORE INTO runs(id,task,day,town,status,started_at) VALUES(?,?,?,?,?,?)",
                     (run_id, "day-shift", day_key(), f"{t.get('town','')}, {t.get('state','')}".strip(", "), "running", now()))
    for agent, title in PIPELINE:
        if agent == "nova" and local_now().weekday() not in (0, 3):
            continue
        enqueue(agent, title, kind="day-shift", payload={"run_id": run_id}, run_id=run_id)
    if local_now().weekday() in (0, 3):
        enqueue("nova", "Write this week's video brief", kind="day-shift", payload={"run_id": run_id}, run_id=run_id)
    audit("day_shift_started", {"run_id": run_id, "trigger": trigger})
    return run_id


def scheduler_loop(stop: threading.Event) -> None:
    _scheduler_state["alive"] = True
    try:
        while not stop.is_set():
            _scheduler_state["last_tick"] = now()
            try:
                hhmm = setting("day_shift_time", "06:41")
                ln = local_now()
                key = f"{day_key(ln)} {hhmm}"
                if ln.strftime("%H:%M") == hhmm and ln.weekday() < 5 and _scheduler_state["last_fired"] != key and not flag("paused"):
                    start_day_shift("schedule")
                    _scheduler_state["last_fired"] = key
            except Exception as e:  # noqa: BLE001
                audit("scheduler_error", {"error": str(e)[:300]})
            stop.wait(30)
    finally:
        _scheduler_state["alive"] = False


def start_scheduler() -> None:
    if _scheduler_state["thread"] and _scheduler_state["thread"].is_alive():
        return
    t = threading.Thread(target=scheduler_loop, args=(_worker_state["stop"],), name="ridgeline-scheduler", daemon=True)
    _scheduler_state["thread"] = t
    t.start()


@app.exception_handler(prov.ProviderError)
def provider_error_handler(request: Request, exc: prov.ProviderError) -> JSONResponse:
    return JSONResponse(status_code=502, content={"detail": str(exc)})
