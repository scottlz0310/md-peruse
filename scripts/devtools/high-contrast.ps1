# OS のハイコントラストを、セッションの間だけ切り替える（設定ファイルやレジストリへは書かない）。
#
# 使い方: scripts/devtools/high-contrast.ps1 get | on | off
#
# - `get`: 現在のフラグを表示する（変更しない）。確認の前後で、同じ値であることを確かめる。
# - `on`: `HCF_HIGHCONTRASTON` だけを足す。ほかのフラグ（ホットキーなど）は保つ。
# - `off`: `HCF_HIGHCONTRASTON` だけを外す。
# 有効になるテーマは、OS に設定済みのものである（渡すスキーム名は、効かない。実機で確認した）。黒以外のテーマで確認するには、
# 先に OS の設定で、ハイコントラストのテーマを選んでおく。
# ユーザーの画面の色が変わるため、実行の前に、了承を得る。確認後は必ず `off` にして、`get` で元の値を確かめる。
param([Parameter(Mandatory, Position = 0)][ValidateSet('get', 'on', 'off')][string]$Mode)
$Scheme = 'High Contrast Black'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class HcApi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct HIGHCONTRAST { public uint cbSize; public uint dwFlags; public IntPtr lpszDefaultScheme; }
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref HIGHCONTRAST pvParam, uint fWinIni);
}
'@
$SPI_GETHIGHCONTRAST = 0x42
$SPI_SETHIGHCONTRAST = 0x43
$HCF_HIGHCONTRASTON = 1
$size = [Runtime.InteropServices.Marshal]::SizeOf([type][HcApi+HIGHCONTRAST])
$hc = New-Object HcApi+HIGHCONTRAST
$hc.cbSize = $size
[void][HcApi]::SystemParametersInfo($SPI_GETHIGHCONTRAST, $size, [ref]$hc, 0)
"現在: flags=0x$('{0:X}' -f $hc.dwFlags)"
if ($Mode -eq 'get') { return }
if ($Mode -eq 'on') {
  $hc.dwFlags = $hc.dwFlags -bor $HCF_HIGHCONTRASTON
  $hc.lpszDefaultScheme = [Runtime.InteropServices.Marshal]::StringToHGlobalUni($Scheme)
}
else { $hc.dwFlags = $hc.dwFlags -band (-bnot $HCF_HIGHCONTRASTON) }
# fWinIni = 0: 設定へ書き込まない（このセッションの間だけ）。
$ok = [HcApi]::SystemParametersInfo($SPI_SETHIGHCONTRAST, $size, [ref]$hc, 0)
"$Mode : $ok"
Start-Sleep -Seconds 2
[void][HcApi]::SystemParametersInfo($SPI_GETHIGHCONTRAST, $size, [ref]$hc, 0)
"変更後: flags=0x$('{0:X}' -f $hc.dwFlags)"
