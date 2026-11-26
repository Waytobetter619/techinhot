// The owner's watch rules in the back office (docs/subscriptions.md). Every change is audited; a new or changed
// filter is primed (run.ts primeRule), so saving a rule never pushes the past week at once.
import { z } from "zod";
import type { AdminWatchOverview, AdminWatchPreview, AdminWatchRule, BeforeJson } from "@techinhot/contracts/admin";
import { feedCategoryLabel, PUBLIC_API_CATEGORY_KEYS } from "@techinhot/contracts/taxonomy";
import { audit } from "../audit.ts";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { itemUrl, siteUrl } from "../publication/links.ts";
import { TOPIC_GROUPS, TOPICS } from "../publication/topics.ts";
import { checkTopics, watchItems, watchQueryString, WatchFilterSchema, WatchFilterError, type WatchFilter } from "../publication/watch.ts";
import { CHANNEL_NAMES, channelConfigured, WATCH_CHANNELS } from "./push.ts";
import { primeRule } from "./run.ts";

export const WatchRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  filter: WatchFilterSchema,
  channels: z.array(z.enum(WATCH_CHANNELS)).min(1).max(WATCH_CHANNELS.length),
  mode: z.enum(["instant", "daily"]).default("instant"),
  enabled: z.boolean().default(true),
});

/** A filter an admin can save: known topics, and something to narrow by (an empty filter would be the whole site). */
function savable(filter: WatchFilter): WatchFilter {
  checkTopics(filter);
  if (!filter.topics.length && !filter.categories.length && !filter.sources.length && !filter.q) {
    throw new WatchFilterError("至少选一个主题、分类、信源或填一个关键词");
  }
  return filter;
}

function parseInput(body: unknown) {
  const parsed = WatchRuleInputSchema.safeParse(body);
  if (!parsed.success) throw new WatchFilterError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return { ...parsed.data, channels: [...new Set(parsed.data.channels)], filter: savable(parsed.data.filter) };
}

export const watchFeedUrl = (filter: WatchFilter) => siteUrl(`/feed/watch.xml?${watchQueryString(filter)}`);

export async function watchOverview(): Promise<BeforeJson<AdminWatchOverview>> {
  const rows = await sql`
    SELECT r.id, r.name, r.filter, r.channels, r.mode, r.enabled, r.created_at, r.updated_at, r.checked_at,
      (SELECT count(*)::int FROM watch_pushes p WHERE p.rule_id = r.id AND p.status = 'sent' AND p.pushed_at > now() - interval '7 days') AS pushes7d,
      (SELECT jsonb_build_object('channel', p.channel, 'items', p.items, 'status', p.status, 'response', p.response, 'pushed_at', p.pushed_at)
         FROM watch_pushes p WHERE p.rule_id = r.id ORDER BY p.pushed_at DESC, p.id DESC LIMIT 1) AS last_push
    FROM watch_rules r ORDER BY r.created_at DESC, r.id DESC`;
  const rules: BeforeJson<AdminWatchRule>[] = rows.map((r) => {
    const filter = WatchFilterSchema.parse(r.filter);
    return {
      id: Number(r.id), name: r.name, filter, channels: r.channels, mode: r.mode, enabled: r.enabled,
      created_at: r.created_at, updated_at: r.updated_at, checked_at: r.checked_at,
      feedUrl: watchFeedUrl(filter), pushes7d: r.pushes7d, lastPush: r.last_push,
    };
  });
  return {
    rules,
    pushEnabled: config.watchPushEnabled,
    channels: WATCH_CHANNELS.map((key) => ({ key, name: CHANNEL_NAMES[key], configured: channelConfigured(key) })),
    topics: TOPICS.map(({ slug, name, group }) => ({ slug, name, group })),
    groups: TOPIC_GROUPS.map(({ key, name }) => ({ key, name })),
    categories: PUBLIC_API_CATEGORY_KEYS.map((key) => ({ key, label: feedCategoryLabel(key) })),
  };
}

/** What a filter would let through now: the form's preview before saving. */
export async function previewWatch(body: unknown): Promise<BeforeJson<AdminWatchPreview>> {
  const parsed = WatchFilterSchema.safeParse((body as { filter?: unknown } | null)?.filter);
  if (!parsed.success) throw new WatchFilterError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const filter = savable(parsed.data);
  const items = await watchItems(filter, { limit: 10 });
  return {
    items: items.map((i) => ({ id: i.id, title: i.title, source: i.source_name, published_at: i.published_at, url: itemUrl(i.id) })),
    feedUrl: watchFeedUrl(filter),
  };
}

export async function createWatchRule(body: unknown, actor: string) {
  const input = parseInput(body);
  const [row] = await sql`
    INSERT INTO watch_rules (name, filter, channels, mode, enabled)
    VALUES (${input.name}, ${sql.json(input.filter)}, ${input.channels}, ${input.mode}, ${input.enabled})
    RETURNING id`;
  const id = Number(row!.id);
  const primed = await primeRule(id, input.filter);
  await audit(actor, "watch.create", `watch-rule:${id}`, null, null, input);
  return { id, primed };
}

export async function updateWatchRule(id: number, body: unknown, actor: string) {
  const input = parseInput(body);
  const [before] = await sql`SELECT name, filter, channels, mode, enabled FROM watch_rules WHERE id = ${id}`;
  if (!before) return null;
  await sql`
    UPDATE watch_rules SET name = ${input.name}, filter = ${sql.json(input.filter)}, channels = ${input.channels},
      mode = ${input.mode}, enabled = ${input.enabled}, updated_at = now()
    WHERE id = ${id}`;
  // A changed filter starts again from now: what it matches already is accounted for, not pushed.
  const changed = watchQueryString(WatchFilterSchema.parse(before.filter)) !== watchQueryString(input.filter);
  const primed = changed ? await primeRule(id, input.filter) : 0;
  await audit(actor, "watch.update", `watch-rule:${id}`, null, before, input);
  return { id, primed };
}

export async function deleteWatchRule(id: number, actor: string) {
  const [before] = await sql`DELETE FROM watch_rules WHERE id = ${id} RETURNING name, filter, channels, mode, enabled`;
  if (!before) return null;
  await audit(actor, "watch.delete", `watch-rule:${id}`, null, before, null);
  return { id };
}
