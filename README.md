# Shiori Sync Server

Minimal reading-progress sync server shared by the Shiori Android app (custom
tracker) and the [Shiori browser extension](../shiori-extension/). Stores one
entry per `(site, series_key)` per token and resolves concurrent writes with
last-write-wins on `updated_at`.

## API

Base path: `/api/v1`. All endpoints (except health and `/`) require
`Authorization: Bearer <token>`.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/v1/health` | No auth. `{ ok, version }` |
| `PUT` | `/api/v1/progress` | Upsert an entry. Returns `{ applied, entry }`, or `409` with the newer entry if a stored entry has a greater `updated_at`. |
| `GET` | `/api/v1/progress?site=&q=&limit=&offset=` | List entries, newest first. `q` matches `series_key` and `series_title` (substring). |
| `DELETE` | `/api/v1/progress/:id` | Remove an entry. `404` when missing. |

Entry shape (both request and response):

```json
{
  "site": "webnovel.example",
  "series_key": "my-series",
  "series_title": "My Series",
  "series_url": "https://…",
  "chapter": 12,
  "chapter_title": "Chapter 12",
  "chapter_url": "https://…",
  "scroll_percent": 42.5,
  "paragraph_index": 3,
  "status": "reading",
  "updated_at": 1700000000000,
  "device": "browser"
}
```

Tokens are data buckets: entries written with token A are invisible to token B.
If `SYNC_TOKENS` is set, it acts as an allow-list (unauthorized tokens get
`401`); otherwise any token gets its own bucket.

## Run locally (Bun + SQLite)

```sh
bun install
bun run dev              # ./shiori.db, port 8787
SYNC_TOKENS=my-secret SYNC_PORT=9000 bun run dev
```

## Deploy to Cloudflare Workers (D1)

```sh
bun install
npx wrangler d1 create shiori       # paste the id into wrangler.toml
npx wrangler d1 execute shiori --remote --file=d1/schema.sql
npx wrangler deploy
wrangler secret put SYNC_TOKENS     # recommended in production
```

## Tests

```sh
bun test
```
