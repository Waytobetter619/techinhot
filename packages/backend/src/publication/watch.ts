// Subscriptions (docs/subscriptions.md): a filter over the public pool, written into an address. The
// watch feed (feeds.ts watchFeed) and the owner's watch rules (watch/run.ts) read it the same way, so a
// rule pushes exactly what its feed lists. Within a field the values are alternatives (any topic, any
// category); across fields every one must hold; the keyword narrows what the rest let through.
import { z } from "zod";
import { CATEGORY_KEYS, PUBLIC_API_CATEGORY_KEYS, toPublicApiCategory, type PublicApiCategoryKey } from "@techinhot/contracts/taxonomy";
import { sql } from "../db.ts";
import { PUBLIC_ITEM_COLUMNS, type ItemRow } from "./items.ts";
import { publicMatchCondition, searchTerms } from "./pool.ts";
import { publicSourceName } from "./rules.ts";
import { browsedCondition, seatedCondition } from "./scope.ts";
import { findTopic, inTopic, type Topic } from "./topics.ts";

/** How far back a feed or a rule looks, and how many items a feed lists. */
export const WATCH_WINDOW_DAYS = 7;
export const WATCH_FEED_ITEMS = 50;
const MAX_VALUES = 20;

const list = z.array(z.string().trim().min(1).max(80)).max(MAX_VALUES);

export const WatchFilterSchema = z.object({
  topics: list.default([]),
  categories: z.array(z.enum(PUBLIC_API_CATEGORY_KEYS)).max(MAX_VALUES).default([]),
  sources: list.default([]),
  q: z.string().trim().max(80).nullable().default(null).transform((v) => (v ? v : null)),
  /** "selected": only what made the selection (as the main feed); "all": everything listed in 全部动态. */
  level: z.enum(["selected", "all"]).default("selected"),
});
export type WatchFilter = z.output<typeof WatchFilterSchema>;

/** A filter that does not read; the admin API answers it as 400. */
export class WatchFilterError extends Error {
  statusCode = 400;
}

/** Every value of a query parameter, whether it came once, repeated, or comma-separated. */
function values(raw: unknown): string[] {
  const all = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
  return all.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean);
}

/** The filter an address carries: ?topic=…&category=…&source=…&q=…&level=…; unknown topics are an error, not silently dropped. */
export function watchFilterFromQuery(query: Record<string, unknown>): WatchFilter {
  const parsed = WatchFilterSchema.safeParse({
    topics: values(query.topic),
    categories: values(query.category),
    sources: values(query.source),
    q: typeof query.q === "string" ? query.q : null,
    level: typeof query.level === "string" && query.level ? query.level : undefined,
  });
  if (!parsed.success) throw new WatchFilterError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  return checkTopics(parsed.data);
}

export function checkTopics(filter: WatchFilter): WatchFilter {
  const unknown = filter.topics.filter((slug) => !findTopic(slug));
  if (unknown.length) throw new WatchFilterError(`unknown topic: ${unknown.join(", ")}`);
  return filter;
}

/** The address of a filter, with its values in a fixed order, so equal filters share one address and one cache entry. */
export function watchQueryString(filter: WatchFilter): string {
  const p = new URLSearchParams();
  for (const v of [...filter.topics].sort()) p.append("topic", v);
  for (const v of [...filter.categories].sort()) p.append("category", v);
  for (const v of [...filter.sources].sort()) p.append("source", v);
  if (filter.q) p.set("q", filter.q);
  if (filter.level !== "selected") p.set("level", filter.level);
  return p.toString();
}

/** Who reads a filter: an empty one would be the whole site, which already has its feeds. */
export function isEmptyFilter(filter: WatchFilter): boolean {
  return !filter.topics.length && !filter.categories.length && !filter.sources.length && !filter.q;
}

/** The filter's condition over `publications p`, inside the level's public scope. */
export function watchCondition(filter: WatchFilter, now: Date) {
  const topics = filter.topics.map((slug) => findTopic(slug)).filter((t): t is Topic => t !== null);
  const categories = CATEGORY_KEYS.filter((k) => {
    const shown = toPublicApiCategory(k);
    return shown !== null && (filter.categories as readonly PublicApiCategoryKey[]).includes(shown);
  });
  const terms = filter.q ? searchTerms(filter.q) : [];
  return sql`${filter.level === "all" ? browsedCondition(now) : seatedCondition(now)}
    AND coalesce(p.published_at, p.discovered_at) > ${now}::timestamptz - make_interval(days => ${WATCH_WINDOW_DAYS})
    AND coalesce(p.published_at, p.discovered_at) <= ${now}
    ${topics.length ? sql`AND (${topics.map((t) => sql`(${inTopic(t)})`).reduce((a, b) => sql`${a} OR ${b}`)})` : sql``}
    ${categories.length ? sql`AND p.category IN ${sql(categories)}` : sql``}
    ${filter.sources.length ? sql`AND p.source_id = ANY(${filter.sources}::text[])` : sql``}
    ${publicMatchCondition(terms)}`;
}

/** One item a filter lets through; the fact it reports, when grouped, makes the same news from another outlet the same alert. */
export type WatchItem = Pick<ItemRow, "id" | "title" | "summary" | "url" | "category" | "published_at" | "source_name" | "fact_id">;

/** The newest items the filter lets through, newest first by original publish time. */
export async function watchItems(filter: WatchFilter, { now = new Date(), limit = WATCH_FEED_ITEMS }: { now?: Date; limit?: number } = {}): Promise<WatchItem[]> {
  const rows = await sql<WatchItem[]>`
    SELECT ${PUBLIC_ITEM_COLUMNS}, p.fact_id
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${watchCondition(filter, now)}
    ORDER BY coalesce(p.published_at, p.discovered_at) DESC, p.article_id DESC
    LIMIT ${limit}`;
  return rows.map((r) => ({ ...r, source_name: publicSourceName(r.source_name) }));
}
