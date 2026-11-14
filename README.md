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

## API for external integrations

External apps (a Home Assistant voice agent, a display, a script) can manage the list with an API key instead of a user login. Create a key in **Settings > API Keys** and send it as either header:

```
Authorization: Bearer YOUR_API_KEY
X-API-Key: YOUR_API_KEY
```

A missing key returns `401 {"error": "API key required"}`, an unknown key `403 {"error": "Invalid API key"}`. API keys have no scopes: any key can use every endpoint below, across all lists. Changes made through these endpoints show up live in the web UI.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/items/api-list` | Read the list |
| `POST` | `/api/items/api-add` | Add an item |
| `POST` | `/api/items/api-complete` | Tick an item off, or un-tick it, by id or name |
| `POST` | `/api/items/api-remove` | Remove an item, by id or name |

Items are returned as:

```json
{
  "id": 12,
  "name": "Milk",
  "quantity": "2",
  "notes": "semi skimmed",
  "relatedTo": null,
  "categoryId": 3,
  "categoryName": "Dairy",
  "isCompleted": false,
  "isProcessing": false,
  "completedAt": null,
  "listId": 1,
  "listName": "Groceries",
  "createdAt": "2026-01-01T10:00:00.000Z",
  "updatedAt": "2026-01-01T10:00:00.000Z"
}
```

### Read the list

`GET /api/items/api-list?status=active&listId=1`

- `status` (optional): `active` (default, items not yet ticked off), `completed`, or `all`
- `listId` (optional): only items on that list; default is every list

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  "http://localhost:3000/api/items/api-list"
```

```json
{ "status": "active", "count": 1, "items": [ { "id": 12, "name": "Milk", "...": "..." } ] }
```

### Add an item

`POST /api/items/api-add` with body `{ "name": "...", "quantity"?, "notes"?, "relatedTo"?, "category"?, "skipLlm"?, "listId"? }`. Only `name` is required; `listId` defaults to `1`. Returns `201` with the new item. Unless `skipLlm` is `true`, the name is tidied up by the LLM in the background (when enabled in Settings), so the stored name may change shortly after.

```bash
curl -X POST "http://localhost:3000/api/items/api-add" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "milk", "skipLlm": false}'
```

### Tick off / un-tick an item

`POST /api/items/api-complete` with body `{ "id"?, "name"?, "completed"?, "listId"? }`

- Give either `id` or `name` (`id` wins if both are sent)
- `completed` (optional boolean, default `true`): `true` ticks the item off, `false` un-ticks it
- `listId` (optional): limit a name lookup to one list

```bash
# Tick off by name
curl -X POST "http://localhost:3000/api/items/api-complete" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "milk"}'

# Un-tick by id
curl -X POST "http://localhost:3000/api/items/api-complete" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"id": 12, "completed": false}'
```

### Remove an item

`POST /api/items/api-remove` with body `{ "id"?, "name"?, "listId"? }`

```bash
curl -X POST "http://localhost:3000/api/items/api-remove" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "bread"}'
```

### Results and name matching

`api-complete` and `api-remove` always answer with a `result` field:

| HTTP | `result` | Body |
|------|----------|------|
| `200` | `matched` | `{ "result": "matched", "matchType": "exact", "item": { ... } }` - the item that was changed (for a removal, the item as it was) |
| `404` | `not_found` | `{ "error": "No open item matching \"caviar\"", "result": "not_found", "query": "caviar" }` |
| `409` | `ambiguous` | `{ "error": "Multiple items match \"milk\"", "result": "ambiguous", "query": "milk", "matchType": "partial", "candidates": [ { "id": 13, "name": "Oat milk", ... }, { "id": 14, "name": "Semi skimmed milk", ... } ] }` |
| `400` | - | `{ "error": "..." }` for a missing `id`/`name` or an invalid `id`, `listId` or `completed` |

Nothing is changed for `not_found` or `ambiguous`; ask the user which candidate they meant and retry with a fuller name or the candidate's `id`.

A `name` is matched against open items (when un-ticking with `"completed": false`, against completed items instead). Matching ignores case and punctuation and tries these steps in order, stopping at the first step with any hit (`matchType` says which one decided):

1. `exact` - the same name
2. `plural` - the same name ignoring singular/plural ("egg" matches "Eggs")
3. `partial` - every word you said is in the item name, or the other way round ("milk" matches "Semi skimmed milk")
4. `fuzzy` - a small typo ("brocoli" matches "Broccoli"); names shorter than five letters never fuzzy-match

One hit is `matched`; more than one hit at the same step is `ambiguous`. With `id`, `matchType` is `id` and the item is used whatever its completed state.

### Tests

```bash
npm test
```

The name matching tests need nothing else. The route tests are skipped unless `TEST_DATABASE_URL` points at a migrated, throwaway PostgreSQL database.

## Barcode Scanner

There's a cool additional project [here](https://www.github.com/jsjohnstone/shoppinglist-barcodescanner) that you can deploy on a Raspberry PI or similar, plugin a USB scanner, and then scan items to have them automatically added to the shopping list. It's pretty rough, but it functions!

## License

ISC
