# techin-feeder

把 Techin「产业舆情资讯」数据集的新文章推进本站，走和普通采集一样的判重、精选和归组
（`POST /api/ingest/items`，见 `docs/sources.md` 的外部推送接口）。独立的常驻脚本，不占用
框架的三个进程；零 npm 依赖（翻转信源时借用仓库里现成的 `postgres` 驱动）。

## 运行

```bash
node --env-file=.env scripts/techin-feeder/techin-feeder.ts          # 常驻，每 15 分钟一轮
node --env-file=.env scripts/techin-feeder/techin-feeder.ts --once   # 只跑一轮（调试、配 Windows 计划任务用）
```

## 环境变量（都写进 .env，不要提交）

| 变量 | 默认 | 说明 |
|---|---|---|
| `TECHIN_TOKEN` | 必填 | Techin 多维分析 API Key（平台「消息中心」获取） |
| `TECHIN_BASE_URL` | `https://techin.hitech-data.cn` | Techin 服务地址 |
| `TECHIN_DATASET` | `产业舆情资讯` | 数据集标准名 |
| `TECHIN_HIGH_VALUE_ONLY` | `false` | 只接「高价值站点」标记的文章。**默认关**：实测高价值子集更新滞后约 10 天，开了会让文章全部因超 48 小时被归档；子集还必须用布尔 `true` 过滤（字符串会报「数据连接异常」） |
| `TECHIN_REQUIRE_INDUSTRY` | `true` | 只接带产业分类标签的文章（实测与主库同步、日增约 165 条） |
| `TECHIN_INDUSTRY_WHITELIST` | 空 | 逗号分隔的产业白名单（如 `人工智能,半导体`），空 = 全部产业 |
| `FEEDER_INGEST_BASE` | `http://127.0.0.1:3001` | 本站 api 的地址 |
| `INGEST_TOKEN` | 必填 | 与 `.env` 推送接口的 token 一致（≥16 位） |
| `FEEDER_INTERVAL_MINUTES` | `15` | 常驻模式的轮询间隔 |
| `FEEDER_MAX_PER_RUN` | `150` | 每轮最多推送多少条（控模型调用量） |
| `FEEDER_BACKFILL_HOURS` | `48` | 首次运行往前回看多久（Techin 数据滞后 1–2 天，48h 正好接住最近一批；再老的会被站里按 48 小时规则归档，不刷屏） |
| `FEEDER_OVERLAP_MINUTES` | `10` | 每轮窗口往前重叠多久，靠 URL 判重兜底 |
| `TECHIN_SOURCE_PREFIX` | `techin` | 自动建的信源 id 前缀（`techin-新浪网`） |
| `TECHIN_SOURCE_NAME_PREFIX` | `Techin舆情·` | 信源显示名前缀 |
| `FEEDER_FLIP_EDITORIAL` | `true` | 把新信源从 isolated 翻成 editorial（等同后台手工操作） |
| `FEEDER_STATE_FILE` | `.data/techin-feeder/state.json` | 水位线与数据集 ID 缓存 |

## 工作方式

1. 按 `release_time` 升序拉新文章（默认只收高价值站点 + 带产业标签的）；
2. 标题优先用 Techin 的 AI 中文标题（外文文章的译文），其次原标题；
3. 按「信源」（新浪网、爱集微……）分组推送——每个网站是站里的一个独立信源，热度按独立来源计数才准；
4. 自动建的 `external` 信源默认不公开（框架的安全默认），脚本直接把它翻成 `editorial`；
5. 水位线存在 `FEEDER_STATE_FILE`，推送中途失败整轮不推进，下轮重推（站里按 URL 判重，不会重复入库）。

## 已知边界

- Techin 数据本身有 1–2 天滞后，本站的时间线以 Techin 入库的 `release_time` 为准；
- 推送条目不带摘要：标题摘要由站内模型自己写（精选管线的一部分）；
- 一次最多 50 条的接口上限已按分组分批处理；`INGEST_RATE_LIMIT` 不要设低于每分钟 6 次。
