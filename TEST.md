# Testing Guide

## Quick Test with Docker (Recommended)

Since you don't have PostgreSQL installed locally, the easiest way to test is with Docker:

### 1. Build and start all services

```bash
# Build and start (downloads Ollama model on first run - takes a few minutes)
docker-compose up --build

# Or run in background
docker-compose up --build -d

# Watch logs
docker-compose logs -f
```

### 2. Access the application

Open your browser to: `http://localhost:3000`

### 3. Test the app

1. **Register** a new account (e.g., username: `test`, password: `test123`)
2. **Login** with your credentials
3. **Add an item** - Try entering a brand name like "Skippy Peanut Butter"
   - Watch how it gets normalized to just "Peanut Butter"
   - Notice the auto-assigned category
4. **Check off items** - Click the checkbox to mark items as completed
5. **Add related items** - Add items with a "Related To" field (e.g., "banana bread")
6. **Delete items** - Click the trash icon

### 4. Test the API

Create an API key for external apps:

```bash
# Connect to the database
docker-compose exec shoppinglist psql -U postgres -d shoppinglist

# Create an API key
INSERT INTO api_keys (key, name) VALUES ('test-api-key-123', 'Test Scanner');
\q
```

Test adding items via API:

```bash
curl -X POST http://localhost:3000/api/items/api-add \
  -H "X-API-Key: test-api-key-123" \
  -H "Content-Type: application/json" \
  -d '{"name": "Heinz Tomato Ketchup", "quantity": "500ml"}'
```

### 5. Verify LLM normalization

Check the logs to see the LLM processing:

```bash
docker-compose logs -f shoppinglist
```

You should see logs showing item normalization from brand names to generic names.

### 6. Clean up

```bash
# Stop services
docker-compose down

# Remove all data (start fresh)
docker-compose down -v
```

---

## Local Development Testing (Requires PostgreSQL + Ollama)

If you want to test without Docker, you need:

1. **PostgreSQL** installed and running
2. **Ollama** installed with llama3.2 model

### Setup

```bash
# Install PostgreSQL (macOS)
brew install postgresql@15
brew services start postgresql@15

# Install Ollama
brew install ollama
ollama serve &
ollama pull llama3.2

# Create database
createdb -U postgres shoppinglist

# Run migrations
npm run db:generate
npm run migrate
```

### Run backend

```bash
# Terminal 1
npm run dev
```

### Run frontend

```bash
# Terminal 2
cd frontend
npm run dev
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:3000`

---

## Troubleshooting

### Ollama model download is slow
The first time you run `docker-compose up`, Ollama will download the llama3.2 model (~2GB). This can take 5-10 minutes depending on your internet. Watch the logs:

```bash
docker-compose logs -f ollama
```

### App shows connection errors
Wait for all services to be ready. Check health:

```bash
docker-compose ps
```

