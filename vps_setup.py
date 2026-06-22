import paramiko, os, time, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

VPS_IP   = "76.13.244.21"
VPS_USER = "root"
VPS_PASS = "Nagpur@260526"
LOCAL    = r"C:\Users\ACER\Documents\Printo"
REMOTE   = "/opt/printo"

def ssh():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(VPS_IP, username=VPS_USER, password=VPS_PASS,
              timeout=20, look_for_keys=False, allow_agent=False)
    return c

def run(client, cmd, timeout=120, show=True):
    if show:
        print(f"\n$ {cmd[:80]}")
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode()
    err = stderr.read().decode()
    combined = (out + err).strip()
    if combined and show:
        safe = combined[:800].encode('ascii', errors='replace').decode('ascii')
        print(safe)
    return combined

def upload(sftp, local_path, remote_path, skip=None):
    skip = skip or set()
    try: sftp.mkdir(remote_path)
    except: pass
    for item in os.listdir(local_path):
        if item in skip or item.endswith('.pyc') or item == '__pycache__':
            continue
        lp = os.path.join(local_path, item)
        rp = f"{remote_path}/{item}"
        if os.path.isdir(lp):
            upload(sftp, lp, rp, skip)
        else:
            sftp.put(lp, rp)
            print(f"  + {item}")

print("=== Connecting to VPS ===")
c = ssh()
print("Connected!")
run(c, "df -h / && ls /opt/printo/", timeout=10)

# --- Step 5: Install Python packages ---
print("\n=== Step 5: Installing Python packages (3-5 min) ===")
pip = f"{REMOTE}/venv/bin/pip"
run(c, f"{pip} install --upgrade pip", timeout=120)
run(c, f"{pip} install fastapi==0.138.0 'uvicorn[standard]' streamlit anthropic "
       f"python-multipart pydantic python-dotenv Pillow requests openpyxl pdfplumber",
    timeout=480)

# --- Step 6: Fix frontend API_URL for VPS ---
run(c, f"sed -i 's|127.0.0.1:8000|127.0.0.1:8000|g' {REMOTE}/frontend/app.py")

# --- Step 7: Systemd services ---
print("\n=== Step 6: Creating services ===")
backend_svc = f"""[Unit]
Description=Printo Backend
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory={REMOTE}/backend
EnvironmentFile={REMOTE}/.env
ExecStart={REMOTE}/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"""

frontend_svc = f"""[Unit]
Description=Printo Frontend
After=printo-backend.service

[Service]
Type=simple
User=root
WorkingDirectory={REMOTE}
EnvironmentFile={REMOTE}/.env
ExecStart={REMOTE}/venv/bin/streamlit run frontend/app.py --server.port 8501 --server.address 127.0.0.1 --server.headless true
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target"""

nginx_conf = """server {
    listen 80;
    server_name _;
    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:8501;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}"""

run(c, f"cat > /etc/systemd/system/printo-backend.service << 'SVCEOF'\n{backend_svc}\nSVCEOF")
run(c, f"cat > /etc/systemd/system/printo-frontend.service << 'SVCEOF'\n{frontend_svc}\nSVCEOF")
run(c, f"cat > /etc/nginx/sites-available/printo << 'NGEOF'\n{nginx_conf}\nNGEOF")
run(c, "ln -sf /etc/nginx/sites-available/printo /etc/nginx/sites-enabled/")
run(c, "rm -f /etc/nginx/sites-enabled/default")
run(c, "nginx -t && systemctl reload nginx")

# --- Step 8: Start services ---
print("\n=== Step 7: Starting services ===")
run(c, "systemctl daemon-reload")
run(c, "systemctl enable printo-backend printo-frontend")
run(c, "systemctl restart printo-backend")
time.sleep(5)
run(c, "systemctl restart printo-frontend")
time.sleep(8)

# --- Step 9: Health check ---
print("\n=== Step 8: Health check ===")
run(c, "systemctl status printo-backend --no-pager | tail -5")
run(c, "systemctl status printo-frontend --no-pager | tail -5")
run(c, "curl -s http://127.0.0.1:8000/health 2>&1 | head -3")

print(f"""
╔══════════════════════════════════════════╗
║  PRINTO DEPLOYED SUCCESSFULLY!           ║
║                                          ║
║  App:     http://{VPS_IP}        ║
║  API:     http://{VPS_IP}/api/health ║
║  Docs:    http://{VPS_IP}/api/docs  ║
╚══════════════════════════════════════════╝
""")
c.close()
