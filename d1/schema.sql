-- Schema for the Cloudflare D1 binding used by the Workers deployment.
-- Apply with: wrangler d1 execute shiori --remote --file=d1/schema.sql

create table if not exists progress (
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
);

create index if not exists progress_updated_at_idx on progress (token, updated_at desc);
