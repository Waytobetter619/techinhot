-- What a watch rule has already accounted for: the news it pushed, and what already matched when the rule was saved
-- (never pushed). key: the fact an item reports (f:<id>), so another outlet's copy of the same news is not a second
-- alert; an ungrouped item by itself (a:<article id>). Rows older than the rule's window are pruned by the run.
CREATE TABLE IF NOT EXISTS watch_seen (
  rule_id     bigint NOT NULL REFERENCES watch_rules (id) ON DELETE CASCADE,
  key         text NOT NULL,
  article_id  text NOT NULL,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule_id, key)
);
