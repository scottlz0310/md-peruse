# WebView2 が使えないときの表示（spec.md 4.4、design-decisions.md 12章）を、環境変数で失敗を再現して確かめる。
#
# 使い方（リポジトリのルートで。Release の exe を作っておく）:
#   scripts/devtools/webview2-failure.ps1 -Case missing        # Runtime が見つからない
#   scripts/devtools/webview2-failure.ps1 -Case userdata       # 利用者データのフォルダーを使えない
#   scripts/devtools/webview2-failure.ps1 -Case missing -DismissDialogs   # 出たダイアログを順に閉じて、終了まで確かめる
#
# 期待する挙動: WebView2 や wry が先に出すダイアログの後に、UI 言語の案内（公式の修復先と失敗の内容つき）が出て、
# 閉じるとプロセスが終了する。ダイアログの文言は、UI Automation で読み取って表示する。
# 設定ファイルは退避して戻す。WebView2 自身のダイアログを出したプロセスは、アプリ本体を止めても残るため、止める。
param(
  [Parameter(Mandatory)][ValidateSet('missing', 'userdata')][string]$Case,
  [switch]$DismissDialogs,
  [int]$WaitSeconds = 8,
  [string]$Exe = ''
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not $Exe) { $Exe = Join-Path $repo 'src-tauri\target\release\md-peruse.exe' }
$settings = Join-Path $env:APPDATA 'com.scottlz0310.md-peruse\settings.json'
$backup = Join-Path ([IO.Path]::GetTempPath()) 'md-peruse-settings.before-wv2.json'
if (Get-Process md-peruse -ErrorAction SilentlyContinue) { throw 'md-peruse が起動している' }

$variable, $value = switch ($Case) {
  'missing' { 'WEBVIEW2_BROWSER_EXECUTABLE_FOLDER', (Join-Path ([IO.Path]::GetTempPath()) 'md-peruse-no-webview2') }
  'userdata' { 'WEBVIEW2_USER_DATA_FOLDER', (Join-Path $env:SystemRoot 'notepad.exe') }
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Namespace Native -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
'@

Copy-Item -LiteralPath $settings -Destination $backup -Force
$before = (Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash
try {
  Set-Item -Path "env:$variable" -Value $value
  $app = Start-Process -FilePath $Exe -WorkingDirectory $repo -PassThru
  Remove-Item "env:$variable"
  "起動した pid=$($app.Id)（$variable=$value）"
  $exited = $app.WaitForExit($WaitSeconds * 1000)
  if ($exited) { "$WaitSeconds 秒以内に終了した: code=0x$('{0:X}' -f $app.ExitCode)" }
  else {
    foreach ($process in Get-Process | Where-Object { $_.MainWindowTitle -and $_.ProcessName -match 'md-peruse|msedgewebview2' }) {
      "ウィンドウ: $($process.ProcessName) [$($process.MainWindowTitle)]"
      $root = [Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
      foreach ($element in $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition)) {
        if ($element.Current.Name.Length -gt 1) { "  文言: $($element.Current.Name -replace '\s+', ' ')" }
      }
    }
    if ($DismissDialogs) {
      # 先に出る WebView2 / wry のダイアログ、次に md-peruse の案内。`BM_CLICK` で閉じる。
      foreach ($pair in @(@('', 'データ ディレクトリを作成できませんでした'), @('#32770', 'Error'), @('#32770', 'md-peruse'))) {
        $class = if ($pair[0]) { $pair[0] } else { [NullString]::Value }   # PowerShell の $null は空文字になる
        for ($i = 0; $i -lt 10; $i++) {
          $dialog = [Native.Win]::FindWindow($class, $pair[1])
          if ($dialog -ne [IntPtr]::Zero) {
            # 既定のボタン（OK）を、`BM_CLICK` で押す。ボタンが見つからなければ、`WM_COMMAND` の `IDOK` を送る。
            $button = [Native.Win]::FindWindowEx($dialog, [IntPtr]::Zero, 'Button', [NullString]::Value)
            if ($button -ne [IntPtr]::Zero) { [void][Native.Win]::PostMessage($button, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero) }
            else { [void][Native.Win]::PostMessage($dialog, 0x0111, [IntPtr]1, [IntPtr]::Zero) }
            "閉じた: [$($pair[1])]"
            Start-Sleep -Seconds 2
            break
          }
          Start-Sleep -Milliseconds 500
        }
      }
      if ($app.WaitForExit(5000)) { "案内を閉じた後に終了した: code=$($app.ExitCode)" } else { '案内を閉じても終了しなかった' }
    }
  }
}
finally {
  Get-Process md-peruse -ErrorAction SilentlyContinue | Stop-Process -Force
  Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'msedgewebview2.exe' -and $_.CommandLine -match 'md-peruse' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800
  Copy-Item -LiteralPath $backup -Destination $settings -Force
  "設定を戻した: $((Get-FileHash -LiteralPath $settings -Algorithm SHA256).Hash -eq $before)"
}
