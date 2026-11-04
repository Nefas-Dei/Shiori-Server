/**
 * Local development / self-hosting entry point for Bun.
 *
 *   bun run src/local.ts            # ./shiori.db, port 8787
 *   SYNC_TOKENS=<token1>,<t2> bun run src/local.ts
 *
 * The server implements the same /api/v1 contract as the Cloudflare Workers
 * deployment, backed by bun:sqlite instead of D1.
 */

import { Database } from "bun:sqlite";
import { createApp } from "./index";
import { createSqlStorage } from "./sql-storage";
import type { ProgressStorage } from "./storage";

const file = process.env.SYNC_DB_FILE?.trim() || "./shiori.db";
const db = new Database(file, { create: true });
db.exec("pragma journal_mode = wal");

// Bound parameters are positional in both bun:sqlite and the shared SQL adapter.
const backend = {
    async all<T>(sql: string, values: unknown[]): Promise<T[]> {
        return db.prepare(sql).all(...(values as any[])) as T[];
    },
    async first<T>(sql: string, values: unknown[]): Promise<T | null> {
        return (db.prepare(sql).get(...(values as any[])) as T) ?? null;
    },
    async run(sql: string, values: unknown[]): Promise<void> {
        db.prepare(sql).run(...(values as any[]));
    },
};

const storage: ProgressStorage = createSqlStorage(backend);

const app = createApp(storage);

const port = Number(process.env.SYNC_PORT || process.env.PORT || 8787);
const host = process.env.SYNC_HOST || "0.0.0.0";

Bun.serve({
    port,
    hostname: host,
    fetch: app.fetch,
});

console.log(`Shiori sync server (bun:sqlite) listening on http://${host}:${port} — database: ${file}`);
const tokens = process.env.SYNC_TOKENS;
if (tokens) console.log(`Token allow-list enabled (${tokens.split(",").filter(Boolean).length} tokens).`);
else console.log("SYNC_TOKENS is not set - any token gets its own data bucket.");
