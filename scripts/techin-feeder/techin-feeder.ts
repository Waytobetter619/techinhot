// techin-feeder — 把 Techin「产业舆情资讯」数据集的新文章推进本站（POST /api/ingest/items）。
// 独立的常驻脚本，不属于框架进程：node --env-file=.env scripts/techin-feeder/techin-feeder.ts [--once]
// 数据集口径在环境变量里调（见 scripts/techin-feeder/README.md），不动这里也能改。
import { beijingIso } from "@aihot/contracts/time";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const bool = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  return v === undefined || v === "" ? fallback : v === "true";
};
const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]?.trim());
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

const TECHIN_BASE = env("TECHIN_BASE_URL", "https://techin.hitech-data.cn");
const TECHIN_TOKEN = process.env.TECHIN_TOKEN?.trim() ?? "";
const DATASET_NAME = env("TECHIN_DATASET", "产业舆情资讯");
const INGEST_BASE = env("FEEDER_INGEST_BASE", "http://127.0.0.1:3001");
const INGEST_TOKEN = process.env.INGEST_TOKEN?.trim() ?? "";
const INTERVAL_MINUTES = num("FEEDER_INTERVAL_MINUTES", 15);
const MAX_PER_RUN = num("FEEDER_MAX_PER_RUN", 150);
const BACKFILL_HOURS = num("FEEDER_BACKFILL_HOURS", 48);
const OVERLAP_MINUTES = num("FEEDER_OVERLAP_MINUTES", 10);
const HIGH_VALUE_ONLY = bool("TECHIN_HIGH_VALUE_ONLY", false);
const REQUIRE_INDUSTRY = bool("TECHIN_REQUIRE_INDUSTRY", true);
const WHITELIST = process.env.TECHIN_INDUSTRY_WHITELIST?.split(/[,，]/).map((s) => s.trim()).filter(Boolean) ?? [];
const SOURCE_PREFIX = env("TECHIN_SOURCE_PREFIX", "techin");
const SOURCE_NAME_PREFIX = env("TECHIN_SOURCE_NAME_PREFIX", "Techin舆情·");
const FLIP_EDITORIAL = bool("FEEDER_FLIP_EDITORIAL", true);
const STATE_FILE = env("FEEDER_STATE_FILE", ".data/techin-feeder/state.json");
const PAGE_SIZE = 50;

// 产业舆情资讯的字段名（Techin 部署内稳定；换部署时用 techin_query.mjs fields 重新核对）。
const F = {
  aiTitle: "ai_title",
  title: "article_title",
  titleEn: "article_translate_title",
  url: "url",
  site: "website_name",
  time: "release_time",
  industries: "industries_value_list",
  highValue: "is_high_value_site",
};

interface Row {
  [key: string]: string | null;
}
interface State {
  watermark: string | null; // 已推送条目里最新的 release_time（ISO）；窗口从这里往前留重叠
  datasetId: string | null;
}

const str = (row: Row, key: string) => (typeof row[key] === "string" ? (row[key] as string).trim() : "");
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

/** Techin 的时间过滤要北京时间的朴素字符串（YYYY-MM-DDTHH:mm:ss），不带 Z 和毫秒。 */
const beijing = (d: Date) => beijingIso(d).slice(0, 19);

async function techin(path: string, query?: Record<string, string>, body?: unknown): Promise<Record<string, unknown>> {
  const url = new URL(TECHIN_BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  if (process.env.FEEDER_DEBUG) console.error(`DEBUG → ${url.href} ${body === undefined ? "" : JSON.stringify(body)}`);
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: { apikey: TECHIN_TOKEN, Authorization: `Bearer ${TECHIN_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as ({ code?: string; message?: string } & Record<string, unknown>) | null;
      if (res.status === 401 || res.status === 403) throw new Error(`Techin 拒绝访问（HTTP ${res.status}）：检查 TECHIN_TOKEN 是否有效`);
      if (!res.ok || json?.code) {
        const transient = res.status >= 500 || json?.message?.includes("数据连接异常");
        lastError = `HTTP ${res.status} ${json?.code ?? ""} ${json?.message ?? ""}`.trim();
        if (!transient) throw new Error(`Techin 查询失败：${lastError}`);
      } else return json ?? {};
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (lastError.includes("拒绝访问")) throw error;
    }
    if (attempt < 3) {
      log(`Techin 请求失败（第 ${attempt} 次）：${lastError}，${attempt * 10}s 后重试`);
      await sleep(attempt * 10_000);
    }
  }
  throw new Error(`Techin 连续失败：${lastError}`);
}

async function datasetId(state: State): Promise<string> {
  if (state.datasetId) return state.datasetId;
  const r = await techin("/api/v1/datasets", { search: DATASET_NAME, page: "1", page_size: "20" });
  const items = (r.items ?? []) as Array<{ id: string; name: string }>;
  const exact = items.find((i) => i.name === DATASET_NAME);
  if (!exact) throw new Error(`数据集「${DATASET_NAME}」未找到（返回 ${items.length} 项）。检查 TECHIN_DATASET 与账号权限。`);
  state.datasetId = exact.id;
  return exact.id;
}

/** 拉一页明细。API 的 rows 是「每行一个数组」按 columns 顺序排，这里先映射成字段名对象。 */
async function queryPage(dataset: string, filters: Array<{ field: string; op: string; value?: unknown }>, fromIso: string, toIso: string, page: number) {
  const body = {
    dataset_id: dataset,
    fields: [F.aiTitle, F.title, F.titleEn, F.url, F.site, F.time, F.industries],
    filters: [...filters, { field: F.time, op: "between", value: [fromIso, toIso] }],
    sorts: [{ field: F.time, order: "asc" }],
    page: { page, page_size: PAGE_SIZE },
  };
  const r = await techin("/api/v1/query/detail", undefined, body);
  const columns = ((r.columns ?? []) as Array<{ name?: string }>).map((c) => String(c.name ?? ""));
  const rows = ((r.rows ?? []) as unknown[][]).map((cells) => {
    const row: Row = {};
    columns.forEach((name, i) => {
      row[name] = typeof cells[i] === "string" ? (cells[i] as string) : cells[i] == null ? null : String(cells[i]);
    });
    return row;
  });
  return { rows, hasNext: r.has_next === true };
}

interface Item {
  title: string;
  url: string;
  publishedAt: string;
  raw: Record<string, unknown>;
}

function toItem(row: Row): Item | null {
  const url = str(row, F.url);
  const time = str(row, F.time);
  if (!url || !time) return null;
  const published = new Date(time);
  if (Number.isNaN(published.getTime())) return null;
  // 标题优先 AI 中文标题（外文文章的译文），其次原标题，再次原标题的英文翻译。
  const title = str(row, F.aiTitle) || str(row, F.title) || str(row, F.titleEn);
  if (!title) return null;
  const industries = str(row, F.industries);
  return {
    title,
    url,
    publishedAt: published.toISOString(),
    raw: { techin: { site: str(row, F.site), industries: industries || undefined } },
  };
}

async function ingest(sourceId: string, sourceName: string, items: Item[]): Promise<number> {
  const res = await fetch(`${INGEST_BASE}/api/ingest/items`, {
    method: "POST",
    headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId, sourceName, items }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; created?: number; error?: string } | null;
  if (!res.ok || !json?.ok) throw new Error(`推送失败（HTTP ${res.status}）：${json?.error ?? "无响应体"}`);
  return json.created ?? 0;
}

/** 推送接口自动建的 external 信源默认 isolated（不公开）；这里把它们翻成 editorial，等同管理员在后台的操作。
 *  入站瞬间信源还是 isolated，条目会按 withdrawn 落库；翻转后要对该信源的存量文章重建公开内容。 */
async function flipEditorial(): Promise<number> {
  if (!FLIP_EDITORIAL) return 0;
  try {
    const postgres = (await import("postgres")).default;
    const { publishArticle } = await import("../../packages/backend/src/publication/publish.ts");
    const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
    const flipped = await sql`
      UPDATE sources SET participation_mode = 'editorial', updated_at = now()
      WHERE id LIKE ${SOURCE_PREFIX + "-%"} AND participation_mode = 'isolated'
      RETURNING id`;
    if (flipped.length) {
      log(`已把 ${flipped.length} 个新信源改为公开（editorial）：${flipped.map((s) => s.id).join("、")}`);
      const stale = await sql`
        SELECT article_id FROM publications
        WHERE visibility = 'withdrawn' AND source_id IN ${sql(flipped.map((s) => s.id))}`;
      for (const row of stale) {
        await publishArticle(String(row.article_id));
      }
      if (stale.length) log(`已重建 ${stale.length} 条入站时被隐藏条目的公开内容`);
    }
    await sql.end();
    return flipped.length;
  } catch (error) {
    log(`翻转信源失败（不影响推送，下次再试）：${error instanceof Error ? error.message : error}`);
    return 0;
  }
}

async function loadState(): Promise<State> {
  const { readFile, mkdir, writeFile, rename } = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as State;
  } catch {
    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    return { watermark: null, datasetId: null };
  }
}

async function saveState(state: State) {
  const { writeFile, rename, mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, STATE_FILE);
}

let running = true;
process.on("SIGINT", () => {
  log("收到退出信号，本轮结束后停止");
  running = false;
});

async function cycle(state: State): Promise<void> {
  const dataset = await datasetId(state);
  const now = Date.now();
  // 首次运行回看 BACKFILL_HOURS；之后从水位线往前留一小段重叠，靠 URL 判重兜底。
  const from = state.watermark ? new Date(new Date(state.watermark).getTime() - OVERLAP_MINUTES * 60_000) : new Date(now - BACKFILL_HOURS * 3_600_000);
  const to = new Date(now);
  const fromIso = beijing(from);
  const toIso = beijing(to);

  const filters: Array<{ field: string; op: string; value?: unknown }> = [];
  if (HIGH_VALUE_ONLY) filters.push({ field: F.highValue, op: "=", value: true });
  if (REQUIRE_INDUSTRY) filters.push({ field: F.industries, op: "is_not_null" });
  if (WHITELIST.length) filters.push({ field: F.industries, op: "contains_any", value: WHITELIST });

  const bySource = new Map<string, Item[]>();
  const seen = new Set<string>();
  let fetched = 0;
  let skipped = 0;
  let maxTime = state.watermark;
  let page = 1;
  while (fetched < MAX_PER_RUN) {
    const { rows, hasNext } = await queryPage(dataset, filters, fromIso, toIso, page);
    for (const row of rows) {
      const item = toItem(row);
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      fetched += 1;
      // 严格大于水位线，避免同一时刻的文章在两轮之间漏掉或重复。
      if (state.watermark && new Date(item.publishedAt).getTime() <= new Date(state.watermark).getTime()) {
        skipped += 1;
        continue;
      }
      const site = str(row, F.site) || "未知信源";
      const list = bySource.get(site) ?? [];
      list.push(item);
      bySource.set(site, list);
      const time = item.publishedAt;
      if (!maxTime || time > maxTime) maxTime = time;
      if (fetched >= MAX_PER_RUN) break;
    }
    if (!hasNext || rows.length === 0) break;
    page += 1;
  }

  if (fetched === 0) {
    log(`窗口 ${fromIso} ~ ${toIso}：没有新文章`);
    return;
  }
  log(`窗口 ${fromIso} ~ ${toIso}：取到 ${fetched} 条（${skipped} 条不新于水位线），来自 ${bySource.size} 个信源`);
  let created = 0;
  for (const [site, items] of bySource) {
    for (let i = 0; i < items.length; i += PAGE_SIZE) {
      const batch = items.slice(i, i + PAGE_SIZE);
      // sourceId 用站名原文（库里 id 是自由文本），保证每个网站是热度里的一个独立来源。
      const n = await ingest(`${SOURCE_PREFIX}-${site.slice(0, 100)}`, `${SOURCE_NAME_PREFIX}${site}`, batch);
      created += n;
      log(`推送 ${site}：${batch.length} 条，新建 ${n} 条`);
      await sleep(500);
    }
  }
  await flipEditorial();
  if (maxTime && maxTime !== state.watermark) {
    state.watermark = maxTime;
    await saveState(state);
    log(`本轮完成：推送 ${created} 条，水位线推进到 ${maxTime}`);
  } else {
    log(`本轮完成：推送 ${created} 条，水位线不变（${state.watermark ?? "未设置"}）`);
  }
}

async function main() {
  if (!TECHIN_TOKEN) throw new Error("未配置 TECHIN_TOKEN（Techin 多维分析的 API Key）");
  // 注意：is_high_value_site 字段要用布尔 true 过滤（字符串会报数据连接异常）。
  if (!INGEST_TOKEN || INGEST_TOKEN.length < 16) throw new Error("未配置 INGEST_TOKEN 或长度不足 16 位（与 .env 的推送接口 token 一致）");
  const state = await loadState();
  const once = process.argv.includes("--once");
  do {
    try {
      await cycle(state);
    } catch (error) {
      log(`本轮失败（水位线不动，下轮重试）：${error instanceof Error ? error.message : error}`);
      if (once) process.exitCode = 1;
    }
    if (once) break;
    if (running) await sleep(INTERVAL_MINUTES * 60_000);
  } while (running);
  // --once 时引入的 backend 模块带着连接池，事件循环不会自己空；跑完就退，别挂住计划任务。
  if (once) process.exit(process.exitCode ?? 0);
}

main();
