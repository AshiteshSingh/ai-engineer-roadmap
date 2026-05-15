-- Cross-device audio playback position for logged-in knowledge readers.
-- Mirrors the localStorage `knowledge_last_played` shape from components/audio-player.tsx.
CREATE TABLE IF NOT EXISTS audio_progress (
  user_id       TEXT    NOT NULL,
  slug          TEXT    NOT NULL,
  current_time  REAL    NOT NULL,
  playback_rate REAL    NOT NULL DEFAULT 1.0,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, slug)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_audio_progress_user_updated
  ON audio_progress (user_id, updated_at DESC);
