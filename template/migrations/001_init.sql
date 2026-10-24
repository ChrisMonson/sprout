-- Migrations only ever add. Never drop, rename, or rewrite existing columns or rows.
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
