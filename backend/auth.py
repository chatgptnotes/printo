"""
Authentication: bcrypt password verification + signed JWT access tokens, with a
small in-memory brute-force lockout and a FastAPI dependency that protects routes.

Security choices:
- Passwords are stored only as bcrypt hashes (never plaintext).
- Tokens are HS256 JWTs signed with AUTH_SECRET (set/rotate this in production).
- Login returns a GENERIC error (no username enumeration) and is rate-limited.
- require_auth accepts the token via `Authorization: Bearer` OR a `?token=` query
  param (the latter lets browser-opened report links carry auth).
"""

import os
import time
import datetime

import bcrypt
import jwt
from fastapi import HTTPException, Request

from database import get_conn

AUTH_SECRET = os.getenv("AUTH_SECRET", "change-me-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRY_HOURS = int(os.getenv("TOKEN_EXPIRY_HOURS", "8"))
REMEMBER_EXPIRY_DAYS = int(os.getenv("REMEMBER_EXPIRY_DAYS", "30"))
MAX_ATTEMPTS = int(os.getenv("MAX_ATTEMPTS", "5"))
LOCKOUT_SECONDS = int(os.getenv("LOCKOUT_SECONDS", "300"))

if AUTH_SECRET == "change-me-in-production":
    print("[auth] WARNING: AUTH_SECRET is the insecure default — set it in .env for production.")


# ── password hashing ──────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


# ── JWT ─────────────────────────────────────────────────────────────────────
def create_token(username: str, role: str, remember: bool = False) -> tuple[str, int]:
    """Return (jwt, expires_in_seconds)."""
    ttl = (REMEMBER_EXPIRY_DAYS * 86400) if remember else (TOKEN_EXPIRY_HOURS * 3600)
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {"sub": username, "role": role,
               "iat": now, "exp": now + datetime.timedelta(seconds=ttl)}
    return jwt.encode(payload, AUTH_SECRET, algorithm=ALGORITHM), ttl


def decode_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, AUTH_SECRET, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None


# ── brute-force lockout (in-memory; per username/identifier) ───────────────────
_attempts: dict[str, dict] = {}


def is_locked(identifier: str) -> int:
    """Return remaining lockout seconds (0 if not locked)."""
    rec = _attempts.get(identifier.lower())
    if rec and rec.get("until", 0) > time.time():
        return int(rec["until"] - time.time())
    return 0


def record_failure(identifier: str):
    key = identifier.lower()
    rec = _attempts.setdefault(key, {"fails": 0, "until": 0})
    rec["fails"] += 1
    if rec["fails"] >= MAX_ATTEMPTS:
        rec["until"] = time.time() + LOCKOUT_SECONDS
        rec["fails"] = 0


def clear_failures(identifier: str):
    _attempts.pop(identifier.lower(), None)


# ── user lookup / login ────────────────────────────────────────────────────────
def get_user_by_login(identifier: str) -> dict | None:
    conn = get_conn()
    row = conn.execute(
        "SELECT id, username, email, password_hash, role FROM users "
        "WHERE lower(username) = lower(?) OR lower(email) = lower(?)",
        (identifier, identifier),
    ).fetchone()
    conn.close()
    if not row:
        return None
    return {"id": row[0], "username": row[1], "email": row[2],
            "password_hash": row[3], "role": row[4]}


def verify_login(identifier: str, password: str) -> dict | None:
    """Return the user dict on success, else None (generic — no enumeration)."""
    user = get_user_by_login(identifier)
    if not user or not verify_password(password, user["password_hash"]):
        return None
    conn = get_conn()
    conn.execute("UPDATE users SET last_login = ? WHERE id = ?",
                 (datetime.datetime.now().isoformat(), user["id"]))
    conn.commit()
    conn.close()
    return user


# ── FastAPI dependency ──────────────────────────────────────────────────────
def _extract_token(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    return request.query_params.get("token")          # for browser-opened links


def require_auth(request: Request) -> dict:
    token = _extract_token(request)
    claims = decode_token(token) if token else None
    if not claims:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return {"username": claims.get("sub"), "role": claims.get("role")}
