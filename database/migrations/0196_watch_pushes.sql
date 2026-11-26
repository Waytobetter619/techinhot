-- One push of a watch rule to one channel: how many items it carried and what the channel answered. status: sent
-- (acknowledged), failed (refused), unknown (no readable acknowledgement), skipped (WATCH_PUSH_ENABLED off, or the
-- channel not configured). A failed push is not retried: the next new item is the next alert.
CREATE TABLE IF NOT EXISTS watch_pushes (
  id          bigserial PRIMARY KEY,
  rule_id     bigint NOT NULL REFERENCES watch_rules (id) ON DELETE CASCADE,
  channel     text NOT NULL,
  items       integer NOT NULL,
  status      text NOT NULL CHECK (status IN ('sent', 'failed', 'unknown', 'skipped')),
  response    text,
  pushed_at   timestamptz NOT NULL DEFAULT now()
);
