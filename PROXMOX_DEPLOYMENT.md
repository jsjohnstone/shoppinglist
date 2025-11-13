# Proxmox Deployment Guide

This guide covers deploying the Shopping List application and Barcode Scanner on Proxmox VE 8 using LXC containers.

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Shopping List LXC Setup](#shopping-list-lxc-setup)
- [Barcode Scanner Test LXC Setup](#barcode-scanner-test-lxc-setup)
- [Systemd Service Configuration](#systemd-service-configuration)
- [Troubleshooting](#troubleshooting)

## Overview

**Architecture:**
```
Proxmox VE 8
├── LXC 100: Shopping List App (Debian 12)
│   ├── PostgreSQL
│   ├── Ollama
│   └── Shopping List App
│   └── Port: 3000
└── LXC 101: Barcode Scanner (Debian 12)
    ├── USB Passthrough (/dev/ttyACM0)
    └── Scanner Container
```

## Prerequisites

- Proxmox VE 8.x installed and configured
- Network bridge configured for LAN access
- GitHub Container Registry access configured
- USB barcode scanner connected to Proxmox host

## Shopping List LXC Setup

### 1. Create the LXC Container

From the Proxmox web UI or shell:

```bash
# Download Debian 12 template if not already available
pveam update
pveam download local debian-12-standard_12.2-1_amd64.tar.zst

# Create LXC container
pct create 100 local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst \
  --hostname shoppinglist \
  --memory 6144 \
  --cores 4 \
  --rootfs local-lvm:30 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --startup order=1

# Start the container
pct start 100
```

**Note:** Adjust storage (`local-lvm`) and network bridge (`vmbr0`) to match your Proxmox setup.

### 2. Enter the Container

```bash
pct enter 100
```

### 3. Update System and Install Docker

```bash
# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y curl git ca-certificates gnupg

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Verify Docker installation
docker --version
docker compose version
```

### 4. Configure GitHub Container Registry Access

```bash
# Create a GitHub Personal Access Token (PAT) with read:packages scope
# Then login to GitHub Container Registry

echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u jsjohnstone --password-stdin
```

### 5. Deploy the Application

```bash
# Create application directory
mkdir -p /opt/shoppinglist
cd /opt/shoppinglist

# Download production files
curl -o docker-compose.prod.yml https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/docker-compose.prod.yml
curl -o .env.production.example https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/.env.production.example
curl -o deploy.sh https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/deploy.sh
curl -o backup.sh https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/backup.sh

# Copy and configure environment file
cp .env.production.example .env
nano .env  # Edit with secure passwords and settings

# Make scripts executable
chmod +x deploy.sh backup.sh

# Pull images and start services
./deploy.sh
```

### 6. Configure Environment Variables

Edit `/opt/shoppinglist/.env`:

```bash
# PostgreSQL Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=shoppinglist

# JWT Configuration
JWT_SECRET=your_long_random_secret_here

# Ollama Configuration
OLLAMA_MODEL=llama3.2

# Application Configuration
APP_PORT=3000
NODE_ENV=production
```

**Generate secure secrets:**
```bash
# For POSTGRES_PASSWORD
openssl rand -base64 32

# For JWT_SECRET
openssl rand -base64 64
```

### 7. Verify Deployment

```bash
# Check service status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check health
curl http://localhost:3000/api/health
```

### 8. Find Container IP Address

```bash
# From Proxmox host
pct exec 100 -- ip addr show eth0 | grep "inet "
```

Access the app at: `http://<container-ip>:3000`

## Barcode Scanner Test LXC Setup

### 1. Create the LXC Container

```bash
# Create LXC container for barcode scanner
pct create 101 local:vztmpl/debian-12-standard_12.2-1_amd64.tar.zst \
  --hostname barcode-scanner \
  --memory 1024 \
  --cores 1 \
  --rootfs local-lvm:5 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --unprivileged 1 \
  --features nesting=1 \
  --onboot 1 \
  --startup order=2

# Start the container
pct start 101
```

### 2. Configure USB Passthrough

**From Proxmox host:**

```bash
# Find USB device
lsusb
# Look for your scanner (e.g., "Access IS LSR116")

# Get device details
ls -l /dev/ttyACM*
# Note the major and minor numbers (usually 166:0 for ttyACM0)

# Edit LXC config
nano /etc/pve/lxc/101.conf
```

Add these lines to the config:

```
lxc.cgroup2.devices.allow: c 166:* rwm
lxc.mount.entry: /dev/ttyACM0 dev/ttyACM0 none bind,optional,create=file
```

**Restart the container:**
```bash
pct stop 101
pct start 101
```

### 3. Install Docker in Scanner LXC

```bash
# Enter container
pct enter 101

# Install Docker (same as Shopping List LXC)
apt update && apt upgrade -y
apt install -y curl ca-certificates gnupg

# Add Docker repository and install
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Login to GitHub Container Registry
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u jsjohnstone --password-stdin
```

### 4. Deploy Barcode Scanner

```bash
# Create app directory
mkdir -p /opt/barcode-scanner
cd /opt/barcode-scanner

# Create docker-compose.yml
cat > docker-compose.yml <<EOF
version: '3.8'

services:
  scanner:
    image: ghcr.io/jsjohnstone/shoppinglist-barcodescanner:latest
    container_name: barcode-scanner
    devices:
      - /dev/ttyACM0:/dev/ttyACM0
    environment:
      - BACKEND_URL=http://192.168.x.x:3000
      - LOG_LEVEL=info
      - TEST_MODE=false
    volumes:
      - ./config:/app/config
      - ./logs:/app/logs
    restart: unless-stopped
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
EOF

# Update BACKEND_URL with your Shopping List LXC IP
nano docker-compose.yml

# Start the scanner
docker compose up -d

# View logs
docker compose logs -f
```

### 5. Register Scanner Device

```bash
# The scanner will output a registration URL on first run
# Visit this URL in your browser to register the device
docker compose logs scanner
```

## Systemd Service Configuration

### Shopping List App Auto-Start

Create `/etc/systemd/system/shoppinglist.service`:

```ini
[Unit]
Description=Shopping List Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/shoppinglist
ExecStart=/usr/bin/docker compose -f docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f docker-compose.prod.yml down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
```

Enable the service:
```bash
systemctl daemon-reload
systemctl enable shoppinglist.service
systemctl start shoppinglist.service
systemctl status shoppinglist.service
```

### Barcode Scanner Auto-Start

Create `/etc/systemd/system/barcode-scanner.service` in LXC 101:

```ini
[Unit]
Description=Barcode Scanner Service
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/barcode-scanner
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=60

[Install]
WantedBy=multi-user.target
```

Enable the service:
```bash
systemctl daemon-reload
systemctl enable barcode-scanner.service
systemctl start barcode-scanner.service
systemctl status barcode-scanner.service
```

## Maintenance Commands

### Update Application

```bash
# Shopping List (in LXC 100)
cd /opt/shoppinglist
./deploy.sh

# Barcode Scanner (in LXC 101)
cd /opt/barcode-scanner
docker compose pull
docker compose up -d
```

### Backup Database

```bash
# In LXC 100
cd /opt/shoppinglist
./backup.sh
```

### View Logs

```bash
# Shopping List
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f shoppinglist

# Barcode Scanner
docker compose logs -f scanner
```

### Restart Services

```bash
# Shopping List
docker compose -f docker-compose.prod.yml restart

# Barcode Scanner
docker compose restart
```

## Troubleshooting

### Scanner Not Detected

```bash
# From Proxmox host
lsusb
ls -l /dev/ttyACM*

# Inside LXC 101
ls -l /dev/ttyACM*

# Check permissions
ls -l /dev/ttyACM0

# Add docker to dialout group if needed
usermod -aG dialout root
```

### Cannot Connect to Backend

```bash
# Test connectivity from scanner LXC
curl http://192.168.x.x:3000/api/health

# Check firewall
iptables -L -n

# Check Docker network
docker network ls
docker network inspect shoppinglist_shoppinglist-network
```

### Ollama Model Not Loading

```bash
# Check Ollama logs
docker logs shoppinglist-ollama

# Manually pull model
docker exec -it shoppinglist-ollama ollama pull llama3.2

# List downloaded models
docker exec -it shoppinglist-ollama ollama list
```

### Database Connection Issues

```bash
# Check PostgreSQL logs
docker logs shoppinglist-postgres

# Connect to database manually
docker exec -it shoppinglist-postgres psql -U postgres -d shoppinglist

# Check database tables
\dt
```

### USB Permission Denied

```bash
# Inside LXC, check device
ls -l /dev/ttyACM0

# Should show: crw-rw---- 1 root dialout 166, 0

# Restart container after config changes
pct stop 101 && pct start 101
```

### Out of Disk Space

```bash
# Check disk usage
df -h

# Clean Docker
docker system prune -a --volumes

# Remove old backups
ls -lth /opt/shoppinglist/backups/
rm /opt/shoppinglist/backups/old_backup_*.sql.gz
```

## Security Recommendations

1. **Change Default Passwords**: Ensure all passwords in `.env` are strong and unique
2. **Firewall**: Configure firewall rules to restrict access to port 3000
3. **Reverse Proxy**: Use Nginx Proxy Manager for SSL/HTTPS
4. **Regular Backups**: Schedule automatic backups with cron
5. **Updates**: Regularly update containers and host system
6. **API Keys**: Rotate API keys periodically

## Next Steps

- Configure reverse proxy for HTTPS access
- Set up automated backups with cron
- Monitor resource usage and adjust LXC allocation
- Deploy Raspberry Pi scanner (see RASPBERRY_PI_DEPLOYMENT.md)
