-- Outbound email audit log. Written best-effort by lib/email/cloudflare.ts
-- after every sendEmail() call (Cloudflare Email Sending). Non-blocking:
-- a failed insert never affects delivery.
CREATE TABLE IF NOT EXISTS email_sends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr       TEXT    NOT NULL,
  from_addr     TEXT    NOT NULL,
  subject       TEXT    NOT NULL,
  provider      TEXT    NOT NULL DEFAULT 'cloudflare',
  status        INTEGER,                 -- HTTP status from CF send
  cf_message_id TEXT,                    -- nullable; CF often returns empty 2xx
  error         TEXT,                    -- set when send threw
  sent_at       INTEGER NOT NULL         -- Date.now() ms
);

CREATE INDEX IF NOT EXISTS idx_email_sends_to_sent
  ON email_sends (to_addr, sent_at DESC);
