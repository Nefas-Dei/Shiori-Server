/**
 * End-to-end tests for the server contract, using the Bun runtime entry point
 * with an in-memory SQLite database. These cover the exact API surface that the
 * browser extension and the Android custom tracker consume.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../src/index";
import { createSqlStorage } from "../src/sql-storage";

let server: ReturnType<typeof Bun.serve>;
let base: string;

function prepareApp() {
    const db = new Database(":memory:");
    const backend = {
        async all<T>(sql: string, values: unknown[]): Promise<T[]> {
            return db.prepare(sql).all(...(values as never[])) as T[];
        },
        async first<T>(sql: string, values: unknown[]): Promise<T | null> {
            return (db.prepare(sql).get(...(values as never[])) as T) ?? null;
        },
        async run(sql: string, values: unknown[]): Promise<void> {
            db.prepare(sql).run(...(values as never[]));
        },
    };
    return createApp(createSqlStorage(backend));
}

const authed = (method: string, body?: unknown) => ({
    method,
    headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
});

function entry(overrides: Record<string, unknown> = {}) {
    return {
        site: "webnovel.example",
        series_key: "my-series",
        series_title: "My Series",
        series_url: "https://webnovel.example/series/my-series",
        chapter: 12,
        chapter_title: "Chapter 12",
        chapter_url: "https://webnovel.example/series/my-series/12",
        scroll_percent: 42.5,
        paragraph_index: 3,
        updated_at: 1000,
        device: "browser",
        ...overrides,
    };
}

beforeAll(async () => {
    server = Bun.serve({ port: 0, fetch: prepareApp().fetch });
    base = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

describe("health", () => {
    test("returns version without auth", async () => {
        const health = await (await fetch(`${base}/api/v1/health`)).json();
        expect(health.ok).toBe(true);
        expect(String(health.version)).toBeTruthy();
    });
});

describe("PUT /api/v1/progress", () => {
    test("requires bearer token", async () => {
        const res = await fetch(`${base}/api/v1/progress`, { method: "PUT", body: JSON.stringify(entry()) });
        expect(res.status).toBe(401);
    });

    test("validates required fields", async () => {
        const res = await fetch(base + "/api/v1/progress", authed("PUT", entry({ series_key: "  " })));
        expect(res.status).toBe(400);
    });

    test("stores entry and returns applied entry", async () => {
        const res = await fetch(base + "/api/v1/progress", authed("PUT", entry()));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.applied).toBe(true);
        expect(json.entry.id).toBeTruthy();
        expect(json.entry.scroll_percent).toBe(42.5);
    });

    test("rejects stale writes with 409 and the newer entry", async () => {
        const res = await fetch(base + "/api/v1/progress", authed("PUT", entry({ updated_at: 500 })));
        expect(res.status).toBe(409);
        const json = await res.json();
        expect(json.applied).toBe(false);
        // Server normalizes sub-1e12 values from seconds to milliseconds.
        expect(json.entry.updated_at).toBe(1_000_000);
    });

    test("accepts equal timestamp (Phone replay overwrites own write)", async () => {
        const res = await fetch(base + "/api/v1/progress", authed("PUT", entry({ updated_at: 1000, device: "android" })));
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.entry.device).toBe("android");
    });

    test("normalizes timestamp from seconds format and clamps percent", async () => {
        const res = await fetch(
            base + "/api/v1/progress",
            authed("PUT", entry({ updated_at: 2_000, scroll_percent: 187, paragraph_index: 99_999 })),
        );
        expect(res.status).toBe(200);
        const json = await res.json();
        expect(json.entry.scroll_percent).toBe(100);
        expect(json.entry.updated_at).toBe(2_000_000);
        expect(json.entry.paragraph_index).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
});

describe("GET /api/v1/progress", () => {
    test("requires bearer token", async () => {
        const res = await fetch(`${base}/api/v1/progress?limit=1`);
        expect(res.status).toBe(401);
    });

    test("lists newest first and filters by site and query", async () => {
        await fetch(
            base + "/api/v1/progress",
            authed("PUT", entry({ series_key: "other", updated_at: 3_000, scroll_percent: 10 })),
        );

        const all = await (await fetch(base + "/api/v1/progress?limit=10", authed("GET"))).json();
        expect(all.entries).toHaveLength(2);
        expect(all.entries[0].series_key).toBe("other");
        expect(all.entries[0].updated_at).toBe(3_000_000);

        const bySite = await (
            await fetch(`${base}/api/v1/progress?site=webnovel.example&q=my-series`, authed("GET"))
        ).json();
        expect(bySite.entries).toHaveLength(1);
        expect(bySite.entries[0].series_key).toBe("my-series");

        const missnamed = await (
            await fetch(`${base}/api/v1/progress?q=%25`, authed("GET"))
        ).json();
        expect(missnamed.entries).toHaveLength(0);
    });
});

describe("DELETE /api/v1/progress/:id", () => {
    test("removes and reports missing", async () => {
        const { entries } = await (await fetch(base + "/api/v1/progress?limit=1", authed("GET"))).json();
        const id = entries[0].id;
        const del = await fetch(`${base}/api/v1/progress/${id}`, authed("DELETE"));
        expect((await del.json()).applied).toBe(true);

        const repeat = await fetch(`${base}/api/v1/progress/${id}`, authed("DELETE"));
        expect(repeat.status).toBe(404);
    });
});

describe("token isolation", () => {
    test("different tokens see disjoint buckets", async () => {
        const res = await fetch(base + "/api/v1/progress", {
            method: "PUT",
            headers: { Authorization: "Bearer other-token", "Content-Type": "application/json" },
            body: JSON.stringify(entry({ series_key: "mine" })),
        });
        expect(res.status).toBe(200);

        const mine = await (await fetch(base + "/api/v1/progress?limit=10", authed("GET"))).json();
        expect(mine.entries.every((e: { series_key: string }) => e.series_key !== "mine")).toBe(true);
    });
});
