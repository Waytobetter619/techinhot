-- The owner's watch rules (watch/rules.ts, docs/subscriptions.md): a subscription filter (publication/watch.ts) pushed to
-- the owner's own channels, at once or as one daily digest. channels: feishu, wecom (企业微信群机器人), serverchan (Server酱).
-- checked_at: the last run that read the rule, so the page can show it is alive.
CREATE TABLE IF NOT EXISTS watch_rules (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  filter      jsonb NOT NULL,
  channels    text[] NOT NULL CHECK (channels <@ ARRAY['feishu', 'wecom', 'serverchan']::text[]),
  mode        text NOT NULL DEFAULT 'instant' CHECK (mode IN ('instant', 'daily')),
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  checked_at  timestamptz
);
