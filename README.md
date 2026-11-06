# TechinHOT

**TechinHOT** 是一个科技产业热点站：从海外科技官方博客、科技媒体和 Techin「产业舆情资讯」数据集里收资料，用大模型预筛、独立打两次分，把同一件事的多篇报道聚成一个事件，按热度排出当前热点，每天早上出一份产业日报。

基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 开源框架（MIT）搭建，行业包按「科技产业」重写：分类、标签、公司名录、评分标准与各环节提示词都在 `industry/` 和 `site/`，改口径不用动框架代码。

## 内容来自哪里

| 来源 | 说明 |
|---|---|
| `industry/sources.json` | 18 个示范信源（OpenAI、DeepMind、Hugging Face、NVIDIA、MIT TR、TechCrunch……官方一手 + 媒体/个人两级），首次启动自动导入 |
| Techin 产业舆情 | `scripts/techin-feeder/techin-feeder.ts` 常驻脚本：从 Techin 多维分析「产业舆情资讯」数据集（千万级多语种产业资讯，自带 AI 中文标题与摘要）按水位线增量取数，按原文信源网站分组推进站里，走和普通采集一样的判重、精选、归组 |

默认口径：只接**带产业分类标签**的文章（Techin 高价值站点子集实测滞后约 10 天，默认不启用）；想收窄到几个产业，在 `.env` 里填 `TECHIN_INDUSTRY_WHITELIST=人工智能,半导体`。

## 本地跑起来（Windows 原生，不需要 Docker）

需要 Node.js ≥ 24.22 和 PostgreSQL 16/17。本仓库按「便携版 PostgreSQL + 三个进程 + feeder」的方式在本机运行，详见 [部署说明](docs/deploy-local-windows.md)：

```powershell
# 1. 依赖
npm ci
# 2. 配置：复制 .env.example 为 .env，填 LLM_API_KEY、TECHIN_TOKEN、INGEST_TOKEN、ADMIN_PASSWORD 等
# 3. 数据库（本仓库用 runtime/ 下的便携版 PostgreSQL，见部署说明）
# 4. 初始化并启动
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web
NODE_ENV=production node --env-file=.env apps/api/src/main.ts      # 接口，3001
NODE_ENV=production node --env-file=.env apps/worker/src/main.ts   # 后台任务
cd apps/web; NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000
node --env-file=.env scripts/techin-feeder/techin-feeder.ts                        # Techin 舆情推送
```

打开 http://localhost:3000，后台在 `/admin`。一键启停脚本见 `scripts/local/`。

## 模型 key

`.env` 里 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，任何 OpenAI 兼容接口都行（DeepSeek、智谱 GLM、千问……写法见 `.env.example` 注释）。没有模型调用时站点可以采集入库，但不评分、不写摘要、不出精选和日报——填好 key、`MODEL_CALLS_ENABLED=true` 后自动开始处理存量。

## 目录速览

- `site/` — 站名文案（`site.ts`）、模型清单（`models.ts`）、品牌（`brand/`）、条款页面（`pages/`）
- `industry/` — 分类标签（`taxonomy.ts`）、主题（`topics.json`）、示范信源（`sources.json`）、提示词（`prompts/`）、精选门槛（`selection.ts`）
- \`scripts/techin-feeder/\` — Techin 舆情推送脚本与配置说明
- `docs/` — 框架文档（部署、信源、精选校准、事件归组、架构）
- `scripts/local/` — 本机 Windows 启停脚本（便携版 PostgreSQL）

## 与上游框架的关系

框架部分（`apps/`、`packages/`、`database/`）跟随上游 AIHOT，不在这里改动；本站自己的东西在 \`site/\`、\`industry/\`、\`scripts/techin-feeder/\`、\`scripts/local/\`。上游更新可以直接合并。感谢 [数字生命卡兹克](https://github.com/KKKKhazix) 的开源。
