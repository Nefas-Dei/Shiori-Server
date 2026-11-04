/**
 * Storage interface shared between the Cloudflare D1 adapter and the local
 * Bun SQLite adapter.
 */

export const SERVER_VERSION = 1;

export interface EntryRow {
    id: string;
    token: string;
    site: string;
    series_key: string;
    series_title: string;
    series_url: string;
    chapter: number;
    chapter_title: string;
    chapter_url: string;
    scroll_percent: number;
    paragraph_index: number;
    status: string;
    updated_at: number;
    device: string;
}

export interface ListOptions {
    site?: string;
    query?: string;
    limit: number;
    offset: number;
}

export interface ProgressStorage {
    find(token: string, id: string): Promise<EntryRow | null>;
    put(row: EntryRow): Promise<void>;
    list(token: string, options: ListOptions): Promise<EntryRow[]>;
    remove(token: string, id: string): Promise<boolean>;
}

/** Environment bindings for Cloudflare Workers. */
export interface Env {
    DB?: D1Database;
    /** Comma-separated allow-list of tokens. Unset = any token gets its own bucket. */
    SYNC_TOKENS?: string;
}

export interface D1Database {
    prepare(sql: string): D1PreparedStatement;
}

export interface D1PreparedStatement {
    bind(...values: unknown[]): D1PreparedStatement;
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
    run(): Promise<unknown>;
}
