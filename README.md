# Shopping List App

A self-hosted shopping list application - includes a beautifully simple UI and lots of smarts to make adding and managing items nice and easy.

![](./docs/screenshot.png)

## Features

- 📝 Add, edit, delete shopping list items
- 🔎 Automatic lookup of UPC/EAN barcodes via openfoodfacts.org
- 🤖 Automatic categorisation and standardisation via Ollama LLM
- 🗣️ API endpoints for external integrations (HomeAssistant Voice, anyone?)
- ⚙️ Docker deployment with PostgreSQL

## Tech Stack

- Node.js + Express + PostgreSQL backend
- React 18 + Vite frontend
- Integrates with Ollama (smart shopping list), HomeAssistant (announcements and Voice integration) and [other cool projects](https://www.github.com/jsjohnstone/shoppinglist-barcodescanner)

## Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/shoppinglist
JWT_SECRET=your-secret-key-change-in-production
PORT=3000
NODE_ENV=development
```

## Docker Deployment

The easiest way to deploy is using docker-compose, which includes PostgreSQL and the application as separate services:

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

## Barcode Scanner

There's a cool additional project [here](https://www.github.com/jsjohnstone/shoppinglist-barcodescanner) that you can deploy on a Raspberry PI or similar, plugin a USB scanner, and then scan items to have them automatically added to the shopping list. It's pretty rough, but it functions!

## API key storage

API keys are stored as SHA-256 hashes, never in readable form. The full key is shown once, when you create it in **Settings > API Keys**; after that the app can only show its last four characters. If a key is lost, delete it and create a new one.

Keys created before this change keep working. The first start after upgrading runs a migration (`drizzle/0011_hash_api_keys.sql`) that replaces each stored key with its hash. That step cannot be undone: the old keys cannot be read back from the database afterwards. Going back to an older image after the migration needs the database restored from a backup taken before the upgrade, because the older code expects the plaintext column.

Run the tests with `npm test`. The database tests are skipped unless `TEST_DATABASE_URL` points at a migrated, throwaway PostgreSQL database.

## License

ISC
