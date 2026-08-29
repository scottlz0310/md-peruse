#Requires -Version 7

<#
.SYNOPSIS
    指定したアーキテクチャのReleaseビルドからMSIXパッケージを生成する。

.DESCRIPTION
    Tauri CLIはMSIXを生成しないため、Releaseビルドの成果物からパッケージレイアウトを
    組み立て、winapp CLIでMSIX化する。Package.appxmanifest は
    packaging/Package.appxmanifest.template から生成し、ProcessorArchitecture と
    Version を実際の値へ置換する。

.PARAMETER Architecture
    パッケージ対象のアーキテクチャ。x64 または arm64。

.PARAMETER SkipBuild
    Releaseビルドを省略し、既存の成果物からパッケージだけを作り直す。

.PARAMETER Sign
    生成したMSIXを開発用自己署名証明書で署名する。証明書がなければ生成する。
    署名した証明書は Store 配布には使えない。ローカル検証とWACK専用。

.EXAMPLE
    ./scripts/build-msix.ps1 -Architecture x64 -Sign
#>

[CmdletBinding()]
param(
    [ValidateSet('x64', 'arm64')]
    [string]$Architecture = 'x64',

    [switch]$SkipBuild,

    [switch]$Sign,

    [string]$CertPath = 'devcert.pfx'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$rustTarget = @{ x64 = 'x86_64-pc-windows-msvc'; arm64 = 'aarch64-pc-windows-msvc' }[$Architecture]

# winapp CLI のバージョンはここを正本として固定する。マニフェスト検証、PRI生成、署名の
# 挙動がバージョンで変わり得るため、生成経路では常に同じバージョンを使う。
# 更新するときは docs/design-decisions.md 4.10 と README.md も併せて変更すること。
$requiredWinappVersion = '0.6.1'

if (-not (Get-Command winapp -ErrorAction SilentlyContinue)) {
    throw "winapp CLI が見つかりません。'winget install --id Microsoft.WinAppCli --version $requiredWinappVersion --exact' で導入してください。"
}

$winappVersion = (& winapp --version 2>&1 | Out-String).Trim()
if ($winappVersion -ne $requiredWinappVersion) {
    throw "winapp CLI のバージョンが一致しません。期待値 $requiredWinappVersion、実際 '$winappVersion'。'winget install --id Microsoft.WinAppCli --version $requiredWinappVersion --exact' で固定してください。"
}

# 開発用証明書のパスワード。ローカル検証専用のため既定値は winapp CLI に合わせる。
# 値を変えたい場合は MDPERUSE_DEV_CERT_PASSWORD で渡す。
$certPassword = if ($env:MDPERUSE_DEV_CERT_PASSWORD) { $env:MDPERUSE_DEV_CERT_PASSWORD } else { 'password' }

# Package Version は MAJOR.MINOR.PATCH.0。第4要素は Store の予約により常に 0 とする。
$tauriConfig = Get-Content (Join-Path $repoRoot 'src-tauri/tauri.conf.json') -Raw | ConvertFrom-Json
$packageVersion = "$($tauriConfig.version).0"

Write-Host "md-peruse $packageVersion / $Architecture ($rustTarget)"

if (-not $SkipBuild) {
    Write-Host '==> Release ビルド'
    Push-Location $repoRoot
    try {
        bun run tauri build --target $rustTarget
        if ($LASTEXITCODE -ne 0) { throw "tauri build が失敗しました (exit $LASTEXITCODE)" }
    }
    finally {
        Pop-Location
    }
}

$executable = Join-Path $repoRoot "src-tauri/target/$rustTarget/release/md-peruse.exe"
if (-not (Test-Path $executable)) {
    throw "実行ファイルが見つかりません: $executable"
}

Write-Host '==> パッケージレイアウトの作成'
$layout = Join-Path $repoRoot "build/msix/$Architecture"
if (Test-Path $layout) { Remove-Item $layout -Recurse -Force }
New-Item -ItemType Directory -Path $layout -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $layout 'Images') -Force | Out-Null

Copy-Item $executable -Destination $layout

# マニフェストが参照する visual asset のみを配置する。
$iconSource = Join-Path $repoRoot 'src-tauri/icons'
foreach ($logo in @('StoreLogo.png', 'Square44x44Logo.png', 'Square71x71Logo.png', 'Square150x150Logo.png', 'Square310x310Logo.png')) {
    $path = Join-Path $iconSource $logo
    if (-not (Test-Path $path)) { throw "アイコンが見つかりません: $path" }
    Copy-Item $path -Destination (Join-Path $layout 'Images')
}

# 横長タイルは `tauri icon` の生成対象外のため、ここで原本から直接生成する。
# 生成物をリポジトリへ置かないことで、原本を更新したあとに生成を忘れて
# 古いロゴを梱包する経路をなくす。
& (Join-Path $PSScriptRoot 'generate-wide-logo.ps1') -OutputPath (Join-Path $layout 'Images/Wide310x150Logo.png')

$manifest = Get-Content (Join-Path $repoRoot 'packaging/Package.appxmanifest.template') -Raw
$manifest = $manifest.Replace('__PACKAGE_VERSION__', $packageVersion).Replace('__PROCESSOR_ARCHITECTURE__', $Architecture)
$manifestPath = Join-Path $layout 'Package.appxmanifest'
Set-Content -Path $manifestPath -Value $manifest -Encoding utf8NoBOM

Write-Host '==> MSIX の生成'
$output = Join-Path $repoRoot "build/msix/md-peruse_${packageVersion}_${Architecture}.msix"
$packageArgs = @($layout, '--manifest', $manifestPath, '--output', $output)

if ($Sign) {
    $certFullPath = if ([System.IO.Path]::IsPathRooted($CertPath)) { $CertPath } else { Join-Path $repoRoot $CertPath }
    if (-not (Test-Path $certFullPath)) {
        Write-Host "==> 開発用証明書の生成: $certFullPath"
        winapp cert generate --manifest $manifestPath --output $certFullPath --password $certPassword
        if ($LASTEXITCODE -ne 0) { throw "証明書の生成が失敗しました (exit $LASTEXITCODE)" }
    }
    $packageArgs += @('--cert', $certFullPath, '--cert-password', $certPassword)
}

winapp package @packageArgs
if ($LASTEXITCODE -ne 0) { throw "winapp package が失敗しました (exit $LASTEXITCODE)" }

Write-Host "==> 完了: $output"
