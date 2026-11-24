# 看站点当前状态（只读）：按命令行找出站点的四个进程（不依赖 runtime/pids.json），再探接口健康和网页响应。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/local/status.ps1
$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$patterns = [ordered]@{
  api    = "apps[/\\]api[/\\]src[/\\]main\.ts"
  worker = "apps[/\\]worker[/\\]src[/\\]main\.ts"
  web    = "server\.ts"
  feeder = "techin-feeder[/\\]techin-feeder\.ts"
}
$nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
$found = @{}
foreach ($p in $nodes) {
  foreach ($k in $patterns.Keys) {
    if ($p.CommandLine -match $patterns[$k]) { $list = @(); if ($found[$k]) { $list = @($found[$k]) }; $found[$k] = $list + $p.ProcessId }
  }
}
# pids.json 记的是启动时的编号；两者对照着看。
$recorded = @{}
if (Test-Path (Join-Path $PSScriptRoot "..\..\runtime\pids.json")) {
  $parsed = Get-Content (Join-Path $PSScriptRoot "..\..\runtime\pids.json") -Raw | ConvertFrom-Json
  foreach ($e in ($parsed | ForEach-Object { $_ })) { if ($e -is [System.Array]) { foreach ($x in $e) { $recorded[[string]$x.name] = $x.pid } } else { $recorded[[string]$e.name] = $e.pid } }
}
foreach ($k in $patterns.Keys) {
  $running = if ($found[$k]) { ($found[$k] -join ",") } else { "未运行" }
  Write-Host ("{0,-7} 运行中 PID: {1,-14} 记录文件里的 PID: {2}" -f $k, $running, $recorded[$k])
}
try { Write-Host ("接口     " + (Invoke-WebRequest -Uri "http://127.0.0.1:3001/api/health" -TimeoutSec 8 -UseBasicParsing).Content) } catch { Write-Host "接口     无响应" }
try { $r = Invoke-WebRequest -Uri "http://localhost:3000" -TimeoutSec 10 -UseBasicParsing; Write-Host ("网页     HTTP " + $r.StatusCode) } catch { Write-Host "网页     无响应" }
Write-Host ("数据库   " + $(if (Test-NetConnection 127.0.0.1 -Port 5432 -InformationLevel Quiet -WarningAction SilentlyContinue) { "在运行" } else { "未运行" }))
