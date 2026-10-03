# 指定した領域（既定: 主ディスプレイの作業領域 0,0 1920x1032）を PNG で保存する。Store の
# スクリーンショットを撮るための道具（docs/store-submission.md 6章）。マウスのカーソルは写らない。
# 例: pwsh scripts/capture-screen.ps1 -Path out.png
#     pwsh scripts/capture-screen.ps1 -Path out.png -Left 1920 -Top 3   （副ディスプレイ）
param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Left = 0,
    [int]$Top = 0,
    [int]$Width = 1920,
    [int]$Height = 1032
)

Add-Type -AssemblyName System.Drawing
$bitmap = New-Object System.Drawing.Bitmap $Width, $Height
try {
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($Left, $Top, 0, 0, $bitmap.Size)
    }
    finally {
        $graphics.Dispose()
    }
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
}
finally {
    $bitmap.Dispose()
}
Write-Host "saved: $Path ($Width x $Height at $Left,$Top)"
