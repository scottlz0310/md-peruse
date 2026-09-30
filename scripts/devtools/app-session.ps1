# 実機の確認のために、Release の exe を起動したままにする。設定ファイルは退避し、止めるときに戻す。
#
# 使い方（リポジトリのルートで）:
#   scripts/devtools/app-session.ps1 start -Workspace <フォルダー> [-Cdp]   # 最後のワークスペースを指定して起動
#   ...（実機の操作。windows-mcp などで、ウィンドウを前面に出して操作する）
#   scripts/devtools/app-session.ps1 stop                                   # 止めて、設定をバイト単位で戻す
#
# -Cdp を付けると、WebView2 のリモートデバッグ（9222）を有効にする。`scripts/devtools/inspect.ts` や
# `scripts/perf` の道具は、これに接続する。アプリは、最近使ったフォルダーと幅などを設定へ書くため、
# 利用者の設定を変えないよう、必ず `stop` で戻す。
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('start', 'stop')][string]$Action,
  [string]$Workspace = '',
  [switch]$Cdp,
  [string]$Exe = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$settings = Join-Path $env:APPDATA 'com.scottlz0310.md-peruse\settings.json'
$backup = Join-Path ([IO.Path]::GetTempPath()) 'md-peruse-settings.before-session.json'

if ($Action -eq 'start') {
  if (-not $Exe) { $Exe = Join-Path $repo 'src-tauri\target\release\md-peruse.exe' }
  if (Get-Process md-peruse -ErrorAction SilentlyContinue) { throw 'md-peruse が起動している' }
  Copy-Item -LiteralPath $settings -Destination $backup -Force
  "設定を退避した sha256=$((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash)"
  try {
    if ($Workspace) {
      $json = Get-Content -LiteralPath $backup -Raw -Encoding utf8 | ConvertFrom-Json
      $json.lastWorkspace = (Resolve-Path $Workspace).Path
      $json.recentFolders = @()
      [IO.File]::WriteAllText($settings, ($json | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    }
    if ($Cdp) { $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9222' }
    $app = Start-Process -FilePath $Exe -WorkingDirectory $repo -PassThru
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
    "起動した pid=$($app.Id)"
  }
  catch {
    # 起動に失敗したら、書き換えた設定を戻してから、エラーを伝える。
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $null
    Copy-Item -LiteralPath $backup -Destination $settings -Force
    throw
  }
}
else {
  Get-Process md-peruse -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 800
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'md-peruse' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $before = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash
  Copy-Item -LiteralPath $backup -Destination $settings -Force
  "設定を戻した: $((Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -eq $before)"
}
