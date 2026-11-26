// Subscriptions (docs/subscriptions.md): the filter an address carries, the feed it lists, and the owner's watch
// rules that push the same matches once each — never the past week at once when a rule is saved.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { config } from "@techinhot/backend/config";
import { sql, closeDb } from "@techinhot/backend/db";
import { stopBoss } from "@techinhot/backend/jobs/queue";
import { watchFeed } from "@techinhot/backend/publication/feeds";
import { watchFilterFromQuery, watchItems, WatchFilterError, WatchFilterSchema } from "@techinhot/backend/publication/watch";
import { createWatchRule, deleteWatchRule, updateWatchRule } from "@techinhot/backend/watch/rules";
import { runWatchRules, seenKey } from "@techinhot/backend/watch/run";

const T = tag();
const SOURCE = `watch-${T}`;
const OTHER = `watch-other-${T}`;
const received: Array<Record<string, any>> = [];
let answer = '{"code":0,"msg":"success"}';
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(answer);
  });
});

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.WATCH_FEISHU_WEBHOOK_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  for (const id of [SOURCE, OTHER]) await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${id}, ${`Watch ${id}`}, 'rss', 'T1') ON CONFLICT DO NOTHING`;
});
after(async () => {
  delete process.env.WATCH_FEISHU_WEBHOOK_URL;
  config.watchPushEnabled = false;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

let n = 0;
/** One public item from `source`; selected items hold their fact's seat. */
async function item(opts: { title: string; category: string; tags?: string[]; selected?: boolean; score?: number; source?: string }) {
  const id = `watch-item-${T}-${++n}`;
  const source = opts.source ?? SOURCE;
  const selected = opts.selected ?? true;
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id}, ${source}, ${id}, ${`https://example.com/${id}`}, ${opts.title}, now() - interval '1 hour', now() - interval '1 hour')`;
  await sql`INSERT INTO publications (article_id, title, summary, source_id, channel, url, category, tags, score, published_at, discovered_at, timeline_at, sort_at,
      eligible, selected, seat, visible_after, visibility, search_text)
    VALUES (${id}, ${opts.title}, '摘要', ${source}, 'news', ${`https://example.com/${id}`}, ${opts.category}, ${opts.tags ?? []}, ${opts.score ?? 90},
      now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour',
      true, ${selected}, ${selected}, now() - interval '1 hour', 'public', ${opts.title.toLowerCase()})`;
  return id;
}

test("an address reads repeated and comma-separated values, and refuses what it cannot follow", () => {
  const f = watchFilterFromQuery({ topic: ["export-controls", "chips-compute"], category: "geopolitics,industry", q: " 英伟达 " });
  assert.deepEqual(f, { topics: ["export-controls", "chips-compute"], categories: ["geopolitics", "industry"], sources: [], q: "英伟达", level: "selected" });
  assert.equal(watchFilterFromQuery({ source: "a", level: "all" }).level, "all");
  assert.throws(() => watchFilterFromQuery({ topic: "no-such-topic" }), WatchFilterError);
  assert.throws(() => watchFilterFromQuery({ category: "no-such-category" }), WatchFilterError);
  assert.throws(() => watchFilterFromQuery({ level: "everything" }), WatchFilterError);
});

test("a filter narrows by source, category, topic, keyword and level; within a field any value counts", async () => {
  const chip = await item({ title: `英伟达芯片出口新规 ${T}`, category: "geopolitics", tags: ["出口管制"] });
  const funding = await item({ title: `某模型公司融资 ${T}`, category: "industry" });
  const listed = await item({ title: `实体清单更新 ${T}`, category: "geopolitics", selected: false, score: 60 });
  await item({ title: `英伟达财报 ${T}`, category: "industry", source: OTHER });
  const ids = async (q: Record<string, unknown>) => (await watchItems(watchFilterFromQuery({ source: SOURCE, ...q }))).map((i) => i.id).sort();

  assert.deepEqual(await ids({}), [chip, funding].sort(), "selected only by default");
  assert.deepEqual(await ids({ level: "all" }), [chip, funding, listed].sort(), "全部动态 also lists what was not selected");
  assert.deepEqual(await ids({ category: "geopolitics" }), [chip]);
  assert.deepEqual(await ids({ category: "geopolitics,industry" }), [chip, funding].sort());
  assert.deepEqual(await ids({ topic: "export-controls" }), [chip], "a topic is the topic page's rule");
  assert.deepEqual(await ids({ q: "英伟达" }), [chip], "the keyword narrows inside the source");
  const both = (await watchItems(watchFilterFromQuery({ source: [SOURCE, OTHER], q: "英伟达" }))).map((i) => i.id);
  assert.equal(both.length, 2, "any of the named sources");

  const xml = await watchFeed(watchFilterFromQuery({ source: SOURCE, category: "geopolitics" }));
  assert.match(xml, new RegExp(`英伟达芯片出口新规 ${T}`));
  assert.doesNotMatch(xml, new RegExp(`某模型公司融资 ${T}`));
  assert.match(xml, /\/feed\/watch\.xml\?category=geopolitics&amp;source=/, "the feed names its own address");
});

test("a saved rule pushes only news that arrives after it, once, and records every push", async () => {
  const filter = WatchFilterSchema.parse({ sources: [SOURCE], categories: ["geopolitics"] });
  const { id, primed } = await createWatchRule({ name: `地缘 ${T}`, filter, channels: ["feishu"], mode: "instant" }, "test");
  assert.ok(primed >= 1, "what already matches is accounted for when the rule is saved");

  config.watchPushEnabled = true;
  received.length = 0;
  await runWatchRules("instant");
  assert.equal(received.length, 0, "saving a rule never pushes the past week");

  const fresh = await item({ title: `新的制裁措施 ${T}`, category: "geopolitics" });
  await runWatchRules("instant");
  assert.equal(received.length, 1);
  const card = JSON.stringify(received[0]);
  assert.match(card, new RegExp(`地缘 ${T}`));
  assert.match(card, new RegExp(`新的制裁措施 ${T}`));
  assert.match(card, new RegExp(`/items/${fresh}`), "the alert links to the item's page");

  await runWatchRules("instant");
  assert.equal(received.length, 1, "the same news is never pushed twice");

  answer = '{"code":19001,"msg":"param invalid"}';
  await item({ title: `另一条地缘新闻 ${T}`, category: "geopolitics" });
  await runWatchRules("instant");
  answer = '{"code":0,"msg":"success"}';
  const pushes = await sql`SELECT channel, items, status FROM watch_pushes WHERE rule_id = ${id} ORDER BY id`;
  assert.deepEqual(pushes.map((p) => p.status), ["sent", "failed"], "a refused push is recorded as failed, not retried");

  config.watchPushEnabled = false;
  await item({ title: `开关关着时的新闻 ${T}`, category: "geopolitics" });
  await runWatchRules("instant");
  const [last] = await sql`SELECT status FROM watch_pushes WHERE rule_id = ${id} ORDER BY id DESC LIMIT 1`;
  assert.equal(last!.status, "skipped", "with WATCH_PUSH_ENABLED off nothing leaves");
  assert.equal(received.length, 2);

  await deleteWatchRule(id, "test");
  assert.equal((await sql`SELECT count(*)::int AS n FROM watch_seen WHERE rule_id = ${id}`)[0]!.n, 0, "deleting a rule removes what it kept");
});

test("a daily rule waits for its run; changing a rule's filter starts it again from now", async () => {
  const filter = WatchFilterSchema.parse({ sources: [SOURCE], categories: ["industry"] });
  const { id } = await createWatchRule({ name: `行业日报 ${T}`, filter, channels: ["feishu"], mode: "daily" }, "test");
  config.watchPushEnabled = true;
  received.length = 0;
  await item({ title: `行业新动态 ${T}`, category: "industry" });
  await runWatchRules("instant");
  assert.equal(received.length, 0, "a daily rule is not read by the instant run");
  await runWatchRules("daily");
  assert.equal(received.length, 1);
  assert.match(JSON.stringify(received[0]), /每日关注/);

  await item({ title: `芯片新动态 ${T}`, category: "geopolitics", tags: ["出口管制"] });
  const changed = await updateWatchRule(id, { name: `行业日报 ${T}`, filter: { ...filter, categories: ["geopolitics"] }, channels: ["feishu"], mode: "daily", enabled: true }, "test");
  assert.ok(changed!.primed >= 1, "a changed filter accounts for what it already matches");
  await runWatchRules("daily");
  assert.equal(received.length, 1, "so the change itself pushes nothing");
  config.watchPushEnabled = false;
  await deleteWatchRule(id, "test");
});

test("a rule cannot be saved without something to narrow by, or with an unknown topic", async () => {
  await assert.rejects(createWatchRule({ name: "空", filter: {}, channels: ["feishu"] }, "test"), WatchFilterError);
  await assert.rejects(createWatchRule({ name: "错", filter: { topics: ["no-such-topic"] }, channels: ["feishu"] }, "test"), WatchFilterError);
  await assert.rejects(createWatchRule({ name: "无渠道", filter: { q: "英伟达" }, channels: [] }, "test"), WatchFilterError);
});

test("another outlet's copy of the same fact is the same alert", () => {
  assert.equal(seenKey({ id: "a1", fact_id: 7 }), seenKey({ id: "a2", fact_id: 7 }));
  assert.notEqual(seenKey({ id: "a1", fact_id: null }), seenKey({ id: "a2", fact_id: null }));
});
