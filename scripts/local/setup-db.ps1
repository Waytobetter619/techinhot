# 一次性准备便携版 PostgreSQL 17：下载 zip（走代理）→ 解压到 runtime/pg → initdb 到 runtime/pgdata。
# 已初始化过（runtime/pgdata/PG_VERSION 存在）就什么都不做。免管理员权限，全部落在本仓库 runtime/ 下。
$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtime = Join-Path $root "runtime"
$pgHome = Join-Path $runtime "pg"
$pgData = Join-Path $runtime "pgdata"
$proxy = $env:TECHINHOT_PROXY
if (-not $proxy) { $proxy = "http://127.0.0.1:7890" }
$version = $env:TECHINHOT_PG_VERSION
if (-not $version) { $version = "17.6-1" }

if (Test-Path (Join-Path $pgData "PG_VERSION")) {
  Write-Host "runtime/pgdata 已初始化，跳过（删除 runtime/pgdata 可重建）"
  exit 0
}

New-Item -ItemType Directory -Force -Path $runtime | Out-Null

if (-not (Test-Path (Join-Path $pgHome "bin\pg_ctl.exe"))) {
  $zip = Join-Path $runtime "postgresql-$version-windows-x64-binaries.zip"
  if (-not (Test-Path $zip)) {
    $url = "https://get.enterprisedb.com/postgresql/postgresql-$version-windows-x64-binaries.zip"
    Write-Host "下载 $url（走代理 $proxy，约 360MB，耐心等）"
    Invoke-WebRequest -Uri $url -OutFile $zip -Proxy $proxy -UseBasicParsing
  }
  Write-Host "解压到 $runtime"
  Expand-Archive -Path $zip -DestinationPath $runtime -Force
  # zip 顶层目录可能是 pgsql 或 postgresql-17.x；统一挪成 runtime/pg
  $inner = Get-ChildItem $runtime -Directory | Where-Object { $_.Name -eq "pgsql" -or $_.Name -like "postgresql-*" } | Select-Object -First 1
  if ($inner) { Move-Item $inner.FullName $pgHome -Force }
  if (-not (Test-Path (Join-Path $pgHome "bin\pg_ctl.exe"))) { throw "解压后没找到 pg_ctl.exe，检查 zip 内容" }
}

Write-Host "initdb → $pgData（trust 认证，只监听本机）"
& (Join-Path $pgHome "bin\initdb.exe") -D $pgData -U postgres -E UTF8 -A trust --locale=C --no-instructions
if ($LASTEXITCODE -ne 0) { throw "initdb 失败" }

Write-Host "完成。接下来运行 scripts/local/start-all.ps1 启动数据库和站点。"
