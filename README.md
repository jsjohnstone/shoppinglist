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
AUTH_MODE=full
```

Tests run with `npm test`. The route tests are skipped unless `TEST_DATABASE_URL` points at a migrated, throwaway PostgreSQL database.

## Login modes

`AUTH_MODE` decides who has to log in. It is read when the server starts, so changing it only needs a restart.

| `AUTH_MODE` | Shopping list | Settings and administration |
|-------------|---------------|-----------------------------|
| `full` (default) | Login required | Login required |
| `admin` | Open to anyone who can reach the app | Login required |
| `none` | Open | Open |

`DISABLE_AUTH=true` is the older way to ask for `none` and still works when `AUTH_MODE` is not set. An unrecognised `AUTH_MODE` is treated as `full`.

With `AUTH_MODE=admin`:

- The app opens straight to the list. Without logging in, anyone who can reach it can view lists and categories, add, edit, tick off, un-tick, move, reorder and delete items, and create a category while adding an item. Changes show up live for everyone.
- The Settings button asks for a login. Settings, API keys, scanner/device approval, Home Assistant and LLM settings, creating, renaming and deleting lists, and editing categories all need one, and the server refuses those requests (`401`/`403`) without it.
- Creating an account needs a login too. The one exception is first-run setup: while no account exists, the Settings button offers to create the first one. Existing accounts keep working. There are no roles, so every account is an administrator. To add another account, call `POST /api/auth/register` with your login token:

  ```bash
  curl -X POST "http://localhost:3000/api/auth/register" \
    -H "Authorization: Bearer YOUR_LOGIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username": "someone", "password": "a-long-password"}'
  ```

- Items added without a login have no owner.

In `full` mode anyone who can reach the app can still register an account, as before. In every mode, API-key and scanner endpoints still need their key or device token.

Only use `admin` or `none` where the app is reachable solely by people you trust, for example on your home network or behind a proxy with its own login.

With the production compose file, set it in `.env` and restart:

```bash
echo "AUTH_MODE=admin" >> .env
docker compose -f docker-compose.prod.yml up -d
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
