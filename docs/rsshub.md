# 用自建 RSSHub 订阅 B站、小红书博主

B站 UP 主和小红书博主没有 RSS。本站在 `docker-compose.override.yml` 里自带一个 [RSSHub](https://docs.rsshub.app)，把它们的投稿变成订阅源，再作为普通的 `rss` 信源接进来。框架抓内网服务的规则见 [信源](sources.md)（`PRIVATE_FEED_HOSTS`）。

## 先知道这几点

- **B站基本可用，小红书不稳定。** B站的 UP 主投稿路由要一个登录 Cookie（只要 `SESSDATA`），服务器是数据中心 IP，偶尔会被风控（HTTP 412）。小红书反爬严得多，数据中心 IP 常被直接拦，Cookie 几天就可能失效，要做好它时好时坏的准备。
- **Cookie 用小号。** Cookie 就是那个账号的登录状态，被平台风控时受影响的是这个账号。
- **抓取间隔放长。** B站 3 小时一次、小红书 6 小时一次就够了；请求越密越容易被拦。RSSHub 自己也缓存 30 分钟。
- **内容只有标题和简介。** 视频不会转成文字，模型只能根据标题和简介判断，所以这类信源大多进“全部动态”，只有标题和简介写得清楚的才会进精选。

## 1. 填 Cookie

```bash
cd /root/techinhot
cp .env.rsshub.example .env.rsshub
nano .env.rsshub        # 按文件里的说明填 B站（和小红书）的 Cookie
```

## 2. 让站点允许抓 RSSHub

`.env` 里加一行（已有就改成这样）：

```bash
grep -q '^PRIVATE_FEED_HOSTS=' .env && sed -i 's|^PRIVATE_FEED_HOSTS=.*|PRIVATE_FEED_HOSTS=rsshub|' .env || echo 'PRIVATE_FEED_HOSTS=rsshub' >> .env
```

## 3. 启动 RSSHub、重启 api 和 worker

```bash
git pull
docker compose up -d rsshub
docker compose up -d api worker
```

## 4. 先在服务器上试路由

把 `<uid>` 换成 UP 主的 uid（`space.bilibili.com/` 后面那串数字），`<用户id>` 换成小红书博主主页网址 `xiaohongshu.com/user/profile/` 后面那 24 位：

```bash
docker compose exec api node -e 'fetch("http://rsshub:1200/bilibili/user/video/<uid>").then(r=>r.text()).then(t=>console.log(t.slice(0,800)))'
docker compose exec api node -e 'fetch("http://rsshub:1200/xiaohongshu/user/<用户id>/notes").then(r=>r.text()).then(t=>console.log(t.slice(0,800)))'
```

看到 `<rss` 开头、里面有 `<item>`，就是通了。看到报错时：`412` 或“风控”是 B站拦了，补 `BILIBILI_DM_IMG_LIST` 或换个 Cookie；小红书报错多半是 Cookie 失效或 IP 被拦。具体路由和参数以 RSSHub 文档为准，`docker compose logs --tail 50 rsshub` 能看到详细原因。

## 5. 在后台加信源

后台“信源 → 新建”：

| 项 | 填写 |
|---|---|
| 类型 | `rss` |
| 订阅地址 | `http://rsshub:1200/bilibili/user/video/<uid>` 或 `http://rsshub:1200/xiaohongshu/user/<用户id>/notes` |
| 名称 | 例如“某某（B站）” |
| 分级 | 一般 `T2`；你特别信得过的博主用 `T1_5` |
| 抓取间隔 | B站 `180` 分钟，小红书 `360` 分钟 |

保存前点“预览抓取”，能列出最近几条就可以保存。
