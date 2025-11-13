# Development Guide

## Quick Start (Hot Reload Development)

```bash
# Start development environment with hot reload
docker-compose -f docker-compose.dev.yml up

# Access the services:
# - Frontend: http://localhost:5173 (Vite HMR - instant updates)
# - Backend API: http://localhost:3000/api (Nodemon - auto-restart)
# - PostgreSQL: localhost:5432
# - Ollama: http://localhost:11434
```

## How Hot Reload Works

### Frontend (Vite HMR)
- Edit any file in `frontend/src/`
- Changes appear **instantly** in your browser
- No page refresh needed for most changes
- State is preserved during updates

### Backend (Nodemon)
- Edit any file in `backend/`
- Server **automatically restarts** (~1-2 seconds)
- Uses nodemon configuration in `nodemon.json`
- Watches `.js` and `.json` files

## Development Workflow

### 1. Start Development Environment

```bash
# First time setup or after pulling changes
docker-compose -f docker-compose.dev.yml up -d

# View logs (all services)
docker-compose -f docker-compose.dev.yml logs -f

# View specific service logs
docker-compose -f docker-compose.dev.yml logs -f backend
docker-compose -f docker-compose.dev.yml logs -f frontend
```

### 2. Make Code Changes

**Frontend changes:**
```bash
# Edit files in frontend/src/
# Browser updates instantly with HMR
# Check browser console for any errors
```

**Backend changes:**
```bash
# Edit files in backend/
# Server restarts automatically
# Check backend logs: docker-compose -f docker-compose.dev.yml logs -f backend
```

### 3. Database Schema Changes

```bash
# 1. Edit backend/db/schema.js
# 2. Generate migration
docker-compose -f docker-compose.dev.yml exec backend npm run db:generate

# 3. Apply migration
docker-compose -f docker-compose.dev.yml exec backend npm run migrate

# Or run locally if you have Node installed
npm run db:generate
npm run migrate
```

### 4. Install New Dependencies

**Backend:**
```bash
# Add to package.json
docker-compose -f docker-compose.dev.yml restart backend

# Or manually install
docker-compose -f docker-compose.dev.yml exec backend npm install package-name
```

**Frontend:**
```bash
# Add to frontend/package.json
docker-compose -f docker-compose.dev.yml restart frontend

# Or manually install
docker-compose -f docker-compose.dev.yml exec frontend npm install package-name
```

## Common Commands

```bash
# Start services
docker-compose -f docker-compose.dev.yml up

# Start in background
docker-compose -f docker-compose.dev.yml up -d

# Stop services
docker-compose -f docker-compose.dev.yml down

# Rebuild containers (after dependency changes)
docker-compose -f docker-compose.dev.yml up --build

# Reset everything (clean start)
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up

# Execute commands in containers
docker-compose -f docker-compose.dev.yml exec backend sh
docker-compose -f docker-compose.dev.yml exec frontend sh

# View real-time logs
docker-compose -f docker-compose.dev.yml logs -f

# Restart specific service
docker-compose -f docker-compose.dev.yml restart backend
docker-compose -f docker-compose.dev.yml restart frontend
```

## Debugging

### Backend Not Restarting?
1. Check backend logs: `docker-compose -f docker-compose.dev.yml logs backend`
2. Verify file is being watched (check `nodemon.json`)
3. Restart manually: `docker-compose -f docker-compose.dev.yml restart backend`

### Frontend Not Updating?
1. Hard refresh browser (Cmd/Ctrl + Shift + R)
2. Check frontend logs: `docker-compose -f docker-compose.dev.yml logs frontend`
3. Clear browser cache
4. Restart frontend: `docker-compose -f docker-compose.dev.yml restart frontend`

### Database Connection Issues?
1. Check PostgreSQL is running: `docker-compose -f docker-compose.dev.yml ps`
2. Wait for health check: `docker-compose -f docker-compose.dev.yml logs postgres`
3. Verify connection string in backend logs

### Ollama Not Working?
1. Check if model is downloaded: `docker-compose -f docker-compose.dev.yml logs ollama`
2. First run takes several minutes to download llama3.2 model
3. Verify accessibility: `curl http://localhost:11434/api/tags`

## Development vs Production

### Development (docker-compose.dev.yml)
- Hot reload enabled
- Source code mounted as volumes
- Separate frontend/backend containers
- Exposed ports for all services
- Development dependencies included
- Instant feedback on changes

### Production (docker-compose.yml)
- Optimized builds
- No source code volumes
- Single container with built frontend
- Only port 3000 exposed
- Production dependencies only
- Smaller image size

## Performance Tips

1. **Use named volumes for node_modules**
   - Faster than bind mounts
   - Already configured in docker-compose.dev.yml

2. **Exclude unnecessary files from watch**
   - Check `.dockerignore`
   - Check `nodemon.json` ignore patterns

3. **Restart only changed service**
   - Don't restart all services for small changes
   - Use: `docker-compose -f docker-compose.dev.yml restart backend`

4. **Monitor resource usage**
   - `docker stats` to check container resource usage
   - Ollama can be memory-intensive

## Switching Between Dev and Production

```bash
# Stop development
docker-compose -f docker-compose.dev.yml down

# Start production
docker-compose up -d

# Or vice versa
docker-compose down
docker-compose -f docker-compose.dev.yml up -d
```

## Tips & Tricks

1. **Quick test backend endpoint:**
   ```bash
   curl http://localhost:3000/api/categories
   ```

2. **Access database directly:**
   ```bash
   docker-compose -f docker-compose.dev.yml exec postgres psql -U postgres -d shoppinglist
   ```

3. **Test Ollama directly:**
   ```bash
   curl http://localhost:11434/api/generate -d '{
     "model": "llama3.2",
     "prompt": "Why is the sky blue?",
     "stream": false
   }'
   ```

4. **Watch backend restart in real-time:**
   ```bash
   docker-compose -f docker-compose.dev.yml logs -f backend | grep -i restart
