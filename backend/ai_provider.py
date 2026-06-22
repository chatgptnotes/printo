"""
AI provider abstraction.

Printo never calls a foundation-model API directly. Inference is routed through a
pluggable **AI sidecar** (the Pratyaya / Ampris AI-aaS pattern). Providers:

  • MockProvider   — built-in demo data (no network); always available.
  • SidecarProvider — HTTP to a local sidecar; supports vision (image) or text mode.

Selection (env AI_PROVIDER):
  auto    → use the sidecar if its /health responds, else MockProvider
  sidecar → always SidecarProvider
  mock    → always MockProvider

Sidecar contract (see tools/mock_sidecar.py):
  GET  /health      → {"status":"ok","vision":bool,"model":str}
  POST /v1/extract  → {"data": {<fields>, "confidence": {...}}}
      body: {"prompt":str,"schema":{...},"image"?:{"media_type","data"(b64)},"text"?:str}
      auth: Authorization: Bearer <SIDECAR_API_KEY>
"""

import base64
import os
from dataclasses import dataclass

import requests


class SidecarError(RuntimeError):
    """Raised when the sidecar is selected but the call fails."""


@dataclass
class ExtractRequest:
    prompt: str
    schema: dict
    image: bytes | None = None
    media_type: str = "image/png"
    text: str | None = None
    # context the MockProvider needs
    file_path: str | None = None
    floor_category: str | None = None
    original_name: str | None = None


# ── config helpers (read at call time so .env / tests are respected) ───────────
def _cfg(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


def _sidecar_url() -> str:
    return _cfg("SIDECAR_URL", "http://localhost:8787").rstrip("/")


def _timeout() -> float:
    try:
        return float(_cfg("SIDECAR_TIMEOUT", "45"))
    except ValueError:
        return 45.0


def _auth_headers() -> dict:
    key = _cfg("SIDECAR_API_KEY")
    return {"Authorization": f"Bearer {key}"} if key else {}


def sidecar_health(timeout: float = 3.0) -> dict | None:
    """Return the sidecar /health dict, or None if unreachable."""
    try:
        r = requests.get(f"{_sidecar_url()}/health", headers=_auth_headers(), timeout=timeout)
        if r.status_code == 200:
            return r.json()
    except Exception:
        return None
    return None


# ── providers ─────────────────────────────────────────────────────────────────
class MockProvider:
    name = "mock"
    mode = "mock"

    def extract(self, req: ExtractRequest) -> dict:
        # Lazy import avoids a circular dependency with extractor.py.
        from extractor import _mock_extract
        return _mock_extract(req.file_path or "", req.floor_category, req.original_name)


class SidecarProvider:
    name = "sidecar"

    def __init__(self, mode: str = "auto", health: dict | None = None):
        self._configured_mode = mode
        self._health = health

    @property
    def mode(self) -> str:
        """Resolved I/O mode: vision or text."""
        if self._configured_mode in ("vision", "text"):
            return self._configured_mode
        # auto: vision iff the sidecar advertises it
        if self._health and self._health.get("vision"):
            return "vision"
        return "text"

    def extract(self, req: ExtractRequest) -> dict:
        body: dict = {"prompt": req.prompt, "schema": req.schema}
        if self.mode == "vision" and req.image:
            body["image"] = {
                "media_type": req.media_type,
                "data": base64.standard_b64encode(req.image).decode("utf-8"),
            }
        else:
            # text mode (or vision requested but no image available)
            body["text"] = req.text or ""

        try:
            r = requests.post(
                f"{_sidecar_url()}/v1/extract",
                json=body, headers={**_auth_headers(), "Content-Type": "application/json"},
                timeout=_timeout(),
            )
        except Exception as e:
            raise SidecarError(f"sidecar unreachable: {e}") from e

        if r.status_code != 200:
            raise SidecarError(f"sidecar HTTP {r.status_code}: {r.text[:200]}")
        try:
            payload = r.json()
        except ValueError as e:
            raise SidecarError(f"sidecar returned non-JSON: {e}") from e

        # Accept {"data": {...}} or a bare field dict.
        return payload.get("data", payload) if isinstance(payload, dict) else {}


# ── factory + status ───────────────────────────────────────────────────────────
def resolve_provider():
    """Pick a provider per env. Returns (provider, status_dict)."""
    choice = (_cfg("AI_PROVIDER", "auto") or "auto").lower()
    mode_cfg = _cfg("SIDECAR_MODE", "auto").lower() or "auto"

    if choice == "mock":
        return MockProvider(), {"ai_provider": "mock", "sidecar_reachable": False,
                                "mode": "mock", "model": "builtin-demo"}

    health = sidecar_health()
    if choice == "sidecar":
        prov = SidecarProvider(mode=mode_cfg, health=health)
        return prov, {"ai_provider": "sidecar", "sidecar_reachable": health is not None,
                      "mode": prov.mode, "model": (health or {}).get("model", "unknown")}

    # auto
    if health is not None:
        prov = SidecarProvider(mode=mode_cfg, health=health)
        return prov, {"ai_provider": "sidecar", "sidecar_reachable": True,
                      "mode": prov.mode, "model": health.get("model", "unknown")}
    return MockProvider(), {"ai_provider": "mock", "sidecar_reachable": False,
                            "mode": "mock", "model": "builtin-demo",
                            "note": "sidecar not reachable — using mock"}


def provider_status() -> dict:
    """Lightweight status for the /health endpoint (no extraction)."""
    _, status = resolve_provider()
    return status
