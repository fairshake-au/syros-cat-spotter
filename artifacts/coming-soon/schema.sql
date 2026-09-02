-- One row per address. The unique index makes a repeat sign-up a no-op
-- rather than a duplicate, so refreshing the page can't inflate the list.
CREATE TABLE IF NOT EXISTS signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS signups_email_idx ON signups (email);
