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

## License

ISC
