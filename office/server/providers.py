"""Provider adapters for the Ridgeline AI Office server edition.

Every adapter reports honestly whether it is configured. Nothing here pretends:
- AI:       Anthropic Messages API when ANTHROPIC_API_KEY is set, else NotConfigured.
- Research: Brave Search API when BRAVE_API_KEY is set, else NotConfigured. Business websites
            are read directly (one page, short timeout) to pull a published email or phone.
- Email:    DraftOnly by default. SMTP (for example Gmail with an App Password) only when
            SMTP_HOST, SMTP_USER and SMTP_PASSWORD are all set AND the caller passes the live
            gate; the adapter itself never decides to send.

Secrets come from environment variables only and are never returned by any function.
"""
from __future__ import annotations

import json
import os
import re
import smtplib
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Any, Optional


class NotConfigured(RuntimeError):
    """Raised when a provider is asked to work without its credentials."""


class ProviderError(RuntimeError):
    """A real call failed (network, 4xx/5xx, bad response)."""


USER_AGENT = "RidgelineOffice/2.0 (+https://ridgelinehq.github.io)"


# ----------------------------------------------------------------------------- AI
@dataclass
class AIResult:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""


class AIProvider:
    name = "none"

    def configured(self) -> bool:
        return False

    def complete(self, system: str, prompt: str, max_tokens: int = 1200) -> AIResult:
        raise NotConfigured("No AI provider configured. Set ANTHROPIC_API_KEY to enable drafting and scoring.")


class AnthropicProvider(AIProvider):
    """Calls the Anthropic Messages API directly (no SDK dependency).
    Docs: https://docs.claude.com/en/api/messages — check them before changing the shape."""

    name = "anthropic"
    url = "https://api.anthropic.com/v1/messages"

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None, timeout: int = 60):
        self.api_key = api_key if api_key is not None else os.getenv("ANTHROPIC_API_KEY", "")
        self.model = model or os.getenv("RIDGELINE_MODEL", "claude-sonnet-5-5")
        self.timeout = timeout

    def configured(self) -> bool:
        return bool(self.api_key)

    def complete(self, system: str, prompt: str, max_tokens: int = 1200) -> AIResult:
        if not self.configured():
            raise NotConfigured("ANTHROPIC_API_KEY is not set.")
        body = json.dumps({
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(self.url, data=body, method="POST", headers={
            "content-type": "application/json",
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "user-agent": USER_AGENT,
        })
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                data = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors="replace")[:300]
            raise ProviderError(f"Anthropic API {e.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            raise ProviderError(f"Anthropic API unreachable: {e}") from None
        text = "".join(part.get("text", "") for part in data.get("content", []) if part.get("type") == "text")
        usage = data.get("usage", {}) or {}
        return AIResult(text=text, input_tokens=int(usage.get("input_tokens", 0) or 0),
                        output_tokens=int(usage.get("output_tokens", 0) or 0), model=data.get("model", self.model))


# ------------------------------------------------------------------------ Research
@dataclass
class Candidate:
    business_name: str
    website: str = ""
    snippet: str = ""
    source_url: str = ""


class ResearchProvider:
    name = "none"

    def configured(self) -> bool:
        return False

    def search(self, query: str, count: int = 10) -> list[Candidate]:
        raise NotConfigured("No research provider configured. Set BRAVE_API_KEY to let Scout search.")


class BraveSearchProvider(ResearchProvider):
    """Brave Web Search API. Free tier exists; check https://brave.com/search/api/ for limits."""

    name = "brave"
    url = "https://api.search.brave.com/res/v1/web/search"

    def __init__(self, api_key: Optional[str] = None, timeout: int = 20):
        self.api_key = api_key if api_key is not None else os.getenv("BRAVE_API_KEY", "")
        self.timeout = timeout

    def configured(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, count: int = 10) -> list[Candidate]:
        if not self.configured():
            raise NotConfigured("BRAVE_API_KEY is not set.")
        q = urllib.parse.urlencode({"q": query, "count": min(20, max(1, count))})
        req = urllib.request.Request(f"{self.url}?{q}", headers={
            "Accept": "application/json", "X-Subscription-Token": self.api_key, "user-agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                data = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise ProviderError(f"Brave Search {e.code}") from None
        except (urllib.error.URLError, TimeoutError) as e:
            raise ProviderError(f"Brave Search unreachable: {e}") from None
        out = []
        for item in (data.get("web", {}) or {}).get("results", []) or []:
            out.append(Candidate(business_name=item.get("title", "")[:200], website=item.get("url", ""),
                                 snippet=item.get("description", "")[:500], source_url=item.get("url", "")))
        return out


EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"(?:\+1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b")
SKIP_EMAIL = ("example.com", "sentry.io", "wixpress", "godaddy", "@2x", ".png", ".jpg", "noreply", "no-reply")


def read_site(url: str, timeout: int = 10, max_bytes: int = 400_000) -> dict[str, Any]:
    """Fetch one public page like a browser would and pull the published email/phone.
    Returns {"ok", "status", "email", "phone", "title", "text_len"}; never raises."""
    out: dict[str, Any] = {"ok": False, "status": 0, "email": "", "phone": "", "title": "", "text_len": 0}
    if not url:
        return out
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    req = urllib.request.Request(url, headers={"user-agent": USER_AGENT, "accept": "text/html"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            out["status"] = r.status
            raw = r.read(max_bytes).decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        out["status"] = e.code
        return out
    except Exception:
        return out
    out["ok"] = True
    m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
    out["title"] = re.sub(r"\s+", " ", m.group(1)).strip()[:200] if m else ""
    text = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw, flags=re.S | re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    out["text_len"] = len(text)
    for cand in EMAIL_RE.findall(raw):
        low = cand.lower()
        if any(s in low for s in SKIP_EMAIL):
            continue
        out["email"] = cand
        break
    m2 = PHONE_RE.search(text)
    if m2:
        out["phone"] = m2.group(0).strip()
    return out


# --------------------------------------------------------------------------- Email
@dataclass
class SendResult:
    sent: bool
    message_id: str = ""
    note: str = ""


class EmailProvider:
    name = "draft-only"

    def configured(self) -> bool:
        return False

    def send(self, to: str, subject: str, body: str, from_name: str, from_addr: str, reply_to: str = "") -> SendResult:
        return SendResult(sent=False, note="Draft-only provider: nothing was sent.")


class SMTPProvider(EmailProvider):
    """Plain SMTP with STARTTLS. Gmail: host smtp.gmail.com, port 587, user = the address,
    password = a Google App Password (2-step verification required)."""

    name = "smtp"

    def __init__(self, host: Optional[str] = None, port: Optional[int] = None, user: Optional[str] = None,
                 password: Optional[str] = None, timeout: int = 30):
        self.host = host if host is not None else os.getenv("SMTP_HOST", "")
        self.port = int(port or os.getenv("SMTP_PORT", "587") or 587)
        self.user = user if user is not None else os.getenv("SMTP_USER", "")
        self.password = password if password is not None else os.getenv("SMTP_PASSWORD", "")
        self.timeout = timeout

    def configured(self) -> bool:
        return bool(self.host and self.user and self.password)

    def send(self, to: str, subject: str, body: str, from_name: str, from_addr: str, reply_to: str = "") -> SendResult:
        if not self.configured():
            raise NotConfigured("SMTP_HOST, SMTP_USER and SMTP_PASSWORD must all be set.")
        msg = EmailMessage()
        msg["From"] = f"{from_name} <{from_addr or self.user}>"
        msg["To"] = to
        msg["Subject"] = subject
        if reply_to:
            msg["Reply-To"] = reply_to
        mid = make_msgid(domain=(from_addr or self.user).split("@")[-1])
        msg["Message-ID"] = mid
        msg.set_content(body)
        try:
            with smtplib.SMTP(self.host, self.port, timeout=self.timeout) as s:
                s.ehlo()
                s.starttls(context=ssl.create_default_context())
                s.login(self.user, self.password)
                s.send_message(msg)
        except smtplib.SMTPException as e:
            raise ProviderError(f"SMTP failed: {e.__class__.__name__}") from None
        except OSError as e:
            raise ProviderError(f"SMTP unreachable: {e}") from None
        return SendResult(sent=True, message_id=mid, note="sent via SMTP")


# ------------------------------------------------------------------------- Factory
@dataclass
class Providers:
    ai: AIProvider = field(default_factory=AIProvider)
    research: ResearchProvider = field(default_factory=ResearchProvider)
    email: EmailProvider = field(default_factory=EmailProvider)

    def status(self) -> dict[str, Any]:
        """Booleans and names only. Never a key."""
        return {
            "ai": {"name": self.ai.name, "configured": self.ai.configured()},
            "research": {"name": self.research.name, "configured": self.research.configured()},
            "email": {"name": self.email.name, "configured": self.email.configured()},
        }


def from_env() -> Providers:
    ai: AIProvider = AnthropicProvider() if os.getenv("ANTHROPIC_API_KEY") else AIProvider()
    research: ResearchProvider = BraveSearchProvider() if os.getenv("BRAVE_API_KEY") else ResearchProvider()
    email: EmailProvider = SMTPProvider() if (os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASSWORD")) else EmailProvider()
    return Providers(ai=ai, research=research, email=email)
