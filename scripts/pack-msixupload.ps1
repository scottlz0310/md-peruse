#Requires -Version 7

<#
.SYNOPSIS
    WACKを通したMSIXを変更せずに、シンボル（PDB）と一緒に .msixupload へ包む。

.DESCRIPTION
    Partner Center は、Windows 10以降の提出で .msixupload を推奨する。.msixupload は、MSIXと
    シンボルファイルを同梱するZIPで、シンボルは、Partner Center のクラッシュ分析が、アドレスを
    読めるスタックトレースへ直すために使う（docs/store-submission.md 3章、Issue #144）。

    winapp CLI が生成した .msix には手を加えない（再ビルドも再署名もしない）。外側をZIPで包む
    だけなので、内側のMSIXのバイト列は、WACKを通したものと同一である。作成後に、内側のMSIXの
    SHA-256 が元のファイルと一致することを検査し、食い違えば失敗する。

    構成:
      md-peruse_<version>_x64.msixupload（実体はZIP）
      ├── md-peruse_<version>_x64.msix    ← winapp の出力そのもの
      └── md-peruse_<version>_x64.appxsym ← PDB を1つ含むZIP

.PARAMETER MsixPath
    包む .msix。省略すると build/msix の中の、唯一の .msix を使う。

.PARAMETER PdbPath
    シンボルにする PDB。省略すると、リリースビルドの md_peruse.pdb を使う。

.PARAMETER SymbolExtension
    シンボルファイルの拡張子。Microsoft の資料は .appxsym を説明しており、MSIX 向けに
    .msixsym とする記述もある。Partner Center は、.appxsym の形を、2026-10-03 の初回のアップロードで受理した。

.EXAMPLE
    ./scripts/pack-msixupload.ps1
#>

[CmdletBinding()]
param(
    [string]$MsixPath,

    [string]$PdbPath,

    [string]$SymbolExtension = '.appxsym'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$rustTarget = 'x86_64-pc-windows-msvc'

if (-not $MsixPath) {
    $found = @(Get-ChildItem (Join-Path $repoRoot 'build/msix') -Filter '*.msix' -ErrorAction SilentlyContinue)
    if ($found.Count -ne 1) {
        throw "build/msix の .msix が $($found.Count) 個あります。-MsixPath で指定してください。"
    }
    $MsixPath = $found[0].FullName
}
if (-not $PdbPath) {
    # 実行ファイル md-peruse.exe の PDB は、crate の名前に従い、ハイフンが下線になる。
    $PdbPath = Join-Path $repoRoot "src-tauri/target/$rustTarget/release/md_peruse.pdb"
}
foreach ($path in @($MsixPath, $PdbPath)) {
    if (-not (Test-Path $path -PathType Leaf)) { throw "ファイルが見つかりません: $path" }
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$msix = Get-Item $MsixPath
$baseName = [System.IO.Path]::GetFileNameWithoutExtension($msix.Name)
$msixEntryName = $msix.Name
$symbolEntryName = "$baseName$SymbolExtension"
$uploadPath = Join-Path $msix.DirectoryName "$baseName.msixupload"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "md-peruse-symbols-$([guid]::NewGuid())"

function Add-ZipEntry([System.IO.Compression.ZipArchive]$Archive, [string]$Source, [string]$EntryName) {
    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
        $Archive, $Source, $EntryName, [System.IO.Compression.CompressionLevel]::Optimal)
}

function Get-StreamHash([System.IO.Stream]$Stream) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return [System.Convert]::ToHexString($sha.ComputeHash($Stream)) }
    finally { $sha.Dispose() }
}

try {
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    Write-Host "==> シンボルファイルの作成: $symbolEntryName ($(Split-Path $PdbPath -Leaf))"
    $symbolPath = Join-Path $staging $symbolEntryName
    $symbolZip = [System.IO.Compression.ZipFile]::Open($symbolPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try { Add-ZipEntry $symbolZip $PdbPath (Split-Path $PdbPath -Leaf) }
    finally { $symbolZip.Dispose() }

    Write-Host "==> .msixupload の作成: $uploadPath"
    if (Test-Path $uploadPath) { Remove-Item $uploadPath -Force }
    $uploadZip = [System.IO.Compression.ZipFile]::Open($uploadPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Add-ZipEntry $uploadZip $msix.FullName $msixEntryName
        Add-ZipEntry $uploadZip $symbolPath $symbolEntryName
    }
    finally { $uploadZip.Dispose() }

    # 内側のMSIXが、WACKを通した元のファイルと同一であることを検査する。
    Write-Host '==> 内側のMSIXの同一性の検査'
    $expected = (Get-FileHash $msix.FullName -Algorithm SHA256).Hash
    $readZip = [System.IO.Compression.ZipFile]::OpenRead($uploadPath)
    try {
        $names = @($readZip.Entries | ForEach-Object { $_.FullName } | Sort-Object)
        $wanted = @($msixEntryName, $symbolEntryName | Sort-Object)
        if (($names -join '|') -ne ($wanted -join '|')) {
            throw ".msixupload の中身が想定と違います。想定: $($wanted -join ', ')、実際: $($names -join ', ')"
        }
        $entry = $readZip.GetEntry($msixEntryName)
        $stream = $entry.Open()
        try { $actual = Get-StreamHash $stream } finally { $stream.Dispose() }
    }
    finally { $readZip.Dispose() }
    if ($actual -ne $expected) {
        throw "内側のMSIXのSHA-256が元のファイルと一致しません。元 $expected、内側 $actual"
    }
    Write-Host "  内側のMSIX: $actual（元のファイルと一致）"
}
finally {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
}

Write-Host "==> 完了: $uploadPath"
