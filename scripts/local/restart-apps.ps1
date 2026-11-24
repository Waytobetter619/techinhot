# 只重启站点进程（默认 api、worker、web），不动数据库。
# 改了 site/ 或 industry/ 下的配置并重新构建网页后用它让配置生效。
# 用法：powershell -ExecutionPolicy Bypass -File scripts/local/restart-apps.ps1 [-Names api,worker] [-DryRun]
#   -Names  要重启的进程，逗号分隔；不带则重启 api,worker,web
#   -DryRun 只打印将要做什么，不停也不启动任何进程
# 例：powershell -ExecutionPolicy Bypass -File scripts/local/restart-apps.ps1 -Names feeder
param([string]$Names = "api,worker,web", [switch]$DryRun)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$pidFile = Join-Path $root "runtime\pids.json"
$web = Join-Path $root "apps\web"

# 进程名拆成列表。用 -File 调用时逗号会被换成空格，所以两种分隔符都认。
# 注意必须存进另一个变量：带 [string] 类型的参数变量会一直保留类型约束，把列表赋回去会被重新拼成一个字符串。
$targets = @($Names -split "[,\s]+" | ForEach-Object { $_.Trim().ToLower() } | Where-Object { $_ })

# 每个进程的启动参数（与 start-all.ps1 一致）和识别用的命令行片段（web 的命令行不独特，只认记录文件里的编号）
$commands = [ordered]@{
  api    = @{ cwd = $root; args = @("--env-file=.env", "apps/api/src/main.ts");                  match = "apps[/\\]api[/\\]src[/\\]main\.ts" }
  worker = @{ cwd = $root; args = @("--env-file=.env", "apps/worker/src/main.ts");               match = "apps[/\\]worker[/\\]src[/\\]main\.ts" }
  web    = @{ cwd = $web;  args = @("--env-file=../../.env", "server.ts");                       match = $null }
  feeder = @{ cwd = $root; args = @("--env-file=.env", "scripts/techin-feeder/techin-feeder.ts"); match = "techin-feeder[/\\]techin-feeder\.ts" }
}
foreach ($n in $targets) { if (-not $commands.Contains($n)) { throw "不认识的进程名 $n（可选：api、worker、web、feeder）" } }

# 读进程记录：逐条取出并校验。PowerShell 5.1 会把整个 JSON 数组当成一个对象输出，直接包 @() 会得到「只有一个元素的数组」，
# 之后按名字筛选会整体命中——第一版脚本曾因此把记录里的所有进程都停掉。所以这里一层层拆开，并确认每一项都有 name 和整数 pid。
$state = @()
if (Test-Path $pidFile) {
  $parsed = Get-Content $pidFile -Raw | ConvertFrom-Json
  $items = @($parsed | ForEach-Object { if ($_ -is [System.Array]) { $_ } else { ,$_ } } | ForEach-Object { $_ })
  foreach ($e in $items) {
    if ($null -eq $e -or -not ($e.PSObject.Properties.Name -contains "name") -or -not ($e.PSObject.Properties.Name -contains "pid")) { throw "runtime/pids.json 格式不对，无法确认进程身份" }
    if ($e.name -is [System.Array] -or $e.pid -is [System.Array]) { throw "runtime/pids.json 格式不对（name/pid 不应是数组）" }
    $state += [pscustomobject]@{ name = [string]$e.name; pid = [int]$e.pid }
  }
}
$nodes = Get-CimInstance Win32_Process -Filter "Name='node.exe'"

function Find-Running([string]$name) {
  # 记录文件里的编号；以及命令行能唯一识别出来的同名进程（上次没正常退出的）。
  $ids = @()
  $rec = @($state | Where-Object { $_.name -eq $name })
  if ($rec.Count -gt 1) { throw "runtime/pids.json 里 $name 出现了 $($rec.Count) 次，无法确认是哪一个" }
  if ($rec.Count -eq 1) { $ids += $rec[0].pid }
  $pattern = $commands[$name].match
  if ($pattern) { $ids += @($nodes | Where-Object { $_.CommandLine -match $pattern } | ForEach-Object { $_.ProcessId }) }
  $alive = @()
  foreach ($id in (@($ids | Sort-Object -Unique))) { if (Get-Process -Id $id -ErrorAction SilentlyContinue) { $alive += $id } }
  return $alive
}

$env:NODE_ENV = "production"
$started = @{}
foreach ($name in $targets) {
  $running = Find-Running $name
  if ($DryRun) {
    $label = if ($running.Count) { $running -join "," } else { "（无）" }
    Write-Host ("[试运行] {0,-7} 将停止 PID: {1}" -f $name, $label)
    continue
  }
  foreach ($id in $running) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }
}
if ($DryRun) { Write-Host "[试运行] 未停止也未启动任何进程"; exit 0 }

Start-Sleep -Seconds 2
foreach ($name in $targets) {
  $c = $commands[$name]
  $proc = Start-Process -FilePath "node" -ArgumentList $c.args -WorkingDirectory $c.cwd -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $root "runtime\logs\$name.log") -RedirectStandardError (Join-Path $root "runtime\logs\$name.err.log") -PassThru
  Start-Sleep -Seconds 3
  if (-not (Get-Process -Id $proc.Id -ErrorAction SilentlyContinue)) { throw "$name 启动后立即退出，看 runtime\logs\$name.err.log" }
  $started[$name] = $proc.Id
  Write-Host ("{0,-7} 已重启，PID {1}，日志 runtime\logs\{0}.log" -f $name, $proc.Id)
}

# 把新编号写回记录文件：只改本次重启的进程，其余条目原样保留。
$out = @()
foreach ($name in $commands.Keys) {
  if ($started.ContainsKey($name)) { $out += [ordered]@{ name = $name; pid = $started[$name] } }
  else { $rec = @($state | Where-Object { $_.name -eq $name }); if ($rec.Count -eq 1) { $out += [ordered]@{ name = $name; pid = $rec[0].pid } } }
}
$out | ConvertTo-Json | Set-Content $pidFile -Encoding UTF8
