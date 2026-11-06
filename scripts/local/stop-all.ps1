# 停止 start-all.ps1 启动的进程：web/api/feeder 直接停，worker 先温和停（给队列排空留时间），最后停数据库。
$ErrorActionPreference = "SilentlyContinue"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$runtime = Join-Path $root "runtime"
$pgData = Join-Path $runtime "pgdata"
$pidFile = Join-Path $runtime "pids.json"

if (Test-Path $pidFile) {
  $state = Get-Content $pidFile -Raw | ConvertFrom-Json
  foreach ($p in $state) {
    $proc = Get-Process -Id $p.pid -ErrorAction SilentlyContinue
    if (-not $proc) { Write-Host ("{0,-6} 已不在运行" -f $p.name); continue }
    if ($p.name -eq "worker") {
      # 温和停止：先关窗口消息，等最多 20s；worker 排空队列最长要几分钟，本机使用强停即可接受，
      # 被中断的调用结果不明，框架会在约半小时后自动放行重试。
      taskkill /PID $p.pid | Out-Null
      $deadline = (Get-Date).AddSeconds(20)
      while ((Get-Process -Id $p.pid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
      if (Get-Process -Id $p.pid -ErrorAction SilentlyContinue) { Stop-Process -Id $p.pid -Force }
    } else {
      Stop-Process -Id $p.pid -Force
    }
    Write-Host ("{0,-6} 已停止 (PID {1})" -f $p.name, $p.pid)
  }
  Remove-Item $pidFile -Force
} else {
  Write-Host "没有 runtime/pids.json（可能不是 start-all.ps1 启动的）；按名字停 node 进程请手工处理"
}

$pgCtl = Join-Path $runtime "pg\bin\pg_ctl.exe"
if (Test-Path $pgCtl) {
  & $pgCtl -D $pgData stop -m fast
  if ($LASTEXITCODE -eq 0) { Write-Host "PostgreSQL 已停止" } else { Write-Host "PostgreSQL 未在运行" }
}
