# TechinHOT

**TechinHOT** 是一个个人用的 AI 与科技地缘资讯站：替你盯住国内外的官方博客、媒体、重点人物的 X 账号和政策信源，用大模型预筛、独立打两次分、写中文标题摘要，把同一件事的多篇报道聚成一个事件，按热度排出当前热点，每天早上出一份日报。抓取在服务器上进行，读的时候不用翻墙。

基于 [AIHOT](https://github.com/KKKKhazix/AIHOT) 开源框架（MIT）搭建，框架跟随上游最新版本。本站的口径是 AI（模型、产品、研究、人物观点），加上与 AI 和科技产业相关的**科技地缘政治**（出口管制、制裁、关税、AI 立法、芯片与关键供应链、中美科技博弈）；一般国际时事不收。

## 关注什么

| 内容 | 从哪来 |
|---|---|
| 大模型与 AI 产品动态 | OpenAI、DeepMind、Anthropic、Meta、Mistral 等官方博客，The Verge、TechCrunch 等媒体 |
| 重点人物言论 | X 账号（`x_search` 信源，需要 SocialData）：Altman、Hassabis、Karpathy、LeCun……，以及 Karpathy、Zvi 等人的博客 |
| 科技地缘与政策 | 美国联邦公报里的 BIS（实体清单、出口管制）与 USTR 文件，欧盟委员会，CSET、ChinaTalk、SemiAnalysis 等 |

B站 UP 主、小红书博主这类没有 RSS 的账号，经自带的 RSSHub 转成订阅源，见 [用自建 RSSHub 订阅 B站、小红书博主](docs/rsshub.md)。

示范信源在 `industry/sources.json`（首次启动导入），之后在后台“信源”页增删。X 的查询支持关键词，比如 `from:elonmusk -filter:replies (Grok OR xAI)` 只收某人谈某事的帖子。

## 部署

云服务器上用 Docker，步骤见 [部署到云服务器](docs/deploy-server.md)。本机 Windows 原生运行（便携版 PostgreSQL）见 [本地部署](docs/deploy-local-windows.md)。

## 模型 key

`.env` 里 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，任何 OpenAI 兼容接口都行（DeepSeek、智谱 GLM、千问……写法见 `.env.example` 注释）。X 账号信源另需 `SOCIALDATA_API_KEY`，公众号信源需要 `DAJIALA_KEY`，都按请求计费，在后台“设置”里设预算上限。

## 目录速览

- `site/` — 站名文案（`site.ts`）、模型清单（`models.ts`）、品牌（`brand/`）、条款页面（`pages/`）
- `industry/` — 分类（含“地缘”）、标签、主题（`topics.json`）、示范信源（`sources.json`）、提示词（`prompts/`）、精选门槛（`selection.ts`）
- `scripts/techin-feeder/` — Techin「产业舆情资讯」推送脚本（默认不启用，见其 README）
- `scripts/local/` — 本机 Windows 启停脚本
- `docs/` — 框架文档（部署、信源、精选校准、事件归组、架构）

## 与上游框架的关系

框架部分（`apps/`、`packages/`、`database/`、`tests/`）跟随上游 AIHOT，不在这里改动；本站自己的东西在 `site/`、`industry/`、`scripts/techin-feeder/`、`scripts/local/` 和两份部署说明。上游更新可以直接合并。感谢 [数字生命卡兹克](https://github.com/KKKKhazix) 的开源。
