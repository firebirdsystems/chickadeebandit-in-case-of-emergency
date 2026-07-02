-- In Case of Emergency — schema
-- All tables are prefixed app_in_case_of_emergency__ per the hub DDL guard.
-- IDs are TEXT (crypto.randomUUID() client-side); there is no household_id
-- column (each household has its own database file).

-- Key/value settings, written only through /api/admin-config (app_config policy).
--   access_mode     : 'all_adults' | 'group'
--   access_group_id : hub group id designated as the privileged group (group mode)
CREATE TABLE IF NOT EXISTS app_in_case_of_emergency__settings (
  key   TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (key)
);

-- The binder entries. title / details / location_hint are free text and are
-- encrypted at rest by the hub. category and visibility are kept plaintext so
-- they can be filtered/ordered and (for visibility) matched by the row policy.
CREATE TABLE IF NOT EXISTS app_in_case_of_emergency__entries (
  id            TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other',
  title         TEXT NOT NULL,
  details       TEXT NOT NULL DEFAULT '',
  location_hint TEXT NOT NULL DEFAULT '',
  visibility    TEXT NOT NULL DEFAULT 'adults',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_by    TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS entries_category_idx
  ON app_in_case_of_emergency__entries (category, sort_order, created_at);

CREATE INDEX IF NOT EXISTS entries_visibility_idx
  ON app_in_case_of_emergency__entries (visibility);
