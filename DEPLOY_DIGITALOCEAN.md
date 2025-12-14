# DigitalOcean deployment (single domain, /dashboard)

This repo can be deployed on a DigitalOcean Droplet using Docker Compose:
- Marketing site (Next.js) on `/`
- Dashboard (React SPA) on `/dashboard/*`
- Backend API on `/api/*`
- MongoDB in a container (persistent volume)

## 1) Create a DigitalOcean project + droplet
1. In DigitalOcean, create a **Project** (any name).
2. Create a **Droplet** (Ubuntu LTS, e.g. 22.04/24.04).
3. Add your SSH key to the droplet.

## 2) Install Docker on the droplet
SSH into the droplet and run:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo $VERSION_CODENAME) stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER
```
Log out and back in.

## 3) Clone the GitHub repo onto the droplet
Example:

```bash
sudo mkdir -p /opt/waraqa
sudo chown -R $USER:$USER /opt/waraqa
cd /opt/waraqa

git clone https://github.com/<your-org-or-user>/<your-repo>.git app
cd app
```

## 4) Configure environment variables
Copy the example and edit:

```bash
cp .env.example .env
nano .env
```

At minimum, set:
- `FRONTEND_URL=https://yourdomain.com`
- `JWT_SECRET=...`
- `REFRESH_TOKEN_SECRET=...`

## 5) Run the stack

```bash
docker compose up -d --build
```

Your droplet will listen on port 80.

## 6) Point your domain to the droplet
- Create an `A` record to the droplet IP.
- Optional: add TLS using a Load Balancer or certbot (not included here).

## 7) Auto-deploy from GitHub
This repo includes GitHub Actions workflow: `.github/workflows/deploy-droplet.yml`.

Add these GitHub repo secrets:
- `DO_HOST` = droplet IP (or hostname)
- `DO_USER` = SSH username (e.g. `root` or `ubuntu`)
- `DO_SSH_KEY` = private key for that user (PEM)
- `DO_APP_DIR` = path to the cloned repo folder (e.g. `/opt/waraqa/app`)

On every push to `main`, GitHub will SSH into the droplet and run:
- `git reset --hard origin/main`
- `docker compose up -d --build`

## Notes
- MongoDB is running inside the droplet. For production, consider backups + firewalling and/or an external managed Mongo provider.
