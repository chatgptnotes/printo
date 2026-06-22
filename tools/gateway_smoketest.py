"""
Printo Gateway go-live smoke test.

Run this once the `printo_gateway_client` package is installed and the tunnel to
PRINTO_GATEWAY_URL (default http://127.0.0.1:8095) is up. It verifies the full
live path end-to-end so you know the gateway is wired correctly:

    1. env creds present
    2. gateway TCP-reachable
    3. client importable
    4. extract_drawing() on a sample drawing returns fields
    5. invoke("ERP_MAP", {...})["parsed"] returns an ERP payload

Usage (from repo root):
    python tools/gateway_smoketest.py [path-to-drawing]

Exits 0 on full success, 1 otherwise. Reads .env automatically.
"""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SAMPLE = ROOT / "test_drawings" / "ground_floor_plan.png"


def _load_env():
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except Exception:
        pass


def main(argv) -> int:
    _load_env()
    # Reuse the backend's gateway helpers so this tests the real integration path.
    sys.path.insert(0, str(ROOT / "backend"))
    import ai_provider as gw

    drawing = Path(argv[1]) if len(argv) > 1 else SAMPLE
    ok = True

    url = gw._gateway_url()
    print(f"1) PRINTO_GATEWAY_URL set ........ {'yes ' + url if url else 'NO — set it in .env'}")
    ok &= bool(url)

    reachable = gw._gateway_reachable()
    print(f"2) gateway TCP-reachable ......... {'yes' if reachable else 'NO — is the tunnel/agent up?'}")
    ok &= reachable

    client = gw._gateway_client()
    print(f"3) printo_gateway_client import .. {'yes' if client else 'NO — pip install the client'}")
    ok &= client is not None

    if not (url and reachable and client):
        print("\nRESULT: NOT READY — fix the above, then re-run.")
        return 1

    if not drawing.exists():
        print(f"4) sample drawing ................ MISSING: {drawing}")
        return 1
    try:
        fields = client.extract_drawing(str(drawing))
        n = sum(1 for k, v in (fields or {}).items()
                if k != "confidence" and v not in (None, "", [], False)) if isinstance(fields, dict) else 0
        print(f"4) extract_drawing() ............. ok — {n} fields")
    except Exception as e:
        print(f"4) extract_drawing() ............. FAILED: {e}")
        return 1

    try:
        parsed = gw.gateway_erp_map(fields)
        if parsed:
            print(f"5) invoke('ERP_MAP') ............. ok — {len(parsed)} ERP fields")
        else:
            print("5) invoke('ERP_MAP') ............. returned nothing (will use local mapper)")
            ok = False
    except Exception as e:
        print(f"5) invoke('ERP_MAP') ............. FAILED: {e}")
        ok = False

    print("\nRESULT:", "LIVE ✓ — set AI_PROVIDER=auto and restart." if ok
          else "PARTIAL — extraction works; ERP_MAP needs attention.")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
