-- One row per address. The unique index makes a repeat sign-up a no-op
-- rather than a duplicate, so refreshing the page can't inflate the list.
CREATE TABLE IF NOT EXISTS signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  lang       TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS signups_email_idx ON signups (email);

-- Shared settings, read by the public site and written by the workspace.
-- gate_password is held in the clear on purpose: the workspace has to be able
-- to show it to whoever is about to pass it on.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Which documents are behind the password. A missing row means locked, so a
-- new document is never public by accident.
CREATE TABLE IF NOT EXISTS doc_state (
  slug       TEXT PRIMARY KEY,
  locked     INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Who can sign in to admin.catspotters.com.
CREATE TABLE IF NOT EXISTS admins (
  email      TEXT PRIMARY KEY,
  name       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Outstanding magic links. Single use: consumed on first visit.
CREATE TABLE IF NOT EXISTS signin_tokens (
  token      TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    TEXT
);
