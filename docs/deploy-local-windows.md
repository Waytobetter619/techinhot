# 本地部署（Windows 原生，不用 Docker / WSL2）

框架官方文档 [deploy.md](deploy.md) 的非 Docker 路径面向 Linux/macOS；本站按 Windows 原生方式部署：
**便携版 PostgreSQL 17（免安装、免管理员权限）+ Node 三进程 + feeder**。所有运行产物在 `runtime/`（已 gitignore），不动系统目录。

## 一次性准备

1. **依赖**：Node.js ≥ 24.22 在 PATH 里，然后：
   ```powershell
   npm ci
   ```
2. **配置**：复制 `.env.example` 为 `.env`，必填：
   - `ADMIN_PASSWORD`（≥12 位，登录 `/admin`）
   - `SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`（各一串随机字符，`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` 生成两次）
   - `LLM_API_KEY`（+ 对应服务商的 `LLM_BASE_URL`/`LLM_MODEL`，见 `.env.example` 注释）
   - `TECHIN_TOKEN`（feeder 用，选填——不填则 Techin 舆情不入站）
   - `INGEST_TOKEN`（≥16 位，feeder 推送凭证）
   - `EGRESS_PROXY_URL=http://127.0.0.1:7890`（抓海外信源走代理；代理不在 7890 就改）
   - 数据库与 api 地址（脚本会自动写入，也可手工）：
     ```dotenv
     DATABASE_URL=postgres://postgres@127.0.0.1:5432/techinhot
     API_BASE_URL=http://127.0.0.1:3001
     ```
3. **数据库**（下载约 360 MB，走代理；已初始化过就跳过）：
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/local/setup-db.ps1
   ```

## 启动 / 停止

```powershell
powershell -ExecutionPolicy Bypass -File scripts/local/start-all.ps1
powershell -ExecutionPolicy Bypass -File scripts/local/stop-all.ps1
```

启动后：网站 http://localhost:3000 · 后台 http://localhost:3000/admin · 日志在 `runtime/logs/`。

首次启动要做的三件事：

1. 初始化库表和示范信源（`start-all.ps1` 自动执行 migrate + seed，只在库空时跑）；
2. `npm run build -w @aihot/web` 构建网页产物（脚本会检测缺失时自动构建）；
3. 打开后台「信源」页确认 18 个信源抓取正常；Techin 舆情等 feeder 第一轮推送后出现。

## 日常运维

| 事项 | 做法 |
|---|---|
| 看日志 | `runtime/logs/api.log`、`worker.log`、`web.log`、`feeder.log`、`pg.log` |
| 填模型 key | 编辑 `.env` → `stop-all` → `start-all`（三个进程都读 `.env`，重启生效） |
| 调 Techin 口径 | `.env` 的 `TECHIN_*` 变量（白名单、每轮上限等，见 `scripts/techin-feeder/README.md`） |
| 暂停某信源 | 后台「信源」页暂停；feeder 推送的 `techin-*` 信源同样在这里管理 |
| 数据备份 | `runtime/pg/bin/pg_dump -U postgres techinhot > backup.sql` |
| 升级框架 | 合并上游 AIHOT 后：stop → `npm ci` → `node --env-file=.env scripts/migrate.ts` → build → start |

## 与 Docker 方式的差异

- 不起容器：五个容器（db/setup/api/worker/web）对应这里的本机 PostgreSQL + migrate/seed + 三个 node 进程；
- `.env` 不需要 `POSTGRES_PASSWORD`（便携库只监听 127.0.0.1、trust 认证，仅供本机使用）；
- `NODE_ENV=production` 由启动脚本统一带上；停止脚本给 worker 留了排空时间。
