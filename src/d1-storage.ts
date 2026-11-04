/**
 * Cloudflare D1 storage adapter. SQL is shared with the Bun adapter so the two
 * cannot drift apart.
 */

import { createSqlStorage } from "./sql-storage";
import type { D1Database, ProgressStorage } from "./storage";

export function createD1Storage(db: D1Database): ProgressStorage {
    return createSqlStorage({
        async all<T>(sql: string, values: unknown[]): Promise<T[]> {
            const { results } = await db.prepare(sql).bind(...values).all<T>();
            return results ?? [];
        },
        async first<T>(sql: string, values: unknown[]): Promise<T | null> {
            return await db.prepare(sql).bind(...values).first<T>();
        },
        async run(sql: string, values: unknown[]): Promise<void> {
            await db.prepare(sql).bind(...values).run();
        },
    });
}
