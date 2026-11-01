-- Run once:  npx wrangler d1 execute studyhub --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS subs (
    endpoint TEXT PRIMARY KEY,
    uid TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS subs_uid ON subs (uid);

CREATE TABLE IF NOT EXISTS reminders (
    uid TEXT NOT NULL,
    id TEXT NOT NULL,
    at INTEGER NOT NULL,
    title TEXT,
    body TEXT,
    url TEXT,
    tag TEXT,
    PRIMARY KEY (uid, id)
);
CREATE INDEX IF NOT EXISTS reminders_at ON reminders (at);

CREATE TABLE IF NOT EXISTS gtokens (
    uid TEXT PRIMARY KEY,
    refresh TEXT NOT NULL,
    updated INTEGER
);

CREATE TABLE IF NOT EXISTS limits (
    k TEXT PRIMARY KEY,
    at INTEGER NOT NULL
);
