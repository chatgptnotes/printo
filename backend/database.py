import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "printo.db")


def get_conn():
    return sqlite3.connect(DB_PATH)


def init_db():
    conn = get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS drawings (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name       TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            uploaded_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            status          TEXT DEFAULT 'pending',
            drawing_number  TEXT,
            drawing_title   TEXT,
            project_name    TEXT,
            floor_category  TEXT DEFAULT 'Other'
        );

        CREATE TABLE IF NOT EXISTS extractions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            drawing_id  INTEGER REFERENCES drawings(id),
            field_name  TEXT NOT NULL,
            field_value TEXT,
            confidence  REAL,
            validated   INTEGER DEFAULT 0,
            flagged     INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS erp_pushes (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            drawing_id  INTEGER REFERENCES drawings(id),
            payload     TEXT,
            method      TEXT DEFAULT 'api',
            status      TEXT DEFAULT 'queued',
            pushed_at   TIMESTAMP,
            response    TEXT
        );

        CREATE TABLE IF NOT EXISTS exceptions (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            drawing_id  INTEGER REFERENCES drawings(id),
            rule_id     TEXT NOT NULL,
            field_name  TEXT,
            reason      TEXT NOT NULL,
            severity    TEXT DEFAULT 'ERROR',
            resolved    INTEGER DEFAULT 0,
            resolved_by TEXT,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS corrections (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            drawing_id      INTEGER REFERENCES drawings(id),
            field_name      TEXT NOT NULL,
            original_value  TEXT,
            corrected_value TEXT,
            corrected_by    TEXT DEFAULT 'user',
            corrected_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            email         TEXT UNIQUE,
            password_hash TEXT NOT NULL,
            role          TEXT DEFAULT 'user',
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login    TIMESTAMP
        );
    """)

    # Migrate existing drawings table — add new columns if they don't exist
    existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(drawings)").fetchall()}
    for col, typedef in [
        ("drawing_title",  "TEXT"),
        ("floor_category", "TEXT DEFAULT 'Other'"),
    ]:
        if col not in existing_cols:
            conn.execute(f"ALTER TABLE drawings ADD COLUMN {col} {typedef}")

    conn.commit()
    conn.close()
    _seed_admin()


def _seed_admin():
    """Create the seeded admin account on first run (if no users exist)."""
    import bcrypt
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if count == 0:
        username = os.getenv("ADMIN_USERNAME", "Admin")
        email    = os.getenv("ADMIN_EMAIL", "admin@printo.local")
        password = os.getenv("ADMIN_PASSWORD", "Admin@123")
        pw_hash  = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        conn.execute(
            "INSERT INTO users (username, email, password_hash, role) VALUES (?,?,?,?)",
            (username, email, pw_hash, "admin"),
        )
        conn.commit()
        print(f"[auth] Seeded admin user '{username}'. CHANGE THE PASSWORD in production.")
    conn.close()
