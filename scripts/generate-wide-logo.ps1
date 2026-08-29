#Requires -Version 7

<#
.SYNOPSIS
    ワイドタイル用ロゴ（Wide310x150Logo）を原本から生成する。

.DESCRIPTION
    `tauri icon` は正方形アイコンしか生成しないため、横長タイルは本スクリプトで生成する。
    原本は assets/wide-logo.png（比率 2.0667）とし、手作業でのリサイズは行わない。

.EXAMPLE
    ./scripts/generate-wide-logo.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

$repoRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $repoRoot 'assets/wide-logo.png'
$output = Join-Path $repoRoot 'src-tauri/icons/Wide310x150Logo.png'

if (-not (Test-Path $source)) {
    throw "原本が見つかりません: $source"
}

$targetWidth = 310
$targetHeight = 150

$src = [System.Drawing.Image]::FromFile($source)
try {
    # 比率が合わないまま縮小すると、タイルで意図しない引き伸ばしや余白が生じる。
    $expected = $targetWidth / $targetHeight
    $actual = $src.Width / $src.Height
    if ([math]::Abs($actual - $expected) -gt 0.001) {
        throw "原本の比率が $([math]::Round($actual, 4)) です。Wide310x150Logo には $([math]::Round($expected, 4)) が必要です。"
    }

    $bmp = New-Object System.Drawing.Bitmap($targetWidth, $targetHeight)
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        try {
            $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
            $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $rect = New-Object System.Drawing.Rectangle(0, 0, $targetWidth, $targetHeight)
            $g.DrawImage($src, $rect, 0, 0, $src.Width, $src.Height, [System.Drawing.GraphicsUnit]::Pixel)
        }
        finally {
            $g.Dispose()
        }
        $bmp.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $bmp.Dispose()
    }
}
finally {
    $src.Dispose()
}

Write-Host "生成しました: $output ($targetWidth x $targetHeight)"
