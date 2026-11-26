# 订阅与提醒

按自己关心的东西接收动态，分两层，用的是同一套条件：

| 层 | 是什么 | 要账号吗 | 在哪 |
|---|---|---|---|
| 订阅地址 | 条件写进一个 RSS 地址，放进任何阅读器或飞书 RSS 机器人 | 不要 | 前台 `/watch`（“我的 → 按条件订阅”） |
| 关注提醒 | 后台存规则，命中的新动态推到你自己的飞书群、企业微信群或微信 | 只有管理员 | 后台“关注提醒” |

代码：条件和查询在 `packages/backend/src/publication/watch.ts`（公开读取层），订阅地址在 `publication/feeds.ts` 的 `watchFeed`，规则、推送和定时任务在 `packages/backend/src/watch/`。

## 条件

| 参数 | 含义 | 例子 |
|---|---|---|
| `topic` | 主题（`industry/topics.json` 的 slug），和主题页同一规则 | `topic=export-controls` |
| `category` | 分类（公开分类的 key） | `category=geopolitics` |
| `source` | 信源 ID（后台“信源”页） | `source=x-sama` |
| `q` | 关键词，空格分开的词要同时出现，和站内搜索同一规则 | `q=英伟达 出口` |
| `level` | `selected`（默认，只要精选）或 `all`（全部动态） | `level=all` |

同一个参数可以重复或用逗号分开，表示“任一”；不同参数之间是“同时满足”。至少要有一个主题、分类、信源或关键词；什么都不限时直接订阅 `/feed.xml`。只看最近 7 天，订阅地址列最新 50 条。

```
https://你的域名/feed/watch.xml?topic=export-controls&topic=chips-compute&q=英伟达
```

## 关注提醒

后台“关注提醒 → 新建规则”：选条件、频率和渠道，先点“预览命中”看看会推什么，保存后点“发一条测试”确认渠道能收到。

- **保存时不补推**：保存那一刻已经符合条件的内容记为已处理，之后的新动态才推。改了条件也一样从改的那一刻算起。
- **同一件事只推一次**：几家媒体报道同一个事实，只算一条。
- **频率**：“有新动态就推”每 5 分钟检查一次，一次最多列 10 条；“每日汇总”每天北京时间 8:07 推一次，最多列 20 条。
- **推送失败不重试**：每次推送的结果（已送达、被拒绝、未确认、未发出）记在规则那一行，鼠标停在状态上能看到渠道的原话。

### 配置渠道

`.env` 里填好后重启 worker：

```bash
WATCH_PUSH_ENABLED=true                      # 关着时照常匹配，推送记为“未发出”
WATCH_FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/…
WATCH_WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…
WATCH_SERVERCHAN_SENDKEY=SCT…
```

- **飞书群**：群设置 → 群机器人 → 添加机器人 → 自定义机器人，复制 webhook 地址。安全设置不要开“签名校验”（目前不支持）；要限制来源可以用“IP 白名单”填服务器 IP。
- **企业微信群**：群聊 → 添加群机器人，复制 webhook 地址。消息出现在企业微信里。
- **微信（Server酱）**：在 sct.ftqq.com 用微信扫码登录，复制 SendKey；消息经它的服务号推到你自己的微信。免费版每天条数有限，建议配“每日汇总”。

## 以后要做多用户（L2）

现在的规则属于站点管理员。要让读者各自订阅时：规则加上所属用户，登录用邮箱验证码，个人页面由订阅地址拼出来（不让个性化内容进公开页面的缓存），推送按人分发并支持退订。条件、匹配和推送这三层都不用改。
