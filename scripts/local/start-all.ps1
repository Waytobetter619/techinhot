# 启动本站全部进程：便携版 PostgreSQL → migrate/seed → 构建网页（如缺）→ api/worker/web/feeder。
# 进程日志写 runtime/logs/，PID 记在 runtime/pids.json（stop-all.ps1 用它停止）。
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root
$runtime = Join-Path $root "runtime"
$pgHome = Join-Path $runtime "pg"
$pgData = Join-Path $runtime "pgdata"
$logs = Join-Path $runtime "logs"
$dbName = "techinhot"
if (-not (Test-Path (Join-Path $root ".env"))) { throw "缺 .env：复制 .env.example 为 .env 并填好必填项（见 docs/deploy-local-windows.md）" }
if (-not (Test-Path (Join-Path $root "node_modules"))) { throw "缺 node_modules：先运行 npm ci" }
if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) { throw "缺数据库：先运行 scripts/local/setup-db.ps1" }

# .env 里补上本机数据库与 api 地址（已写就不动）
$envPath = Join-Path $root ".env"
$envText = Get-Content $envPath -Raw
$append = ""
if ($envText -notmatch "(?m)^\s*DATABASE_URL=") { $append += "DATABASE_URL=postgres://postgres@127.0.0.1:5432/$dbName`n" }
if ($envText -notmatch "(?m)^\s*API_BASE_URL=") { $append += "API_BASE_URL=http://127.0.0.1:3001`n" }
if ($append) { Add-Content $envPath $append; Write-Host "已在 .env 追加：$($append.Trim() -replace "`n", ' / ')" }

# 1. 数据库
$pgCtl = Join-Path $pgHome "bin\pg_ctl.exe"
$pgIsReady = Join-Path $pgHome "bin\pg_isready.exe"
$psql = Join-Path $pgHome "bin\psql.exe"
& $pgCtl -D $pgData status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  New-Item -ItemType Directory -Force -Path $logs | Out-Null
  Write-Host "启动 PostgreSQL…"
  & $pgCtl -D $pgData -l (Join-Path $logs "pg.log") start
  if ($LASTEXITCODE -ne 0) { throw "pg_ctl start 失败，看 runtime/logs/pg.log" }
}
for ($i = 0; $i -lt 30; $i++) {
  & $pgIsReady -h 127.0.0.1 -p 5432 -q
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 1
}
if (& $psql -U postgres -h 127.0.0.1 -p 5432 -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'") {
  Write-Host "数据库 $dbName 已存在"
} else {
  Write-Host "创建数据库 $dbName"
  & $psql -U postgres -h 127.0.0.1 -p 5432 -c "CREATE DATABASE $dbName"
  if ($LASTEXITCODE -ne 0) { throw "建库失败" }
}

# 2. 迁移与种子（可重复执行；已存在的信源不会被覆盖）
Write-Host "执行数据库迁移…"
node --env-file=.env scripts/migrate.ts
if ($LASTEXITCODE -ne 0) { throw "migrate 失败" }
Write-Host "导入种子数据…"
node --env-file=.env scripts/seed.ts
if ($LASTEXITCODE -ne 0) { throw "seed 失败" }

# 3. 网页构建产物（缺失时构建一次）
if (-not (Test-Path (Join-Path $root "apps\web\build"))) {
  Write-Host "构建网页（首次较慢）…"
  npm run build -w @aihot/web
  if ($LASTEXITCODE -ne 0) { throw "网页构建失败" }
}

# 4. 启动四个进程
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$env:NODE_ENV = "production"
$procs = @(
  @{ name = "api";    cwd = $root;            args = @("--env-file=.env", "apps/api/src/main.ts") },
  @{ name = "worker"; cwd = $root;            args = @("--env-file=.env", "apps/worker/src/main.ts") },
  @{ name = "web";    cwd = "$root\apps\web"; args = @("--env-file=../../.env", "server.ts") },
  @{ name = "feeder"; cwd = $root;            args = @("--env-file=.env", "scripts/techin-feeder/techin-feeder.ts") }
)
$state = @()
foreach ($p in $procs) {
  $out = Join-Path $logs "$($p.name).log"
  $err = Join-Path $logs "$($p.name).err.log"
  $proc = Start-Process -FilePath "node" -ArgumentList $p.args -WorkingDirectory $p.cwd `
    -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
  Write-Host ("{0,-6} PID {1}  日志 {2}" -f $p.name, $proc.Id, $out)
  $state += @{ name = $p.name; pid = $proc.Id }
}
$state | ConvertTo-Json | Set-Content (Join-Path $runtime "pids.json")

Write-Host ""
Write-Host "全部启动：网站 http://localhost:3000 · 后台 /admin（密码在 .env 的 ADMIN_PASSWORD）"
