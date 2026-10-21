-- TheOrder v1 schema (D1 / SQLite). Tables exactly as in SPEC.md.
-- Apply with:
--   npx wrangler d1 execute theorder --local  --file=schema.sql   (local dev)
--   npx wrangler d1 execute theorder --remote --file=schema.sql   (production)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- random UUID
  google_sub  TEXT UNIQUE NOT NULL,      -- Google's stable user ID
  email       TEXT,
  display_name TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- random token, also the cookie value
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  city        TEXT NOT NULL,
  cuisine     TEXT,
  external_id TEXT,                      -- Google Place ID later (v2)
  created_by  TEXT REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS top_orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  restaurant_id TEXT NOT NULL REFERENCES restaurants(id),
  title         TEXT NOT NULL DEFAULT 'My usual',   -- e.g. "My usual", "Date night order"
  items         TEXT NOT NULL,           -- JSON array of strings, one string per dish
  notes         TEXT,                    -- "Ask for the chili crisp on the side"
  is_public     INTEGER NOT NULL DEFAULT 1,  -- 1 = community can see it, 0 = just me
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, restaurant_id)       -- one top order per person per restaurant in v1
);
