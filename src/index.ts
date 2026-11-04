/**
 * Shiori sync server.
 *
 * Storage contract matching the browser extension (`shiori-extension`) and the
 * Android custom tracker (Shiori Sync):
 *
 *   GET    /api/v1/health                     -> { ok, version }
 *   PUT    /api/v1/progress                   -> { applied, entry } (409 = existing entry is newer)
 *   GET    /api/v1/progress?site=&q=&limit=   -> { entries }
 *   DELETE /api/v1/progress/:id               -> { applied }
 *
 * Auth: `Authorization: Bearer <token>`. Every token is its own data bucket so
 * the browser and the phone only need the same shared token.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { SERVER_VERSION, type EntryRow, type Env, type ProgressStorage } from "./storage";
import { createD1Storage } from "./d1-storage";

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 200;

export function createApp(store: ProgressStorage, allowedTokens: Set<string> | null = null) {
    const app = new Hono<{ Bindings: Env }>();

    app.use(
        "/api/*",
        cors({
            origin: (origin) => origin ?? "*",
            allowHeaders: ["authorization", "content-type", "accept"],
            allowMethods: ["GET", "PUT", "DELETE", "OPTIONS"],
        }),
    );

    const auth = async (c: any): Promise<string | null> => {
        const header = c.req.header("Authorization") || "";
        const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
        if (!token) return null;
        if (allowedTokens && !allowedTokens.has(token)) return null;
        return token;
    };

    function bodyFor(c: any, error: string, status = 400) {
        return c.json({ error: { message: error } }, status);
    }

    app.get("/api/v1/health", (c) =>
        c.json({ ok: true, version: String(SERVER_VERSION), description: "Shiori reading-progress sync server" }),
    );

    app.put("/api/v1/progress", async (c) => {
        const token = await auth(c);
        if (!token) return bodyFor(c, "Unauthorized", 401);

        let raw: any;
        try {
            raw = await c.req.json();
        } catch {
            return bodyFor(c, "Request body must be JSON");
        }
        if (!raw || typeof raw !== "object") return bodyFor(c, "Request body must be a JSON object");

        const site = typeof raw.site === "string" ? raw.site.trim() : "";
        const seriesKey = typeof raw.series_key === "string" ? raw.series_key.trim() : "";
        if (!site) return bodyFor(c, "'site' is required");
        if (!seriesKey) return bodyFor(c, "'series_key' is required");

        const updatedAt = Number(raw.updated_at);
        if (!Number.isFinite(updatedAt) || updatedAt <= 0) return bodyFor(c, "'updated_at' must be a timestamp");
        const updatedAtMs = updatedAt > 1e12 ? updatedAt : updatedAt * 1000;

        const id = await entryId(site, seriesKey);
        const incoming: EntryRow = {
            id,
            token,
            site,
            series_key: seriesKey,
            series_title: asString(raw.series_title),
            series_url: asString(raw.series_url),
            chapter: asNumber(raw.chapter, 0),
            chapter_title: asString(raw.chapter_title),
            chapter_url: asString(raw.chapter_url),
            scroll_percent: clampPercent(asNumber(raw.scroll_percent, 0)),
            paragraph_index: asInt(raw.paragraph_index, -1, -1, Number.MAX_SAFE_INTEGER),
            status: asString(raw.status, "reading"),
            updated_at: updatedAtMs,
            device: asString(raw.device, "unknown"),
        };

        const existing = await store.find(token, id);
        if (existing && existing.updated_at > incoming.updated_at) {
            return c.json({ applied: false, entry: publicEntry(existing) }, 409);
        }

        await store.put(incoming);
        return c.json({ applied: true, entry: publicEntry(incoming) });
    });

    app.get("/api/v1/progress", async (c) => {
        const token = await auth(c);
        if (!token) return bodyFor(c, "Unauthorized", 401);

        const site = asString(c.req.query("site"));
        const query = asString(c.req.query("q"));
        const limitRaw = Number(c.req.query("limit"));
        const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(limitRaw) ? Math.floor(limitRaw) : DEFAULT_LIMIT));
        const offsetRaw = Number(c.req.query("offset"));
        const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0);

        const entries = await store.list(token, { site, query, limit, offset });
        return c.json({ entries: entries.map(publicEntry) });
    });

    app.delete("/api/v1/progress/:id", async (c) => {
        const token = await auth(c);
        if (!token) return bodyFor(c, "Unauthorized", 401);

        const id = asString(c.req.param("id"));
        if (!id) return bodyFor(c, "Missing entry id");
        const removed = await store.remove(token, id);
        if (!removed) return c.json({ error: { message: "Entry not found" } }, 404);
        return c.json({ applied: true });
    });

    app.get("/", (c) =>
        c.json({
            ok: true,
            version: String(SERVER_VERSION),
            description: "Shiori reading-progress sync server. See /api/v1/health.",
        }),
    );

    return app;
}

async function entryId(site: string, seriesKey: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${site}\n${seriesKey}`));
    return base64url(digest);
}

function base64url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function asString(value: unknown, fallback = ""): string {
    if (value == null) return fallback;
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return fallback;
}

function asNumber(value: unknown, fallback: number): number {
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : fallback;
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
    const num = asNumber(value, fallback);
    return Math.min(max, Math.max(min, Math.round(num)));
}

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, Math.round(value * 100) / 100));
}

function publicEntry(row: EntryRow) {
    return {
        id: row.id,
        site: row.site,
        series_key: row.series_key,
        series_title: row.series_title,
        series_url: row.series_url,
        chapter: row.chapter,
        chapter_title: row.chapter_title,
        chapter_url: row.chapter_url,
        scroll_percent: row.scroll_percent,
        paragraph_index: row.paragraph_index,
        status: row.status,
        updated_at: row.updated_at,
        device: row.device,
    };
}

/**
 * Cloudflare Workers entry point.
 *
 * Deploy with:
 *   wrangler d1 create shiori            # put the id into wrangler.toml
 *   wrangler d1 execute shiori --remote --file=d1/schema.sql
 *   wrangler deploy
 */
export default {
    async fetch(request: Request, env: Env, ctx: unknown): Promise<Response> {
        if (!env.DB) {
            return Response.json(
                { error: { message: "D1 binding 'DB' is not configured in wrangler.toml" } },
                { status: 503 },
            );
        }
        const storage = createD1Storage(env.DB);
        const tokens = env.SYNC_TOKENS
            ? new Set(String(env.SYNC_TOKENS).split(",").map((t) => t.trim()).filter(Boolean))
            : null;
        const app = createApp(storage, tokens);
        return app.fetch(request);
    },
};
