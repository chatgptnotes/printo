#!/bin/bash
# Printo VPS Deployment Script
# Run as root on Ubuntu VPS

set -e
echo "=== Printo VPS Deployment ==="

# 1. Update system
apt-get update -y
apt-get install -y python3 python3-pip python3-venv nginx git curl

# 2. Create app directory
mkdir -p /opt/printo
cd /opt/printo

# 3. Create virtual environment
python3 -m venv venv
source venv/bin/activate

# 4. Install Python packages
pip install --upgrade pip
pip install fastapi uvicorn streamlit anthropic python-multipart pydantic \
            python-dotenv aiofiles Pillow requests openpyxl pdfplumber

# 5. Create .env file
cat > /opt/printo/.env << 'ENVEOF'
ANTHROPIC_API_KEY=demo
REALSOFT_BASE_URL=
REALSOFT_API_KEY=
ENVEOF

echo "Enter your Anthropic API key (press Enter to skip for demo mode):"
read -r api_key
if [ -n "$api_key" ]; then
    sed -i "s/ANTHROPIC_API_KEY=demo/ANTHROPIC_API_KEY=$api_key/" /opt/printo/.env
    echo "API key set."
fi

# 6. Create systemd service for backend
cat > /etc/systemd/system/printo-backend.service << 'SVCEOF'
[Unit]
Description=Printo Backend API
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/printo/backend
EnvironmentFile=/opt/printo/.env
ExecStart=/opt/printo/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

# 7. Create systemd service for frontend
cat > /etc/systemd/system/printo-frontend.service << 'SVCEOF'
[Unit]
Description=Printo Streamlit Frontend
After=network.target printo-backend.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/printo
EnvironmentFile=/opt/printo/.env
ExecStart=/opt/printo/venv/bin/streamlit run frontend/app.py --server.port 8501 --server.address 0.0.0.0 --server.headless true
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
SVCEOF

# 8. Configure nginx reverse proxy
cat > /etc/nginx/sites-available/printo << 'NGINXEOF'
server {
    listen 80;
    server_name _;

    # Frontend (Streamlit)
    location / {
        proxy_pass http://127.0.0.1:8501;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Backend API
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 25M;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/printo /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# 9. Create storage directories
mkdir -p /opt/printo/storage /opt/printo/reports /opt/printo/logs

# 10. Enable and start services
systemctl daemon-reload
systemctl enable printo-backend printo-frontend
systemctl start printo-backend
sleep 3
systemctl start printo-frontend

echo ""
echo "=== Deployment Complete ==="
echo "Frontend: http://76.13.244.21"
echo "Backend:  http://76.13.244.21/api/health"
echo ""
systemctl status printo-backend --no-pager | tail -5
systemctl status printo-frontend --no-pager | tail -5
