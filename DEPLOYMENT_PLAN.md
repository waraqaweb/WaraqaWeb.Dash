Deployment Plan (React dashboard + Next marketing + API + MongoDB panel)
This gives you a repeatable, “first-try” deploy that avoids the port conflicts, restarts, and 502s you saw.

1. Droplet baseline (Ubuntu 24.04, ≥2 GB RAM recommended)

Create a fresh droplet (or upgrade current one to 2 GB).

Add a 2 GB swap file:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
Install Docker from the official repo (brings docker + compose v2):

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git

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
Install Nginx + Certbot for SSL:
sudo apt-get install -y nginx certbot python3-certbot-nginx
sudo mkdir -p /opt/waraqa
sudo chown -R $USER:$USER /opt/waraqa
cd /opt/waraqa
git clone https://github.com/waraqaweb/WaraqaWeb.Dash.git app
cd app
git checkout main
git pull origin main

# create .env (fill secrets)

cat > .env <<'EOF'
FRONTEND_URL=https://test.waraqaweb.com
JWT_SECRET=<<generate-long-random>>
REFRESH_TOKEN_SECRET=<<generate-long-random>>
DB_PANEL_USER=admin
DB_PANEL_PASSWORD=<<strong-password>>
EOF
web:
...
ports: - "127.0.0.1:8080:80"

      cd /opt/waraqa/app

docker compose up -d --build
docker compose ps
curl -I http://127.0.0.1:8080/ | head -n 5
