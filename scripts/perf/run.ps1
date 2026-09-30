# 設定を退避し、最後のワークスペースを測定用へ向け、Release の exe を CDP 付きで起動して、
# 指定した bun のスクリプトを実行する。終了後にアプリを止め、設定をバイト単位で戻してハッシュで確かめる。
#
# 使い方（リポジトリのルートで）:
#   bun scripts/perf/gen-workspace.ts $env:TEMP\md-peruse-ws
#   bun run tauri build --no-bundle
#   scripts/perf/run.ps1 -Workspace $env:TEMP\md-peruse-ws -Script scripts/perf/measure.ts -ScriptArgs '--only','switch'
#
# -Affinity（16進のマスク）は、アプリと WebView2 のプロセスの実行先を固定する。高性能コアと効率コアが
# 混在する CPU で、外れ値の原因を調べるときに使う（Core i7-12700K なら、Pコア 0xFFFF、Eコア 0xF0000）。
# -BrowserArgs は、WebView2 へ足す引数である（`--remote-debugging-port=9222` は既定）。
param(
  [Parameter(Mandatory)][string]$Workspace,
  [Parameter(Mandatory)][string]$Script,
  [string[]]$ScriptArgs = @(),
  [string]$Affinity = '',
  [string]$BrowserArgs = '--remote-debugging-port=9222',
  [string]$Exe = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Exe) { $Exe = Join-Path $repo 'src-tauri\target\release\md-peruse.exe' }
$settings = Join-Path $env:APPDATA 'com.scottlz0310.md-peruse\settings.json'
$backup = Join-Path ([IO.Path]::GetTempPath()) 'md-peruse-settings.before-perf.json'

if (Get-Process md-peruse -ErrorAction SilentlyContinue) { throw 'md-peruse が起動している' }
Copy-Item -LiteralPath $settings -Destination $backup -Force
$before = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash
"設定を退避した sha256=$before"

try {
  $json = Get-Content -LiteralPath $backup -Raw -Encoding utf8 | ConvertFrom-Json
  $json.lastWorkspace = (Resolve-Path $Workspace).Path
  $json.recentFolders = @()
  [IO.File]::WriteAllText($settings, ($json | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))

  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $BrowserArgs
  $app = Start-Process -FilePath $Exe -WorkingDirectory $repo -PassThru
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
  "起動した pid=$($app.Id)"
  if ($Affinity) {
    Start-Sleep -Seconds 8
    $mask = [IntPtr][Convert]::ToInt64($Affinity, 16)
    $targets = Get-CimInstance Win32_Process | Where-Object {
      $_.Name -eq 'md-peruse.exe' -or ($_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'md-peruse')
    }
    foreach ($target in $targets) { (Get-Process -Id $target.ProcessId).ProcessorAffinity = $mask }
    "実行先を 0x$Affinity へ固定した（$(@($targets).Count) プロセス）"
  }
  $bunArgs = @((Join-Path $repo $Script), '--ws', (Resolve-Path $Workspace).Path) + $ScriptArgs
  & bun @bunArgs
  "スクリプトの終了コード=$LASTEXITCODE"
}
finally {
  Get-Process md-peruse -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 800
  # WebView2 自身のダイアログを出したプロセスは、アプリ本体を止めても残る。
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'md-peruse' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Copy-Item -LiteralPath $backup -Destination $settings -Force
  $after = (Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash
  "設定を戻した: $($after -eq $before)"
}
