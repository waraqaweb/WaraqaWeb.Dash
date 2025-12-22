# Waraqa Deployment Guide (Production)

This guide is for:

- First-time deployment on a fresh DigitalOcean droplet (Ubuntu 24.04)
- Safe updates (pull latest code + rebuild containers)
- Safe database migration/restore (when you moved DB from old dashboard)

**Important:** Never store real passwords in Git. Use `.env` on the droplet and rotate credentials if anything was ever committed.

---

## 0) What runs where

- **Host (droplet):** Nginx listens on `80/443` and proxies to Docker at `127.0.0.1:8080`.
- **Docker Compose stack:** `mongo`, `mongo-express` (DB panel), `backend`, `marketing` (Next.js), `web` (nginx serving dashboard + reverse proxy to backend/marketing).

---

## 1) First-time droplet setup

### 1.1 Base packages

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git nginx
sudo apt-get install -y certbot python3-certbot-nginx
```

### 1.2 Install Docker (official repo) + compose v2

```bash
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
"deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
$(. /etc/os-release && echo ${VERSION_CODENAME}) stable" | \
sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

### 1.3 Clone repo

```bash
sudo mkdir -p /opt/waraqa
sudo chown -R $USER:$USER /opt/waraqa
cd /opt/waraqa

git clone https://github.com/waraqaweb/WaraqaWeb.Dash.git app
cd app
```

### 1.4 Create `.env` on the droplet (production secrets)

```bash
cd /opt/waraqa/app

cat > .env <<'EOF'
FRONTEND_URL=https://test.waraqaweb.com
JWT_SECRET=<generate-long-random>
REFRESH_TOKEN_SECRET=<generate-long-random>
DB_PANEL_USER=admin
DB_PANEL_PASSWORD=<strong-password>
EOF
```

### 1.5 Build and run

```bash
cd /opt/waraqa/app

# Confirm compose binds localhost only (avoid conflicts with host nginx)
# In docker-compose.yml web ports must be: 127.0.0.1:8080:80

docker compose up -d --build

docker compose ps
curl -I http://127.0.0.1:8080/ | head -n 5
```

### 1.6 Host Nginx reverse proxy

```bash
sudo tee /etc/nginx/sites-available/waraqa.conf >/dev/null <<'EOF'
server {
  listen 80;
  server_name test.waraqaweb.com;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /socket.io/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/waraqa.conf /etc/nginx/sites-enabled/waraqa.conf
sudo nginx -t
sudo systemctl reload nginx
```

### 1.7 Enable HTTPS (Certbot)

```bash
sudo certbot --nginx -d test.waraqaweb.com -m you@example.com --agree-tos --no-eff-email
sudo certbot renew --dry-run
```

---

## 2) Safe code updates (no corruption)

Run these commands on the droplet:

```bash
cd /opt/waraqa/app

# record rollback point
OLD_HASH=$(git rev-parse HEAD)
echo "Current: $OLD_HASH"

# update code safely (no merges)
git fetch origin
git reset --hard origin/main

# rebuild + restart everything (dashboard + marketing + backend)
docker compose up -d --build

docker compose ps
```

### 2.1 Quick health checks

```bash
curl -I http://127.0.0.1:8080/ | head -n 5
curl -I https://test.waraqaweb.com/ | head -n 5
curl -I https://test.waraqaweb.com/dashboard/login | head -n 5
```

### 2.2 Rollback

```bash
cd /opt/waraqa/app

git reset --hard <PASTE_OLD_HASH>
docker compose up -d --build
```

---

## 3) DB panel ("cPanel")

- DB panel URL (mongo-express): `https://test.waraqaweb.com/db/`
- Username/password: `DB_PANEL_USER` / `DB_PANEL_PASSWORD` from `.env` on the droplet.

### 3.1 Rotate DB panel password (recommended)

On the droplet:

```bash
cd /opt/waraqa/app

# edit the real server env file
nano .env

# then restart the affected containers
docker compose up -d --force-recreate mongo-express web
```

If you accidentally shared/committed a password at any point, rotate it immediately.

---

## 4) Database migration / restore

Use the dedicated guide:

- See `deployment/DB_MIGRATION.md`
