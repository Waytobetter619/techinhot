// Watch rules at work (docs/subscriptions.md): every few minutes for the rules that alert at once, each morning for
// the daily digests. A rule pushes what its subscription filter lets through and it has not yet accounted for; when
// it is saved, what already matches is accounted for without a push, so only news from then on alerts.
import { SITE } from "@techinhot/site";
import { beijingStamp } from "@techinhot/contracts/time";
import { sql } from "../db.ts";
import { itemUrl } from "../publication/links.ts";
import { checkTopics, watchItems, WatchFilterSchema, WATCH_WINDOW_DAYS, type WatchFilter, type WatchItem } from "../publication/watch.ts";
import { CHANNEL_NAMES, pushAlert, type Alert, type WatchChannel } from "./push.ts";

export type WatchMode = "instant" | "daily";

/** The most items one rule reads per run, and lists in one alert. */
const READ = 100;
const LISTED: Record<WatchMode, number> = { instant: 10, daily: 20 };

interface RuleRow {
  id: number;
  name: string;
  filter: unknown;
  channels: WatchChannel[];
  mode: WatchMode;
}

/** Another outlet's copy of the same news is the same alert. */
export const seenKey = (item: Pick<WatchItem, "id" | "fact_id">) => (item.fact_id ? `f:${item.fact_id}` : `a:${item.id}`);

/** A stored filter, or null once it no longer reads (a topic since removed from industry/topics.json). */
function storedFilter(raw: unknown): WatchFilter | null {
  const parsed = WatchFilterSchema.safeParse(raw);
  if (!parsed.success) return null;
  try {
    return checkTopics(parsed.data);
  } catch {
    return null;
  }
}

/** The newest item per key, newest first. */
function byKey(items: WatchItem[]): Map<string, WatchItem> {
  const keyed = new Map<string, WatchItem>();
  for (const item of items) if (!keyed.has(seenKey(item))) keyed.set(seenKey(item), item);
  return keyed;
}

/**
 * Claims the keys no run has accounted for yet; only the run whose insert wrote a key pushes it, so two
 * overlapping runs never alert twice.
 */
async function claim(ruleId: number, items: Map<string, WatchItem>): Promise<string[]> {
  if (!items.size) return [];
  const rows = [...items].map(([key, item]) => ({ rule_id: ruleId, key, article_id: item.id }));
  const claimed = await sql<{ key: string }[]>`
    INSERT INTO watch_seen ${sql(rows, "rule_id", "key", "article_id")}
    ON CONFLICT (rule_id, key) DO NOTHING RETURNING key`;
  return claimed.map((r) => r.key);
}

/** What matches now is accounted for without a push: a new or changed rule alerts only for news from now on. */
export async function primeRule(ruleId: number, filter: WatchFilter, now = new Date()): Promise<number> {
  return (await claim(ruleId, byKey(await watchItems(filter, { now, limit: READ })))).length;
}

export function alertFor(name: string, mode: WatchMode, items: WatchItem[]): Alert {
  const listed = items.slice(0, LISTED[mode]);
  return {
    title: mode === "daily" ? `${SITE.name} 每日关注「${name}」：${items.length} 条` : `${SITE.name} 关注「${name}」：${items.length} 条新动态`,
    lines: listed.map((i) => ({ title: i.title, url: itemUrl(i.id), meta: `${i.source_name}${i.published_at ? ` · ${beijingStamp(i.published_at)}` : ""}` })),
    more: items.length - listed.length,
  };
}

async function send(rule: Pick<RuleRow, "id" | "channels">, alert: Alert, count: number) {
  for (const channel of rule.channels) {
    const result = await pushAlert(channel, alert);
    await sql`INSERT INTO watch_pushes (rule_id, channel, items, status, response)
      VALUES (${rule.id}, ${channel}, ${count}, ${result.status}, ${result.response.slice(0, 500)})`;
  }
}

/** One pass over the enabled rules of one mode. */
export async function runWatchRules(mode: WatchMode, now = new Date()): Promise<{ rules: number; alerts: number; items: number }> {
  const rules = await sql<RuleRow[]>`SELECT id, name, filter, channels, mode FROM watch_rules WHERE enabled AND mode = ${mode} ORDER BY id`;
  let alerts = 0;
  let total = 0;
  for (const rule of rules) {
    const filter = storedFilter(rule.filter);
    await sql`UPDATE watch_rules SET checked_at = now() WHERE id = ${rule.id}`;
    if (!filter) continue;
    const keyed = byKey(await watchItems(filter, { now, limit: READ }));
    const claimed = new Set(await claim(rule.id, keyed));
    const fresh = [...keyed].filter(([key]) => claimed.has(key)).map(([, item]) => item);
    if (!fresh.length) continue;
    await send(rule, alertFor(rule.name, mode, fresh), fresh.length);
    alerts += 1;
    total += fresh.length;
  }
  // A key older than the window cannot match again.
  await sql`DELETE FROM watch_seen WHERE seen_at < ${now}::timestamptz - make_interval(days => ${WATCH_WINDOW_DAYS * 2})`;
  return { rules: rules.length, alerts, items: total };
}

/** The admin's “发一条测试”: the newest matches, pushed now whether or not they were accounted for. */
export async function testWatchRule(ruleId: number): Promise<{ items: number; results: Array<{ channel: string; status: string }> } | null> {
  const [rule] = await sql<RuleRow[]>`SELECT id, name, filter, channels, mode FROM watch_rules WHERE id = ${ruleId}`;
  if (!rule) return null;
  const filter = storedFilter(rule.filter);
  if (!filter) throw new Error("这条规则的条件已失效（主题可能已被删除），请重新编辑");
  const items = [...byKey(await watchItems(filter, { limit: 3 })).values()];
  const alert = alertFor(`${rule.name}（测试）`, "instant", items);
  const results: Array<{ channel: string; status: string }> = [];
  for (const channel of rule.channels) {
    const result = await pushAlert(channel, items.length ? alert : { ...alert, lines: [], more: 0, title: `${alert.title}：近 7 天没有符合条件的内容` });
    await sql`INSERT INTO watch_pushes (rule_id, channel, items, status, response) VALUES (${rule.id}, ${channel}, ${items.length}, ${result.status}, ${result.response.slice(0, 500)})`;
    results.push({ channel: CHANNEL_NAMES[channel], status: result.status });
  }
  return { items: items.length, results };
}
