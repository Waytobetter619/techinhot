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
// 还有积压时、一轮失败后，隔多久接着跑（分钟）；比完整间隔短，积压的文章不用干等。
const BACKLOG_WAIT_MINUTES = num("FEEDER_BACKLOG_WAIT_MINUTES", 1);
const RETRY_WAIT_MINUTES = num("FEEDER_RETRY_WAIT_MINUTES", 5);
const MAX_PER_RUN = num("FEEDER_MAX_PER_RUN", 150);
const BACKFILL_HOURS = num("FEEDER_BACKFILL_HOURS", 48);
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
  /**
   * 游标：最后推过的那一篇的发布时间和原文网址。发布时间不能单独当游标——Techin 里每天有上百篇
   * 只知道日期的文章，时间统一补成零点整；同一时刻的文章按网址排序，游标才能稳定往前走。
   */
  cursor: { time: string; url: string } | null;
  datasetId: string | null;
}
/** 旧版状态文件只存了一个时间（watermark）：没有网址时，从该时刻的网址起点开始取，重复的由站内判重。 */
type StateFile = State | { watermark: string | null; datasetId: string | null };

function cursorOf(raw: StateFile): State {
  if ("cursor" in raw) return { cursor: raw.cursor, datasetId: raw.datasetId };
  const time = raw.watermark ? new Date(raw.watermark).toISOString() : null;
  return { cursor: time ? { time, url: "" } : null, datasetId: raw.datasetId };
}

/** 这一篇排在该游标之后吗（时间更晚，或时间相同而网址更靠后）。 */
function afterCursor(time: string, url: string, cursor: { time: string; url: string } | null): boolean {
  if (!cursor) return true;
  return time > cursor.time || (time === cursor.time && url > cursor.url);
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
    // 先按发布时间、同一时刻再按网址：顺序稳定，游标才可靠（只按时间排时，零点整的几百篇每轮顺序可能不同）。
    sorts: [{ field: F.time, order: "asc" }, { field: F.url, order: "asc" }],
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

/** 遇到限流最多等几轮（每轮通常 60 秒）。 */
const MAX_RATE_LIMIT_WAITS = 20;

async function ingest(sourceId: string, sourceName: string, items: Item[]): Promise<number> {
  for (let waits = 0; ; waits++) {
    const res = await fetch(`${INGEST_BASE}/api/ingest/items`, {
      method: "POST",
      headers: { Authorization: `Bearer ${INGEST_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId, sourceName, items }),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; created?: number; error?: string } | null;
    // 推送接口按客户端限流（INGEST_RATE_LIMIT，每分钟几次）。一轮里文章分散在几十个信源上就要推几十次，
    // 超限时接口回 429 并给出等待秒数：等够了再推这一批，不让整轮推送到一半作废、积压永远推不动。
    if (res.status === 429 && waits < MAX_RATE_LIMIT_WAITS) {
      const seconds = Math.max(5, Number(res.headers.get("retry-after")) || 60);
      log(`推送接口限流，等 ${seconds} 秒后接着推`);
      await sleep(seconds * 1000);
      continue;
    }
    if (!res.ok || !json?.ok) throw new Error(`推送失败（HTTP ${res.status}）：${json?.error ?? "无响应体"}`);
    return json.created ?? 0;
  }
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
  const { readFile, mkdir } = await import("node:fs/promises");
  const path = await import("node:path");
  try {
    return cursorOf(JSON.parse(await readFile(STATE_FILE, "utf8")) as StateFile);
  } catch {
    await mkdir(path.dirname(STATE_FILE), { recursive: true });
    return { cursor: null, datasetId: null };
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

/** 跑一轮；返回游标之后是否还有没取完的文章。 */
async function cycle(state: State): Promise<boolean> {
  const dataset = await datasetId(state);
  const now = Date.now();
  // 首次运行回看 BACKFILL_HOURS；之后从游标所在的时刻开始取（接口只有闭区间，同一时刻的由游标的网址区分）。
  const from = state.cursor ? new Date(state.cursor.time) : new Date(now - BACKFILL_HOURS * 3_600_000);
  const to = new Date(now);
  const fromIso = beijing(from);
  const toIso = beijing(to);

  const filters: Array<{ field: string; op: string; value?: unknown }> = [];
  if (HIGH_VALUE_ONLY) filters.push({ field: F.highValue, op: "=", value: true });
  if (REQUIRE_INDUSTRY) filters.push({ field: F.industries, op: "is_not_null" });
  if (WHITELIST.length) filters.push({ field: F.industries, op: "contains_any", value: WHITELIST });

  const bySource = new Map<string, Item[]>();
  const seen = new Set<string>();
  const pushed: Item[] = [];
  let fetched = 0;
  let skipped = 0;
  let page = 1;
  // 翻页上限：正常情况几页就够；同一时刻的文章极多时要翻很多页越过游标，设上限防接口异常时无限翻页。
  const maxPages = Math.ceil(MAX_PER_RUN / PAGE_SIZE) + 200;
  while (pushed.length < MAX_PER_RUN && page <= maxPages) {
    const { rows, hasNext } = await queryPage(dataset, filters, fromIso, toIso, page);
    for (const row of rows) {
      const item = toItem(row);
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      fetched += 1;
      // 游标之前（含游标本身）的是上一轮推过的：不推，也不计入名额。
      if (!afterCursor(item.publishedAt, item.url, state.cursor)) {
        skipped += 1;
        continue;
      }
      const site = str(row, F.site) || "未知信源";
      const list = bySource.get(site) ?? [];
      list.push(item);
      bySource.set(site, list);
      pushed.push(item);
      if (pushed.length >= MAX_PER_RUN) break;
    }
    if (!hasNext || rows.length === 0) break;
    page += 1;
  }
  if (page > maxPages) log(`警告：翻页达到上限 ${maxPages} 页仍未越过游标，本轮先处理已取到的 ${pushed.length} 条`);

  // 取满名额说明游标之后还有没轮到的文章；下一轮从新游标接着取。
  const backlog = pushed.length >= MAX_PER_RUN;
  if (pushed.length === 0) {
    log(`窗口 ${fromIso} ~ ${toIso}：没有新文章（${skipped} 条在游标之前）`);
    return false;
  }
  const last = pushed.at(-1)!;
  log(`窗口 ${fromIso} ~ ${toIso}：取到 ${fetched} 条，待推 ${pushed.length} 条（${skipped} 条在游标之前），来自 ${bySource.size} 个信源${backlog ? "，还有积压" : ""}`);
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
  // 游标记在本轮实际推出去的最后一篇上。推送中途出错会抛到外层，游标不动，下一轮从原处重推，站内按网址判重。
  const next = { time: last.publishedAt, url: last.url };
  const moved = JSON.stringify(next) !== JSON.stringify(state.cursor);
  if (moved) {
    state.cursor = next;
    await saveState(state);
  }
  log(`本轮完成：推送 ${created} 条，游标${moved ? `推进到 ${last.publishedAt} ${last.url.slice(0, 60)}` : "不变"}`);
  return backlog;
}

async function main() {
  if (!TECHIN_TOKEN) throw new Error("未配置 TECHIN_TOKEN（Techin 多维分析的 API Key）");
  // 注意：is_high_value_site 字段要用布尔 true 过滤（字符串会报数据连接异常）。
  if (!INGEST_TOKEN || INGEST_TOKEN.length < 16) throw new Error("未配置 INGEST_TOKEN 或长度不足 16 位（与 .env 的推送接口 token 一致）");
  const state = await loadState();
  const once = process.argv.includes("--once");
  do {
    // 默认等一个完整间隔；失败（稍后重试）和还有积压（接着取）时只歇一小会儿，不让积压的文章干等。
    let waitMinutes = INTERVAL_MINUTES;
    try {
      if (await cycle(state)) waitMinutes = BACKLOG_WAIT_MINUTES;
    } catch (error) {
      log(`本轮失败（水位线不动，${RETRY_WAIT_MINUTES} 分钟后重试）：${error instanceof Error ? error.message : error}`);
      waitMinutes = RETRY_WAIT_MINUTES;
      if (once) process.exitCode = 1;
    }
    if (once) break;
    if (running) await sleep(waitMinutes * 60_000);
  } while (running);
  // --once 时引入的 backend 模块带着连接池，事件循环不会自己空；跑完就退，别挂住计划任务。
  if (once) process.exit(process.exitCode ?? 0);
}

main();
