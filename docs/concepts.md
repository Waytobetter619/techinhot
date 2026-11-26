# 概念与命名

第一次读代码先读这一页。同一个东西在代码、数据库和页面上叫法不一样，下面每个概念给出它在三处的名字。

## 一条内容从进站到上页面

```
信源 source ──抓取──▶ 资料 article ──判断与写作──▶ 分析 analysis ──发布──▶ 公开记录 publication
                                                                      │
                                         归组：报道 → 事实 fact → 事件 story ◀┘
                                                                      │
                                       日报 / 周报 / 月报 report ◀──挑选──┘
```

| 概念 | 代码 / 数据库 | 页面上叫 | 是什么 |
|---|---|---|---|
| 信源 | `sources` | 信源 | 一个被抓取的来源：订阅源、网页列表、X 查询、公众号、外部推送。带分级 `tier` 和参与方式 `participation_mode` |
| 资料 | `articles` | （不直接出现） | 抓到的一篇原始内容：网址、原标题、正文、发布时间。只增改，不判断 |
| 分析 | `analyses` | （不直接出现） | 模型对一篇资料的判断与写作：中文标题和摘要、分类、标签、两次独立评分 |
| 公开记录 | `publications` | 一条动态 | 一篇资料此刻能不能公开、怎么公开：`visibility`、`eligible`、`selected`、分数、发布时间。所有公开出口都只读这张表（经 `packages/backend/src/publication/`） |
| 报道 | `fact_articles` 的一行 | 一篇报道 | 一篇资料作为某件事的证据，角色是 `primary`（一手原文）、`report`（转述报道）或 `mention`（顺带提到） |
| 事实 | `facts` | （卡片） | “同一次发生”：同一次发布、同一个裁决。多篇报道指向同一事实时合成一张卡片 |
| 事件 | `stories` | 事件 | 一件事的全部进展：多个事实（发布 → 上架 → 回应）。有热度、综述和脉络 |
| 热度信号 | `story_signals` | 热度 | 谁在讨论这个事件。`hot_signal` 信源只贡献这里，不单独展示 |
| 日报 / 周报 / 月报 | `reports`、`packages/backend/src/reports/` | 日报、周报、月报 | 按时间窗挑选和撰写的期刊 |

## 命名约定

- **article** 指一篇内容（资料、报道）。**report** 只指日报、周报、月报。历史上 report 两种意思都用过，事件归组代码（`stories/`）的注释和少数变量里，report 仍表示“一篇报道”；新代码一律用 article。数据库里 `stories.first_report_at`、`fact_articles.role = 'report'` 属于这类旧叫法，在线迁移不允许改列名，所以保留。
- **story** 指事件。代码目录是 `packages/backend/src/stories/`；后台任务名仍叫 `events.group`、`events.digest`（队列名会写进数据库，保持不变）。
- `stories/relation.ts`：判断一篇报道和候选事实是什么关系（四种关系、提示词、阈值）。`stories/story-links.ts`：两个事件之间的“相关事件”链接。
- **item** 是公开接口、RSS 和网页里的一条动态，对应一条公开记录。

## 一条动态出现在哪里

| 条件 | 字段 | 定义在 |
|---|---|---|
| 公开 | `publications.visibility = 'public'` | 管理员可撤回（`withdrawn`）或只露摘要 |
| 进“全部动态” | `eligible`，且分数不低于 `SELECTION.browseFloor` | `publication/scope.ts` 的 `browsedCondition` |
| 进精选 | `selected`，且到了 `visible_after` | `publication/publish.ts` 判定、`publication/scope.ts` 读取；门槛见 [精选与校准](selection.md) |
| 进事件页 | 信源 `participation_mode = 'editorial'` | `publication/scope.ts` 的 `storyArticleCondition` |
| 只算热度 | 信源 `participation_mode = 'hot_signal'` | 写进 `story_signals`，不单独展示 |
| 完全不公开 | 信源 `participation_mode = 'isolated'` | 只在后台可见 |

分级 `tier` 决定精选门槛：`T1` 官方一手、`T1_5` 官方账号与准官方创作者、`T2` 媒体与个人、`EXCLUDE_MP` 不参与精选（[信源](sources.md)）。

## 本站自己加的

- [订阅与提醒](subscriptions.md)：按主题、分类、信源、关键词组装订阅网址，以及后台关注清单的飞书和微信提醒（`packages/backend/src/watch/`）。
- [自建 RSSHub](rsshub.md)：B站、小红书博主转成订阅源。
- 口径：AI 加科技地缘（`industry/`）。
