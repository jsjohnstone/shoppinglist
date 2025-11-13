# Production Deployment Guide

Complete guide for deploying the Shopping List & Barcode Scanner application to production environments.

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Deployment Options](#deployment-options)
- [Quick Start](#quick-start)
- [Detailed Guides](#detailed-guides)
- [Post-Deployment](#post-deployment)
- [Maintenance](#maintenance)

## Overview

This application can be deployed in multiple configurations:

1. **Proxmox LXC** - Shopping List app with PostgreSQL and Ollama
2. **Proxmox LXC** - Barcode scanner (for testing)
3. **Raspberry Pi** - Barcode scanner with Flatcar Container Linux
4. **Standalone Docker** - Any Linux host with Docker

All images are published to GitHub Container Registry and support both AMD64 and ARM64 architectures.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  GitHub Repository                  │
│                                                     │
│  ┌──────────────┐         ┌──────────────────┐    │
│  │ shoppinglist │         │ shoppinglist-    │    │
│  │              │         │ barcodescanner   │    │
│  └──────┬───────┘         └────────┬─────────┘    │
│         │                          │               │
│         │ GitHub Actions           │ GitHub Actions│
│         ▼                          ▼               │
│  ghcr.io/jsjohnstone/      ghcr.io/jsjohnstone/   │
│  shoppinglist:latest       shoppinglist-          │
│                            barcodescanner:latest   │
└─────────────────────────────────────────────────────┘
                    │                    │
        ┌───────────┴────────┐          │
        │                    │          │
        ▼                    ▼          ▼
┌──────────────┐    ┌──────────────┐   ┌─────────────────┐
│ Proxmox LXC  │    │ Proxmox LXC  │   │  Raspberry Pi   │
│              │    │              │   │                 │
│ Shopping List│    │   Scanner    │   │    Scanner      │
│ + PostgreSQL │    │   (Test)     │   │  (Production)   │
│ + Ollama     │    │              │   │                 │
│              │    │              │   │ Flatcar Linux   │
│ Port: 3000   │    │ USB Device   │   │ USB Device      │
└──────────────┘    └──────────────┘   └─────────────────┘
```

## Prerequisites

### For All Deployments

- Docker and Docker Compose installed
- GitHub Personal Access Token with `read:packages` scope
- Network access to GitHub Container Registry

### For Proxmox

- Proxmox VE 8.x
- Debian 12 LXC template
- Sufficient resources (6GB RAM, 4 CPU cores for main app)

### For Raspberry Pi

- Raspberry Pi 4B (4GB RAM recommended)
- SD Card (16GB minimum)
- USB Barcode Scanner
- Network connectivity

### For Barcode Scanner

- Access-IS LSR116 or compatible USB barcode scanner
- Network access to Shopping List backend

## Deployment Options

### Option 1: Proxmox LXC (Recommended for Production)

**Best for:** Self-hosted production deployments

**Includes:**
- Shopping List application
- PostgreSQL database
- Ollama LLM service
- Automatic backups
- Systemd integration

📖 [Proxmox Deployment Guide](PROXMOX_DEPLOYMENT.md)

### Option 2: Raspberry Pi with Flatcar

**Best for:** Dedicated barcode scanner appliance

**Includes:**
- Flatcar Container Linux (immutable OS)
- Auto-updating container
- USB device support
- Systemd integration

📖 [Raspberry Pi Deployment Guide](barcode-scanner/RASPBERRY_PI_DEPLOYMENT.md)

### Option 3: Standard Docker Host

**Best for:** Testing or existing Docker infrastructure

**Requirements:**
- Any Linux host with Docker installed
- Docker Compose

See [Quick Start](#quick-start) below.

## Quick Start

### Deploy Shopping List App

```bash
# 1. Create deployment directory
mkdir -p ~/shoppinglist && cd ~/shoppinglist

# 2. Download production files
curl -o docker-compose.prod.yml https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/docker-compose.prod.yml
curl -o .env.production.example https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/.env.production.example
curl -o deploy.sh https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/deploy.sh
chmod +x deploy.sh

# 3. Configure environment
cp .env.production.example .env
nano .env  # Edit with your settings

# 4. Login to GitHub Container Registry
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u jsjohnstone --password-stdin

# 5. Deploy
./deploy.sh
```

### Deploy Barcode Scanner (Docker Host)

```bash
# 1. Create deployment directory
mkdir -p ~/barcode-scanner && cd ~/barcode-scanner

# 2. Download files
curl -o docker-compose.yml https://raw.githubusercontent.com/jsjohnstone/shoppinglist-barcodescanner/main/docker-compose.prod.yml
curl -o .env.example https://raw.githubusercontent.com/jsjohnstone/shoppinglist-barcodescanner/main/.env.example

# 3. Configure
cp .env.example .env
nano .env  # Set BACKEND_URL

# 4. Login to GitHub Container Registry
echo "YOUR_GITHUB_PAT" | docker login ghcr.io -u jsjohnstone --password-stdin

# 5. Deploy
docker compose up -d

# 6. View logs to get registration URL
docker compose logs -f
```

## Detailed Guides

### Shopping List Application

- [Proxmox LXC Deployment](PROXMOX_DEPLOYMENT.md) - Complete guide for Proxmox VE
- [Environment Configuration](.env.production.example) - All configuration options
- [Deployment Script](deploy.sh) - Automated deployment and updates
- [Backup Script](backup.sh) - Database backup automation

### Barcode Scanner

- [Raspberry Pi Flatcar Deployment](barcode-scanner/RASPBERRY_PI_DEPLOYMENT.md) - Complete Flatcar setup
- [Ignition Configuration](barcode-scanner/flatcar-config.yaml) - Flatcar OS configuration
- [Docker Compose](barcode-scanner/docker-compose.prod.yml) - Container configuration
- [Environment Variables](barcode-scanner/.env.example) - Scanner settings

## Post-Deployment

### 1. Access the Application

Find your container IP:
```bash
# From Proxmox host
pct exec 100 -- hostname -I

# From Docker host
docker inspect -f '{{range.NetworkSettings.Networks}}{{.IPAddress}}{{end}}' shoppinglist-app
```

Access at: `http://<ip-address>:3000`

### 2. Create First User

1. Open the application in your browser
2. Click "Register"
3. Create your account
4. Log in

### 3. Configure Ollama Model

The default model is `llama3.2`. To change:

```bash
# Edit environment
nano .env

# Change OLLAMA_MODEL
OLLAMA_MODEL=mistral

# Restart services
docker compose -f docker-compose.prod.yml restart
```

### 4. Register Barcode Scanner

1. Start the scanner container
2. Check logs for registration URL:
   ```bash
   docker logs barcode-scanner
   ```
3. Visit the URL in your browser
4. Enter a name for the scanner
5. Submit to complete registration

### 5. Create API Keys (Optional)

For external integrations:

```sql
-- Connect to database
docker exec -it shoppinglist-postgres psql -U postgres -d shoppinglist

-- Create API key
INSERT INTO api_keys (key, name) VALUES ('your-secret-key', 'Integration Name');
```

## Maintenance

### Update Shopping List App

```bash
cd /opt/shoppinglist
./deploy.sh
```

Or manually:
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Update Barcode Scanner

**Proxmox/Docker:**
```bash
cd /opt/barcode-scanner
docker compose pull
docker compose up -d
```

**Raspberry Pi:**
```bash
ssh core@<pi-ip>
sudo systemctl restart barcode-scanner.service
```

### Backup Database

```bash
cd /opt/shoppinglist
./backup.sh
```

Backups are stored in `./backups/` and automatically cleaned (keeps last 7).

### View Logs

**Shopping List:**
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Specific service
docker compose -f docker-compose.prod.yml logs -f shoppinglist
docker compose -f docker-compose.prod.yml logs -f postgres
docker compose -f docker-compose.prod.yml logs -f ollama
```

**Barcode Scanner:**
```bash
# Docker
docker logs barcode-scanner -f

# Raspberry Pi
ssh core@<pi-ip> journalctl -u barcode-scanner.service -f
```

### Restart Services

```bash
# Shopping List
docker compose -f docker-compose.prod.yml restart

# Barcode Scanner
docker compose restart scanner
```

### Health Checks

```bash
# Shopping List
curl http://localhost:3000/api/health

# Check database
docker exec shoppinglist-postgres pg_isready -U postgres

# Check Ollama
docker exec shoppinglist-ollama ollama list
```

## Troubleshooting

### Shopping List Won't Start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs

# Check database
docker logs shoppinglist-postgres

# Verify migrations
docker logs shoppinglist-app | grep migration
```

### Ollama Issues

```bash
# Check Ollama status
docker exec shoppinglist-ollama ollama list

# Manually pull model
docker exec shoppinglist-ollama ollama pull llama3.2

# Check Ollama logs
docker logs shoppinglist-ollama
```

### Scanner Not Connecting

```bash
# Check scanner logs
docker logs barcode-scanner

# Test backend connectivity
curl http://<backend-ip>:3000/api/health

# Verify device registration
docker exec barcode-scanner cat /app/config/device.json
```

### Database Issues

```bash
# Connect to database
docker exec -it shoppinglist-postgres psql -U postgres -d shoppinglist

# List tables
\dt

# Check data
SELECT * FROM users;
SELECT * FROM items WHERE completed = false;
```

### USB Device Not Found (Scanner)

```bash
# Check USB devices
lsusb

# Check device file
ls -l /dev/ttyACM*

# Restart container with device
docker compose restart scanner
```

## Security Considerations

### 1. Change Default Passwords

Edit `.env` and set strong passwords:
```bash
# Generate secure password
openssl rand -base64 32
```

### 2. Protect API Keys

- Store API keys securely in database
- Rotate keys regularly
- Use different keys for different integrations

### 3. Network Security

- Use firewall to restrict access to port 3000
- Consider using reverse proxy with SSL (Nginx Proxy Manager)
- Place scanner on separate VLAN if possible

### 4. Regular Updates

- Shopping List: Update when new releases are available
- Barcode Scanner: Configured for weekly auto-updates
- Proxmox/Host OS: Keep updated with security patches

### 5. Backup Strategy

- Database: Daily backups with `backup.sh`
- Configuration: Keep `.env` files backed up securely
- Docker volumes: Consider backing up volumes regularly

## Advanced Topics

### Reverse Proxy with SSL

Use Nginx Proxy Manager (recommended) or standard Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name shopping.yourdomain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        proxy_pass http://192.168.1.100:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Multiple Scanners

Deploy multiple scanner instances pointing to the same backend:

```bash
# Scanner 1 - Kitchen
docker run -d --name scanner-kitchen \
  --device=/dev/ttyACM0:/dev/ttyACM0 \
  -e BACKEND_URL=http://192.168.1.100:3000 \
  ghcr.io/jsjohnstone/shoppinglist-barcodescanner:latest

# Scanner 2 - Pantry
docker run -d --name scanner-pantry \
  --device=/dev/ttyACM1:/dev/ttyACM0 \
  -e BACKEND_URL=http://192.168.1.100:3000 \
  ghcr.io/jsjohnstone/shoppinglist-barcodescanner:latest
```

### Monitoring

Set up monitoring with Prometheus/Grafana:

```yaml
# Add to docker-compose.prod.yml
services:
  prometheus:
    image: prom/prometheus
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"
```

### High Availability

For production environments requiring HA:

1. Deploy PostgreSQL with replication
2. Use load balancer for multiple app instances
3. Shared Ollama instance or model caching
4. Regular backup testing

## Support and Resources

- **Documentation**: See individual deployment guides
- **Issues**: GitHub Issues for bug reports
- **Updates**: Watch GitHub repositories for releases
- **Community**: Share your deployment experiences

## License

This deployment documentation is part of the Shopping List project. See main repository for license information.
