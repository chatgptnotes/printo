"""
Printo VPS Deployment Script
Run: python deploy_to_vps.py
"""
import paramiko
import os
import sys

# Credentials come from the environment — never hard-code secrets in source.
#   set VPS_IP, VPS_USER, VPS_PASSWORD (or prefer key-based auth) before running.
VPS_IP       = os.getenv("VPS_IP", "")
VPS_USER     = os.getenv("VPS_USER", "root")
VPS_PASSWORD = os.getenv("VPS_PASSWORD", "")
LOCAL_DIR    = os.getenv("PRINTO_LOCAL_DIR", os.path.dirname(os.path.abspath(__file__)))
REMOTE_DIR   = "/opt/printo"

if not VPS_IP or not VPS_PASSWORD:
    sys.exit("Set VPS_IP and VPS_PASSWORD (or use SSH keys) in the environment before deploying.")

SKIP = {
    "printo.db", "__pycache__", ".git", "test_drawings",
    "deploy_to_vps.py", "deploy_vps.sh", "test_streamlit.py",
    "BUILDING_PLAN.md", "WORKFLOW_CYCLE.md", "start.bat",
}

def run(client, cmd, desc=""):
    print(f"\n>> {desc or cmd[:60]}")
    stdin, stdout, stderr = client.exec_command(cmd, get_pty=True)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out.strip(): print(out.strip())
    if err.strip() and "WARNING" not in err: print("ERR:", err.strip()[:200])
    return out

def upload_dir(sftp, local_path, remote_path):
    try:
        sftp.mkdir(remote_path)
    except OSError:
        pass
    for item in os.listdir(local_path):
        if item in SKIP or item.endswith(".pyc"):
            continue
        local_item  = os.path.join(local_path, item)
        remote_item = f"{remote_path}/{item}"
        if os.path.isdir(local_item):
            upload_dir(sftp, local_item, remote_item)
        else:
            sftp.put(local_item, remote_item)
            print(f"  uploaded {item}")

def main():
    print(f"Connecting to {VPS_IP}...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(VPS_IP, username=VPS_USER, password=VPS_PASSWORD,
                   timeout=20, look_for_keys=False, allow_agent=False)
    print("Connected!")

    # Setup (tesseract-ocr powers the optional OCR fallback; degrades gracefully if absent)
    run(client, "apt-get update -y && apt-get install -y python3 python3-pip python3-venv nginx tesseract-ocr", "Installing system packages")
    run(client, f"mkdir -p {REMOTE_DIR}/storage {REMOTE_DIR}/reports {REMOTE_DIR}/logs", "Creating directories")

    # Upload files
    print("\n>> Uploading project files...")
    sftp = client.open_sftp()
    for folder in ["backend", "frontend"]:
        upload_dir(sftp, os.path.join(LOCAL_DIR, folder), f"{REMOTE_DIR}/{folder}")
    # Upload .env + requirements.txt (the backend's full dependency set)
    sftp.put(os.path.join(LOCAL_DIR, ".env"), f"{REMOTE_DIR}/.env")
    sftp.put(os.path.join(LOCAL_DIR, "requirements.txt"), f"{REMOTE_DIR}/requirements.txt")
    # Upload .streamlit config
    try:
        sftp.mkdir(f"{REMOTE_DIR}/.streamlit")
    except OSError:
        pass
    sftp.put(os.path.join(LOCAL_DIR, ".streamlit", "config.toml"), f"{REMOTE_DIR}/.streamlit/config.toml")
    sftp.close()
    print("Files uploaded.")

    # Python venv + packages
    run(client, f"cd {REMOTE_DIR} && python3 -m venv venv", "Creating venv")
    run(client,
        f"cd {REMOTE_DIR} && source venv/bin/activate && "
        "pip install --upgrade pip && "
        "pip install -r requirements.txt",
        "Installing Python packages from requirements.txt (takes 3-5 min)")

    # Systemd services
    backend_svc = """[Unit]
Description=Printo Backend API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/printo/backend
EnvironmentFile=/opt/printo/.env
ExecStart=/opt/printo/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target"""

    frontend_svc = """[Unit]
Description=Printo Frontend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/printo
EnvironmentFile=/opt/printo/.env
ExecStart=/opt/printo/venv/bin/streamlit run frontend/app.py --server.port 8501 --server.address 0.0.0.0 --server.headless true
Restart=always

[Install]
WantedBy=multi-user.target"""

    nginx_conf = """server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:8501;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        client_max_body_size 25M;
    }
}"""

    run(client, f"cat > /etc/systemd/system/printo-backend.service << 'EOF'\n{backend_svc}\nEOF", "Creating backend service")
    run(client, f"cat > /etc/systemd/system/printo-frontend.service << 'EOF'\n{frontend_svc}\nEOF", "Creating frontend service")
    run(client, f"cat > /etc/nginx/sites-available/printo << 'EOF'\n{nginx_conf}\nEOF", "Configuring nginx")
    run(client, "ln -sf /etc/nginx/sites-available/printo /etc/nginx/sites-enabled/ && rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx", "Enabling nginx")

    run(client, "systemctl daemon-reload && systemctl enable printo-backend printo-frontend", "Enabling services")
    run(client, "systemctl restart printo-backend && sleep 4 && systemctl status printo-backend --no-pager | tail -6", "Starting backend")
    run(client, "systemctl restart printo-frontend && sleep 6 && systemctl status printo-frontend --no-pager | tail -6", "Starting frontend")

    # Health check
    run(client, "curl -s http://127.0.0.1:8000/health | python3 -c \"import sys,json; d=json.load(sys.stdin); print('Backend OK — ERP:', d['erp_mode'])\" 2>&1 || echo 'Backend not ready yet'", "Health check")

    print(f"""
=== DEPLOYMENT COMPLETE ===
Frontend: http://{VPS_IP}
Backend:  http://{VPS_IP}/api/health
API Docs: http://{VPS_IP}/api/docs
""")
    client.close()

if __name__ == "__main__":
    main()
