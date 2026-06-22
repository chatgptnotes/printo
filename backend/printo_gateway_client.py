"""
printo_gateway_client.py — vendored from the VPS gateway (/opt/printo-ai-gateway/clients).

Talks to the Printo AI Gateway (task-routed Claude-CLI gateway), which exposes
every AI capability behind a single auth key and a `taskID`:

    DRAWING_EXTRACT   vision  -> all structured fields + per-field confidence
    DRAWING_ANALYZE   vision  -> extract + validate (18 rules) + issues + summary
    DRAWING_VALIDATE  text    -> validate an already-extracted field set
    ERP_MAP           text    -> normalized RealSoft ERP payload
    REPORT_HTML       text    -> standalone HTML validation report
    GENERIC_ASK       text    -> free-form passthrough

Config via environment variables (set these in the Printo .env):
    PRINTO_GATEWAY_URL    e.g. http://127.0.0.1:8095            (local / SSH tunnel)
                          or   https://printo-gw.hopetech.me     (prod, behind nginx+TLS)
    PRINTO_GATEWAY_KEY    the PRINTO_GATEWAY_KEY from the gateway .env

Usage:
    from printo_gateway_client import extract_drawing, analyze_drawing, invoke

    fields = extract_drawing("plan.pdf")              # dict of fields + confidence
    report = analyze_drawing("plan.pdf")              # full analysis (status/issues/...)
    erp    = invoke("ERP_MAP", {"extracted_fields": fields})["parsed"]
"""
import json
import mimetypes
import os
import urllib.error
import urllib.request

GATEWAY_URL = os.environ.get("PRINTO_GATEWAY_URL", "http://127.0.0.1:8095").rstrip("/")
GATEWAY_KEY = os.environ.get("PRINTO_GATEWAY_KEY", "")

_TEXT_TASKS = {"DRAWING_VALIDATE", "ERP_MAP", "REPORT_HTML", "GENERIC_ASK"}
_VISION_TASKS = {"DRAWING_EXTRACT", "DRAWING_ANALYZE"}


def _headers(extra=None):
    h = {"authorization": f"Bearer {GATEWAY_KEY}"}
    if extra:
        h.update(extra)
    return h


def invoke(task_id, payload=None, use_json=None, model=None, timeout=260):
    """Run a TEXT task. Returns the full gateway response dict.

    The model's structured answer is in response["parsed"] when use_json is on
    (the default for JSON tasks); the raw text is always in response["stdout"].
    """
    if task_id.upper() in _VISION_TASKS:
        raise ValueError(f"{task_id} is a vision task — use invoke_vision().")
    body = {"taskID": task_id, "payload": payload}
    if use_json is not None:
        body["useJson"] = use_json
    if model:
        body["model"] = model
    req = urllib.request.Request(
        f"{GATEWAY_URL}/api/invoke",
        data=json.dumps(body).encode(),
        headers=_headers({"content-type": "application/json"}),
    )
    return _send(req, timeout)


def invoke_vision(task_id, source, payload=None, mime=None, filename=None,
                  use_json=None, model=None, timeout=300):
    """Run a VISION task with one drawing file (path or bytes). Returns the
    full gateway response dict (structured answer in response["parsed"])."""
    if task_id.upper() in _TEXT_TASKS:
        raise ValueError(f"{task_id} is a text task — use invoke().")

    if isinstance(source, (bytes, bytearray)):
        data = bytes(source)
        filename = filename or "drawing"
        mime = mime or (mimetypes.guess_type(filename)[0] or "image/png")
    else:
        with open(source, "rb") as f:
            data = f.read()
        filename = filename or os.path.basename(source)
        mime = mime or (mimetypes.guess_type(source)[0] or "application/octet-stream")

    fields = {"taskID": task_id}
    if payload is not None:
        fields["payload"] = json.dumps(payload)
    if use_json is not None:
        fields["useJson"] = "true" if use_json else "false"
    if model:
        fields["model"] = model

    body, content_type = _multipart(fields, filename, mime, data)
    req = urllib.request.Request(
        f"{GATEWAY_URL}/api/invoke-vision",
        data=body,
        headers=_headers({"content-type": content_type}),
    )
    return _send(req, timeout)


def extract_drawing(source, known_facts=None, model=None, **kw):
    """Convenience: DRAWING_EXTRACT -> the extracted fields dict (or {} )."""
    payload = {"known_facts": known_facts} if known_facts else None
    resp = invoke_vision("DRAWING_EXTRACT", source, payload=payload, model=model, **kw)
    return resp.get("parsed") or {}


def analyze_drawing(source, model=None, **kw):
    """Convenience: DRAWING_ANALYZE -> the full analysis dict (or {} )."""
    resp = invoke_vision("DRAWING_ANALYZE", source, model=model, **kw)
    return resp.get("parsed") or {}


def _send(req, timeout):
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"gateway {e.code}: {e.read().decode()[:500]}") from None


def _multipart(fields, filename, mime, file_bytes):
    boundary = "----printo-gw-boundary-7f3a2c"
    pre = []
    for k, v in fields.items():
        pre.append(f"--{boundary}\r\n".encode())
        pre.append(f'Content-Disposition: form-data; name="{k}"\r\n\r\n'.encode())
        pre.append(f"{v}\r\n".encode())
    pre.append(f"--{boundary}\r\n".encode())
    pre.append(
        f'Content-Disposition: form-data; name="files"; filename="{filename}"\r\n'.encode()
    )
    pre.append(f"Content-Type: {mime}\r\n\r\n".encode())
    body = b"".join(pre) + file_bytes + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("usage: python printo_gateway_client.py <drawing-file> [extract|analyze]")
        raise SystemExit(2)
    mode = sys.argv[2] if len(sys.argv) > 2 else "analyze"
    if mode == "extract":
        print(json.dumps(extract_drawing(sys.argv[1]), indent=2))
    else:
        res = analyze_drawing(sys.argv[1])
        print("STATUS :", res.get("status"))
        print("SUMMARY:", res.get("summary"))
        print("SCORE  :", res.get("quality_score"))
        for i in res.get("issues", []):
            print("  -", i)
