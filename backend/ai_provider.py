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
import json
import os
import socket
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

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
    # multi-sheet vision: every drawing sheet attached at once (Anthropic path)
    images: list[bytes] | None = None
    system: str | None = None
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


def _vision_timeout() -> float:
    """Generous timeout for a multi-sheet vision call (many images, big JSON)."""
    try:
        return float(_cfg("VISION_EXTRACT_TIMEOUT", "240"))
    except ValueError:
        return 240.0


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


class UnavailableProvider:
    name = "unavailable"
    mode = "unavailable"

    def __init__(self, reason: str):
        self.reason = reason

    def extract(self, req: ExtractRequest) -> dict:
        raise SidecarError(self.reason)


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


# ── Direct Anthropic (multi-sheet vision take-off) ────────────────────────────
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"


def _anthropic_key() -> str:
    return _cfg("ANTHROPIC_API_KEY")


def _anthropic_model() -> str:
    # Override on the VPS with ANTHROPIC_MODEL (e.g. claude-opus-4-8 for max accuracy).
    return _cfg("ANTHROPIC_MODEL", "claude-sonnet-4-6")


# Set False after an auth failure (401/403) so an invalid/placeholder key doesn't
# make every extraction waste a call and then degrade to mock — we fall straight
# back to the sidecar instead. Re-enabled on process restart (i.e. after the key
# is fixed and printo-backend is restarted).
_ANTHROPIC_AUTH_OK = True


def anthropic_ready() -> bool:
    return bool(_anthropic_key()) and _ANTHROPIC_AUTH_OK


class AnthropicProvider:
    """Calls the Anthropic Messages API directly, sending the system prompt + ALL
    sheet images in one request — the multi-sheet vision take-off path. Used when
    ANTHROPIC_API_KEY is set. Raw HTTPS (requests only); no SDK dependency."""
    name = "anthropic"
    mode = "vision"

    def extract(self, req: ExtractRequest) -> dict:
        key = _anthropic_key()
        if not key:
            raise SidecarError("ANTHROPIC_API_KEY not set")
        images = req.images if req.images else ([req.image] if req.image else [])
        content: list[dict] = [{"type": "text", "text": req.prompt}]
        for img in images:
            if not img:
                continue
            content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": req.media_type or "image/png",
                    "data": base64.standard_b64encode(img).decode("utf-8"),
                },
            })
        body: dict = {
            "model": _anthropic_model(),
            "max_tokens": int(_cfg("ANTHROPIC_MAX_TOKENS", "8000") or "8000"),
            "messages": [{"role": "user", "content": content}],
        }
        if req.system:
            body["system"] = req.system

        headers = {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
        }
        r = None
        last_error = ""
        for attempt in range(3):
            try:
                r = requests.post(ANTHROPIC_URL, json=body, headers=headers,
                                  timeout=_vision_timeout())
            except Exception as e:
                last_error = f"anthropic unreachable: {e}"
                if attempt < 2:
                    time.sleep(2 ** attempt)
                    continue
                raise SidecarError(last_error) from e
            if r.status_code in (502, 503, 504, 529) and attempt < 2:
                last_error = f"anthropic HTTP {r.status_code}: {r.text[:300]}"
                time.sleep(2 ** attempt)
                continue
            break
        if r is None:
            raise SidecarError(last_error or "anthropic request failed")
        if r.status_code in (401, 403):
            # Invalid/placeholder key — stop trying Anthropic this process (fall back
            # to the sidecar). Re-enabled after the key is fixed + a restart.
            global _ANTHROPIC_AUTH_OK
            _ANTHROPIC_AUTH_OK = False
            raise SidecarError(f"anthropic auth failed (HTTP {r.status_code}) — falling back")
        if r.status_code != 200:
            raise SidecarError(f"anthropic HTTP {r.status_code}: {r.text[:300]}")
        try:
            payload = r.json()
            parts = payload.get("content") or []
            text = "".join(p.get("text", "") for p in parts if p.get("type") == "text")
        except Exception as e:
            raise SidecarError(f"anthropic bad response: {e}") from e

        # Lazy imports avoid a circular dependency with extractor.py.
        import json as _json
        from extractor import _repair_json
        try:
            return _json.loads(_repair_json(text))
        except Exception as e:
            raise SidecarError(f"anthropic returned non-JSON: {e}") from e


def anthropic_vision_extract(system: str, prompt: str, schema: dict,
                             images: list[bytes], media_type: str = "image/png") -> dict:
    """Run a multi-sheet vision extraction (system + all sheet images in one call)."""
    req = ExtractRequest(prompt=prompt, schema=schema, images=images,
                         media_type=media_type, system=system)
    return AnthropicProvider().extract(req)


# ── Codex CLI vision provider ────────────────────────────────────────────────
def _codex_bin() -> str:
    return _cfg("CODEX_BIN", "codex")


def _codex_model() -> str:
    return _cfg("CODEX_MODEL", "gpt-5.5")


def codex_ready() -> bool:
    try:
        r = subprocess.run(
            [_codex_bin(), "login", "status"],
            capture_output=True, text=True, timeout=8,
        )
        return r.returncode == 0 and "Logged in" in ((r.stdout or "") + (r.stderr or ""))
    except Exception:
        return False


def _codex_media_suffix(media_type: str) -> str:
    mt = (media_type or "image/png").lower()
    if "jpeg" in mt or "jpg" in mt:
        return ".jpg"
    if "webp" in mt:
        return ".webp"
    return ".png"


def codex_vision_extract(system: str, prompt: str, schema: dict,
                         images: list[bytes], media_type: str = "image/png") -> dict:
    if not images:
        raise SidecarError("codex vision requires at least one image")
    suffix = _codex_media_suffix(media_type)
    with tempfile.TemporaryDirectory(prefix="printo-codex-") as td:
        tmp = Path(td)
        paths: list[str] = []
        for i, img in enumerate(images):
            if not img:
                continue
            p = tmp / f"sheet_{i + 1}{suffix}"
            p.write_bytes(img)
            paths.append(str(p))
        if not paths:
            raise SidecarError("codex vision requires non-empty image data")

        output_path = tmp / "codex-output.txt"
        full_prompt = (
            f"{system}\n\n{prompt}\n\n"
            "Inspect every attached drawing image. Return only one valid JSON object "
            "matching this schema. Do not include markdown or explanation.\n"
            f"JSON schema: {json.dumps(schema or {}, ensure_ascii=False)}"
        )
        cmd = [
            _codex_bin(),
            "--ask-for-approval", "never",
            "exec",
            "--skip-git-repo-check",
            "--sandbox", "read-only",
            "--model", _codex_model(),
            "-o", str(output_path),
        ]
        for path in paths:
            cmd.extend(["-i", path])
        cmd.append("-")
        try:
            r = subprocess.run(
                cmd, input=full_prompt, capture_output=True, text=True,
                timeout=_vision_timeout(),
            )
        except subprocess.TimeoutExpired as e:
            raise SidecarError(f"codex timed out after {_vision_timeout()}s") from e
        except Exception as e:
            raise SidecarError(f"codex failed to start: {e}") from e
        text = ""
        if output_path.exists():
            text = output_path.read_text(encoding="utf-8", errors="replace")
        if not text:
            text = r.stdout or ""
        if r.returncode != 0 and not text:
            raise SidecarError(
                f"codex failed (exit {r.returncode}): {(r.stderr or '')[:500]}"
            )
        from extractor import _repair_json
        try:
            return json.loads(_repair_json(text))
        except Exception as e:
            detail = ((r.stderr or "") + "\n" + (r.stdout or ""))[:500]
            raise SidecarError(f"codex returned non-JSON: {e}; output={text[:500]!r}; detail={detail!r}") from e


class CodexProvider:
    name = "codex"
    mode = "vision"

    def extract(self, req: ExtractRequest) -> dict:
        images = req.images if req.images else ([req.image] if req.image else [])
        return codex_vision_extract(req.system or "", req.prompt, req.schema,
                                    images, req.media_type)


# ── Unified multi-sheet vision: prefer the Printo Gateway (Claude CLI, no API key) ──
GATEWAY_VISION_TASK = "DRAWTOBOQ_ELECTRICAL_EXTRACT"  # honours a consumer systemPrompt


def gateway_vision_ready() -> bool:
    """Gateway configured (URL set) + client importable."""
    return bool(_gateway_url()) and _gateway_client() is not None


def gateway_vision_extract(system_prompt: str, sheets: list[bytes],
                           task_id: str = GATEWAY_VISION_TASK) -> dict:
    """Send ALL sheets to the gateway's vision task with our own prompt as
    payload.systemPrompt — the gateway runs Claude CLI over the images (no key)."""
    client = _gateway_client()
    if client is None:
        raise SidecarError("printo_gateway_client not installed")
    files = [(f"sheet_{i + 1}.png", "image/png", b) for i, b in enumerate(sheets) if b]
    if not files:
        raise SidecarError("no sheet images to send")
    try:
        resp = client.invoke_vision_files(
            task_id, files, payload={"systemPrompt": system_prompt},
            use_json=True, timeout=int(_vision_timeout()))
    except Exception as e:
        raise SidecarError(f"gateway vision failed: {e}") from e

    parsed = resp.get("parsed") if isinstance(resp, dict) else None
    if isinstance(parsed, dict) and parsed:
        return parsed
    raw = resp.get("stdout") if isinstance(resp, dict) else None
    if raw:
        import json as _json
        from extractor import _repair_json
        try:
            return _json.loads(_repair_json(raw))
        except Exception:
            pass
    stderr = (resp.get("stderr") if isinstance(resp, dict) else "") or ""
    stdout = (raw or "")[:500]
    raise SidecarError(
        "gateway vision returned no parseable JSON"
        + (f"; stdout={stdout!r}" if stdout else "")
        + (f"; stderr={stderr[:500]!r}" if stderr else "")
    )


def vision_extract(system: str, prompt: str, sheets: list[bytes],
                   media_type: str = "image/png", schema: dict | None = None) -> dict:
    """Multi-sheet vision dispatcher: gateway (Claude CLI, no key) first, then a
    direct Anthropic call if a key is configured. Raises SidecarError if neither
    is available (caller falls back to the legacy single-image path)."""
    errors = []
    choice = (_cfg("AI_PROVIDER", "auto") or "auto").lower()
    if choice == "codex" and codex_ready() and sheets:
        try:
            return codex_vision_extract(system, prompt, schema or {}, sheets, media_type)
        except SidecarError as e:
            errors.append(str(e))
    if choice == "anthropic" and anthropic_ready() and sheets:
        try:
            return anthropic_vision_extract(system, prompt, schema or {}, sheets, media_type)
        except SidecarError as e:
            errors.append(str(e))
    if choice not in ("anthropic", "codex") and gateway_vision_ready() and sheets:
        try:
            return gateway_vision_extract(system + "\n\n" + prompt, sheets)
        except SidecarError as e:
            errors.append(str(e))
    if choice not in ("anthropic", "codex") and codex_ready() and sheets:
        try:
            return codex_vision_extract(system, prompt, schema or {}, sheets, media_type)
        except SidecarError as e:
            errors.append(str(e))
    if choice not in ("anthropic", "codex") and anthropic_ready() and sheets:
        try:
            return anthropic_vision_extract(system, prompt, schema or {}, sheets, media_type)
        except SidecarError as e:
            errors.append(str(e))
    raise SidecarError("no vision provider available" + (": " + " | ".join(errors) if errors else ""))


# ── Printo Gateway (Hostinger VPS via printo_gateway_client) ──────────────────
def _gateway_url() -> str:
    return _cfg("PRINTO_GATEWAY_URL")


def _gateway_client():
    """Lazy-import the gateway client, making sure its env creds are set first.
    Returns the module, or None if it isn't installed."""
    url, key = _gateway_url(), _cfg("PRINTO_GATEWAY_KEY")
    if url:
        os.environ.setdefault("PRINTO_GATEWAY_URL", url)
    if key:
        os.environ.setdefault("PRINTO_GATEWAY_KEY", key)
    try:
        import printo_gateway_client as client
        return client
    except Exception:
        return None


def _gateway_reachable(timeout: float = 2.0) -> bool:
    url = _gateway_url()
    if not url:
        return False
    try:
        u = urlparse(url)
        port = u.port or (443 if u.scheme == "https" else 80)
        with socket.create_connection((u.hostname, port), timeout=timeout):
            return True
    except Exception:
        return False


def gateway_ready() -> bool:
    """Client installed + URL configured + TCP-reachable."""
    return bool(_gateway_url()) and _gateway_client() is not None and _gateway_reachable()


class GatewayProvider:
    name = "gateway"
    mode = "gateway"

    def extract(self, req: ExtractRequest) -> dict:
        client = _gateway_client()
        if client is None:
            raise SidecarError("printo_gateway_client not installed")
        image = req.image
        if not image and req.file_path:
            try:
                with open(req.file_path, "rb") as f:
                    image = f.read()
            except Exception as e:
                raise SidecarError(f"gateway extract could not read file: {e}") from e
        if not image:
            raise SidecarError("gateway extract requires an image or file path")
        try:
            resp = client.invoke_vision(
                GATEWAY_VISION_TASK,
                image,
                payload={"systemPrompt": (req.system or "") + "\n\n" + req.prompt},
                mime=req.media_type,
                filename=req.original_name or "drawing.png",
                use_json=True,
                timeout=int(_vision_timeout()),
            )
        except Exception as e:
            raise SidecarError(f"gateway extract failed: {e}") from e
        parsed = resp.get("parsed") if isinstance(resp, dict) else None
        if isinstance(parsed, dict) and parsed:
            return parsed
        raise SidecarError("gateway extract returned no parseable JSON")


def gateway_erp_map(extracted: dict) -> dict | None:
    """Delegate ERP mapping to the gateway: invoke('ERP_MAP', {...})['parsed'].
    Returns the parsed ERP data dict, or None on any failure (caller uses local map)."""
    client = _gateway_client()
    if client is None or not _gateway_url():
        return None
    try:
        res = client.invoke("ERP_MAP", {"extracted_fields": extracted})
        parsed = res.get("parsed") if isinstance(res, dict) else None
        return parsed if isinstance(parsed, dict) and parsed else None
    except Exception:
        return None


# ── factory + status ───────────────────────────────────────────────────────────
def resolve_provider():
    """Pick a provider per env. Returns (provider, status_dict).
    Preference order in 'auto': gateway → sidecar → mock."""
    choice = (_cfg("AI_PROVIDER", "auto") or "auto").lower()
    mode_cfg = _cfg("SIDECAR_MODE", "auto").lower() or "auto"

    if choice == "mock":
        return MockProvider(), {"ai_provider": "mock", "sidecar_reachable": False,
                                "mode": "mock", "model": "builtin-demo"}

    if choice == "anthropic":
        if anthropic_ready():
            return AnthropicProvider(), {"ai_provider": "anthropic", "sidecar_reachable": True,
                                         "mode": "vision", "model": _anthropic_model()}
        reason = "ANTHROPIC_API_KEY is missing or failed authentication"
        return UnavailableProvider(reason), {"ai_provider": "unavailable", "sidecar_reachable": False,
                                             "mode": "unavailable", "model": _anthropic_model(),
                                             "note": reason}
        return MockProvider(), {"ai_provider": "mock", "sidecar_reachable": False,
                                "mode": "mock", "model": "builtin-demo",
                                "note": "ANTHROPIC_API_KEY unset — using mock"}

    if choice == "codex":
        if codex_ready():
            return CodexProvider(), {"ai_provider": "codex", "sidecar_reachable": True,
                                     "mode": "vision", "model": _codex_model()}
        reason = "Codex CLI is not logged in or not available"
        return UnavailableProvider(reason), {"ai_provider": "unavailable", "sidecar_reachable": False,
                                             "mode": "unavailable", "model": _codex_model(),
                                             "note": reason}

    if choice == "gateway":
        if _gateway_client() is not None and _gateway_url():
            return GatewayProvider(), {"ai_provider": "gateway",
                                       "sidecar_reachable": _gateway_reachable(),
                                       "mode": "gateway", "model": "printo-gateway"}
        reason = "gateway client/URL unavailable"
        return UnavailableProvider(reason), {"ai_provider": "unavailable", "sidecar_reachable": False,
                                             "mode": "unavailable", "model": "printo-gateway",
                                             "note": reason}
        return MockProvider(), {"ai_provider": "mock", "sidecar_reachable": False,
                                "mode": "mock", "model": "builtin-demo",
                                "note": "gateway client/URL unavailable — using mock"}

    health = sidecar_health()
    if choice == "sidecar":
        prov = SidecarProvider(mode=mode_cfg, health=health)
        return prov, {"ai_provider": "sidecar", "sidecar_reachable": health is not None,
                      "mode": prov.mode, "model": (health or {}).get("model", "unknown")}

    # auto — prefer direct Anthropic vision (multi-sheet), then gateway, sidecar, mock
    if anthropic_ready():
        return AnthropicProvider(), {"ai_provider": "anthropic", "sidecar_reachable": True,
                                     "mode": "vision", "model": _anthropic_model()}
    if codex_ready():
        return CodexProvider(), {"ai_provider": "codex", "sidecar_reachable": True,
                                 "mode": "vision", "model": _codex_model()}
    if gateway_ready():
        return GatewayProvider(), {"ai_provider": "gateway", "sidecar_reachable": True,
                                   "mode": "gateway", "model": "printo-gateway"}
    if health is not None:
        prov = SidecarProvider(mode=mode_cfg, health=health)
        return prov, {"ai_provider": "sidecar", "sidecar_reachable": True,
                      "mode": prov.mode, "model": health.get("model", "unknown")}
    if _cfg("ALLOW_MOCK_EXTRACTION").lower() != "true":
        reason = "no real AI extraction provider is available"
        return UnavailableProvider(reason), {"ai_provider": "unavailable", "sidecar_reachable": False,
                                             "mode": "unavailable", "model": "none",
                                             "note": reason}
    return MockProvider(), {"ai_provider": "mock", "sidecar_reachable": False,
                            "mode": "mock", "model": "builtin-demo",
                            "note": "no gateway/sidecar reachable — using mock"}


def provider_status() -> dict:
    """Lightweight status for the /health endpoint (no extraction)."""
    _, status = resolve_provider()
    return status
