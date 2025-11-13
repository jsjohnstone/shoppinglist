# Shopping List App

A Node.js-based shopping list application with LLM integration for smart item normalization and categorization.

## Features (Phase 1)

- ✅ User authentication (register/login)
- ✅ Add, edit, delete shopping list items
- ✅ Check off items as you shop
- ✅ Automatic item name normalization (brand → generic)
- ✅ Automatic category assignment via Ollama LLM
- ✅ "Related To" field for grouping items (e.g., for recipes)
- ✅ Auto-cleanup of completed items after 24 hours
- ✅ Responsive React frontend with shadcn/ui
- ✅ API endpoints for external integrations
- ✅ Docker deployment with PostgreSQL

## Tech Stack

**Backend:**
- Node.js + Express
- PostgreSQL + Drizzle ORM
- JWT authentication
- Ollama for LLM integration
- Node-cron for scheduled tasks

**Frontend:**
- React 18
- Vite
- shadcn/ui components
- TailwindCSS
- TanStack Query

## Prerequisites

- Docker (for containerized deployment)
- OR for local development:
  - Node.js 18+
  - PostgreSQL
  - Ollama (running locally or accessible via network)

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shoppinglist
JWT_SECRET=your-secret-key-change-in-production
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2
PORT=3000
NODE_ENV=development
```

## Local Development (with Hot Reload)

The easiest way to develop is using the development docker-compose setup which includes hot reloading:

```bash
# Start all services with hot reload
docker-compose -f docker-compose.dev.yml up

# Or run in background
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker-compose -f docker-compose.dev.yml logs -f

# Stop services
docker-compose -f docker-compose.dev.yml down
```

**What's included:**
- **Backend** with nodemon - auto-restarts on file changes
- **Frontend** with Vite HMR - instant updates in browser
- **PostgreSQL** - database
- **Ollama** - LLM service

**Access:**
- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000/api`
- PostgreSQL: `localhost:5432`
- Ollama: `http://localhost:11434`

**Making changes:**
- Edit files in `/backend` or `/frontend` directories
- Backend changes trigger automatic restart
- Frontend changes update instantly in browser (Hot Module Replacement)
- Database schema changes require running migrations

### Alternative: Local Development (without Docker)

If you prefer to run services locally:

### 1. Install dependencies

```bash
# Root (backend)
npm install

# Frontend
cd frontend
npm install
cd ..
```

### 2. Setup database

Make sure PostgreSQL is running, then:

```bash
# Generate Drizzle migrations
npx drizzle-kit generate:pg

# Run migrations
npm run migrate
```

### 3. Start Ollama

Ensure Ollama is running with your chosen model:

```bash
ollama pull llama3.2
ollama serve
```

### 4. Start development servers

```bash
# Terminal 1 - Backend
npm run dev

# Terminal 2 - Frontend
cd frontend
npm run dev
```

Frontend will be available at `http://localhost:5173`
Backend API at `http://localhost:3000/api`

## Docker Deployment (Recommended)

The easiest way to deploy is using docker-compose, which includes PostgreSQL, Ollama, and the application as separate services:

```bash
# Start all services (first run will pull the Ollama model - takes a few minutes)
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v
```

The app will be available at `http://localhost:3000`

**What's included:**
- PostgreSQL database (port 5432, data persisted in volume)
- Ollama LLM service (port 11434, models persisted in volume)
- Shopping list app (port 3000)

**First run:** The Ollama service will automatically download the llama3.2 model on first startup. This may take several minutes depending on your internet connection. You can check progress with `docker-compose logs ollama`.

### Customization

Edit `docker-compose.yml` to:
- Change the Ollama model (default: llama3.2)
- Change the JWT secret
- Adjust port mappings
- Modify resource limits

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user (requires auth)

### Items
- `GET /api/items` - Get all items
- `POST /api/items` - Add item (with LLM processing)
- `PUT /api/items/:id` - Update item
- `PATCH /api/items/:id/complete` - Toggle completion
- `DELETE /api/items/:id` - Delete item

### External API (requires API key)
- `POST /api/items/api-add` - Add item via API key

### Categories
- `GET /api/categories` - List categories
- `POST /api/categories` - Create category
- `PUT /api/categories/:id` - Update category
- `DELETE /api/categories/:id` - Delete category

## Creating API Keys

API keys for external integrations (barcode scanner, voice assistants) must be created directly in the database:

```sql
INSERT INTO api_keys (key, name) 
VALUES ('your-secret-api-key', 'Barcode Scanner');
```

Then use the key in external apps:

```bash
curl -X POST http://localhost:3000/api/items/api-add \
  -H "X-API-Key: your-secret-api-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "Milk", "quantity": "2L"}'
```

## Phase 2 & 3: Barcode Scanner ✅

The barcode scanner functionality has been completed and integrated:

- ✅ USB barcode scanner support (Access-IS LSR116)
- ✅ OpenFoodFacts integration for product data
- ✅ Automatic item addition via barcode scanning
- ✅ Device authentication and registration
- ✅ Raspberry Pi deployment support
- ✅ Multiple scanner support

See [PHASE3_IMPLEMENTATION.md](PHASE3_IMPLEMENTATION.md) for details.

## Production Deployment

The application is ready for production deployment with multi-architecture Docker images published to GitHub Container Registry.

### Deployment Options

1. **Proxmox LXC** - Full stack deployment (Shopping List + PostgreSQL + Ollama)
2. **Raspberry Pi** - Dedicated barcode scanner with Flatcar Container Linux
3. **Standard Docker** - Any Linux host with Docker

### Quick Deploy

```bash
# Shopping List Application
mkdir -p ~/shoppinglist && cd ~/shoppinglist
curl -o docker-compose.prod.yml https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/docker-compose.prod.yml
curl -o .env.production.example https://raw.githubusercontent.com/jsjohnstone/shoppinglist/main/.env.production.example
cp .env.production.example .env
# Edit .env with your settings
docker compose -f docker-compose.prod.yml up -d
```

### Docker Images

- **Shopping List**: `ghcr.io/jsjohnstone/shoppinglist:latest`
- **Barcode Scanner**: `ghcr.io/jsjohnstone/shoppinglist-barcodescanner:latest`

Both images support `linux/amd64` and `linux/arm64` architectures.

### Documentation

- 📖 [Complete Deployment Guide](DEPLOYMENT.md) - Overview of all deployment options
- 📖 [Proxmox Deployment](PROXMOX_DEPLOYMENT.md) - LXC container deployment
- 📖 [Raspberry Pi Deployment](barcode-scanner/RASPBERRY_PI_DEPLOYMENT.md) - Flatcar Container Linux setup
- 📖 [Development Guide](DEVELOPMENT.md) - Local development setup

### Features

**Production-Ready:**
- Multi-architecture Docker images (AMD64 + ARM64)
- GitHub Actions CI/CD pipeline
- Automated database migrations
- Health checks and monitoring
- Log rotation and management
- Backup and restore scripts
- Systemd integration
- Auto-updates (scanner)

**Security:**
- JWT authentication
- Device registration and authentication
- Secure API key management
- Environment-based configuration
- Regular security updates

## Architecture

```
GitHub Container Registry
├── shoppinglist:latest (Shopping List App)
└── shoppinglist-barcodescanner:latest (Scanner)
    │
    ├─→ Proxmox LXC (Debian 12)
    │   └── Docker Compose
    │       ├── PostgreSQL
    │       ├── Ollama
    │       └── Shopping List App
    │
    └─→ Raspberry Pi 4B (Flatcar OS)
        └── Barcode Scanner Container
```

## License

ISC
