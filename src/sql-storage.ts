/**
 * SQL storage adapter. The SQL is shared with the D1 adapter so the two cannot
 * drift apart. The `create table` is issued lazily so a fresh local database
 * works without a separate migration step.
 */

import type { EntryRow, ListOptions, ProgressStorage } from "./storage";

export interface StorageBackend {
    all<T>(sql: string, values: unknown[]): Promise<T[]>;
    first<T>(sql: string, values: unknown[]): Promise<T | null>;
    run(sql: string, values: unknown[]): Promise<void>;
}

export function createSqlStorage(backend: StorageBackend): ProgressStorage {
    let ready: Promise<void> | null = null;

    const ensureSchema = () =>
        (ready ??= backend.run(
            `create table if not exists progress (
                id text not null,
                token text not null,
                site text not null,
                series_key text not null,
                series_title text not null default '',
                series_url text not null default '',
                chapter real not null default 0,
                chapter_title text not null default '',
                chapter_url text not null default '',
                scroll_percent real not null default 0,
                paragraph_index integer not null default -1,
                status text not null default 'reading',
                updated_at integer not null default 0,
                device text not null default 'unknown',
                primary key (token, id)
            )`,
            [],
        ));

    return {
        async find(token, id) {
            await ensureSchema();
            return (await backend.first<EntryRow>(
                "select * from progress where token = ? and id = ?",
                [token, id],
            )) || null;
        },

        async put(row: EntryRow) {
            await ensureSchema();
            await backend.run(
                `insert or replace into progress
                    (id, token, site, series_key, series_title, series_url, chapter,
                     chapter_title, chapter_url, scroll_percent, paragraph_index, status,
                     updated_at, device)
                values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    row.id, row.token, row.site, row.series_key, row.series_title, row.series_url,
                    row.chapter, row.chapter_title, row.chapter_url, row.scroll_percent,
                    row.paragraph_index, row.status, row.updated_at, row.device,
                ],
            );
        },

        async list(token, options: ListOptions) {
            await ensureSchema();
            const clauses = ["token = ?"];
            const values: unknown[] = [token];
            if (options.site) {
                clauses.push("site = ?");
                values.push(options.site);
            }
            if (options.query) {
                clauses.push("(series_key like ? escape '\\' or series_title like ? escape '\\')");
                const pattern = `%${escapeLike(options.query)}%`;
                values.push(pattern, pattern);
            }
            values.push(options.limit, options.offset);
            return await backend.all<EntryRow>(
                `select * from progress
                 where ${clauses.join(" and ")}
                 order by updated_at desc
                 limit ? offset ?`,
                values,
            );
        },

        async remove(token, id) {
            await ensureSchema();
            const existing = await backend.first<{ id: string }>(
                "select id from progress where token = ? and id = ?",
                [token, id],
            );
            if (!existing) return false;
            await backend.run("delete from progress where token = ? and id = ?", [token, id]);
            return true;
        },
    };
}

function escapeLike(value: string): string {
    return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
