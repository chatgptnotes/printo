"""
RealSoft ERP API client.
Fill REALSOFT_BASE_URL and REALSOFT_API_KEY from Coral Business Solutions.
"""
import os
import json
import datetime

# ── Config (set in .env or environment) ────────────────────────────────────
REALSOFT_BASE_URL = os.getenv("REALSOFT_BASE_URL", "https://test-api.realsoft-me.com")
REALSOFT_API_KEY  = os.getenv("REALSOFT_API_KEY",  "YOUR_TEST_API_KEY_FROM_CORAL")
REALSOFT_TIMEOUT  = int(os.getenv("REALSOFT_TIMEOUT", "30"))

HEADERS = {
    "Content-Type":  "application/json",
    "Accept":        "application/json",
    "Authorization": f"Bearer {REALSOFT_API_KEY}",
    "X-Source":      "ERP-RealSoft-AI",
}


class RealSoftAPIError(Exception):
    pass


def push_to_realsoft(payload: dict) -> dict:
    """
    POST the mapped drawing JSON to RealSoft test environment.
    Returns the API response as a dict.
    """
    import requests as _requests
    url = f"{REALSOFT_BASE_URL}/api/v1/import"   # confirm endpoint with Coral

    try:
        resp = _requests.post(
            url,
            headers=HEADERS,
            json=payload,
            timeout=REALSOFT_TIMEOUT,
        )
        resp.raise_for_status()
        return {
            "success":     True,
            "status_code": resp.status_code,
            "response":    resp.json() if resp.text else {},
            "pushed_at":   datetime.datetime.now().isoformat(),
        }
    except _requests.exceptions.ConnectionError:
        raise RealSoftAPIError(f"Cannot connect to RealSoft server at {REALSOFT_BASE_URL}")
    except _requests.exceptions.Timeout:
        raise RealSoftAPIError(f"RealSoft API timed out after {REALSOFT_TIMEOUT}s")
    except _requests.exceptions.HTTPError as e:
        raise RealSoftAPIError(f"RealSoft API returned {resp.status_code}: {resp.text}")


def ping_realsoft() -> bool:
    """Health check — confirm test environment is reachable."""
    try:
        import requests as _requests
        resp = _requests.get(
            f"{REALSOFT_BASE_URL}/api/v1/health",
            headers=HEADERS,
            timeout=10,
        )
        return resp.status_code == 200
    except Exception:
        return False


def get_from_realsoft(module: str, filters: dict = None) -> dict:
    """
    Extract / read data FROM RealSoft via Data API.
    Example: get_from_realsoft("DrawingMaster", {"DrawingNo": "DWG-001"})
    """
    import requests as _requests
    url = f"{REALSOFT_BASE_URL}/dataapi/{module}"
    try:
        resp = _requests.get(
            url,
            headers=HEADERS,
            params=filters or {},
            timeout=REALSOFT_TIMEOUT,
        )
        resp.raise_for_status()
        return resp.json()
    except requests.exceptions.HTTPError as e:
        raise RealSoftAPIError(f"RealSoft Data API error {resp.status_code}: {resp.text}")
