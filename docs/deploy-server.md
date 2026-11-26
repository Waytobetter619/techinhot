# 部署到云服务器（Docker）

本站在云服务器上用框架官方的 Docker 方式运行（[deploy.md](deploy.md)）。这里是照着做就能跑起来的步骤，服务器地址用 `<服务器IP>` 表示。

服务器在海外（新加坡等）时抓外网信源不需要代理；在中国大陆时见 [deploy.md 的“在中国大陆的服务器上”](deploy.md#在中国大陆的服务器上)，要配 `EGRESS_PROXY_URL`。建议至少 2 核 4 GB 内存（构建镜像时要用）。

## 1. 装 Docker（只做一次）

以 Ubuntu / Debian 为例，SSH 登录服务器后：

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER   # 之后重新登录一次，就不用每条命令都加 sudo
docker compose version          # 能打印版本号就装好了
```

## 2. 拉代码、生成配置

```bash
git clone -b rebase-upstream-geo https://github.com/Waytobetter619/techinhot.git
cd techinhot
cp .env.example .env
for k in SESSION_SECRET IMG_PROXY_SIGN_SECRET POSTGRES_PASSWORD; do
  sed -i "s|^$k=.*|$k=$(openssl rand -hex 32)|" .env
done
```

然后 `nano .env`，改这几项：

| 项 | 填什么 |
|---|---|
| `SITE_URL` | `http://<服务器IP>:3000`（以后配了域名再改成 `https://你的域名`） |
| `ADMIN_PASSWORD` | 后台密码，至少 12 位 |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 模型接口，写法见文件里的注释 |
| `SOCIALDATA_API_KEY` | X 账号信源要用（重点人物言论都靠它）；不填时 X 信源会在后台标红，其余照常 |
| `MODEL_CALLS_ENABLED`、`COLLECT_ENABLED` | 确认是 `true`（或不写，按 `.env.example` 的默认） |

先别填飞书推送和关注提醒；站点跑稳后再按 [订阅与提醒](subscriptions.md) 配置。B站、小红书博主见 [自建 RSSHub](rsshub.md)。

## 3. 启动

```bash
docker compose up -d --build
docker compose ps                # api、worker、web、db 都是 running，setup 是 exited (0)
docker compose logs -f worker    # 看抓取和模型处理，Ctrl+C 退出
```

在云服务器控制台的防火墙（安全组）里放行 TCP 3000。打开 `http://<服务器IP>:3000`，后台是 `/admin`。

第一次启动会导入 `industry/sources.json` 的示范信源，一两分钟后开始出内容，第一批大约半小时处理完。先到后台“设置 → 付费请求上限”把 SocialData 和模型的预算调到你能接受的数。

## 4. 之后要做的

- **更新代码**：`git pull && docker compose up -d --build`（迁移由 `setup` 自动执行）。
- **备份**：见 [deploy.md 的“备份”](deploy.md#备份)。
- **配域名和 HTTPS**：域名解析到服务器后，`.env` 里设 `SITE_URL=https://域名`、`SITE_DOMAIN=域名`、`PORT=127.0.0.1:3000`、`TRUST_PROXY=true`，再 `docker compose --profile https up -d --build`，然后在安全组里关掉 3000、放行 80 和 443。
- **只给自己看**：配了 HTTPS 后，可以在 `deploy/Caddyfile` 的站点块里加一段登录（密码哈希用 `docker run --rm caddy:2-alpine caddy hash-password` 生成）：

  ```caddyfile
  basic_auth {
  	你的用户名 <上一步生成的哈希>
  }
  ```

  改完 `docker compose --profile https restart caddy`。注意这样 RSS 阅读器和 MCP 客户端也要带账号密码才能读。
