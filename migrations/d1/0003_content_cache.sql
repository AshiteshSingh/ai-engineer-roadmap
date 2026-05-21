-- Dynamic content cache for the knowledge app: lesson bodies, audio guides, and
-- the content index, each stored as the exact JSON the app already consumes
-- (LessonFull / AudioMeta / ContentIndex). Written by the Rust `sync-d1`
-- pipeline; read at request time so new/edited content shows on refresh without
-- redeploying the app. Mirrors the repo's prep_cache(slug, kind, payload) shape.
CREATE TABLE IF NOT EXISTS content_cache (
  kind       TEXT NOT NULL,            -- 'lesson' | 'audio' | 'index'
  slug       TEXT NOT NULL,            -- lesson/audio slug; '__index__' for the index
  payload    TEXT NOT NULL,            -- JSON document, verbatim
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (kind, slug)
) WITHOUT ROWID;
