//! Rust側で検証する処理上限。
//!
//! 値の根拠は design-decisions.md 6.3、7.3 を正本とする。ここに置くのは、
//! Markdownの読込と画像の配信をRust側が担い、境界の検証もRust側で行うため
//! である（7.1）。Frontendが行う処理の上限は `src/markdown/limits.ts` に置く。

const MIB: u32 = 1024 * 1024;

/// Markdownの最大バイト数。超過したファイルは解析も描画も行わない（6.3）。
pub const MAX_MARKDOWN_BYTES: u32 = 10 * MIB;

/// 画像1件の最大バイト数。Markdownとは対象も値も異なるため分ける（7.3）。
pub const MAX_IMAGE_BYTES: u32 = 32 * MIB;

/// 画像の1辺の最大ピクセル数。
///
/// 縦横比が極端な画像（長いスクリーンショット、パノラマ）を許容するため、
/// 総ピクセル数とは別に長辺で制限する。
pub const MAX_IMAGE_EDGE_PIXELS: u32 = 16_384;

/// 画像の最大総ピクセル数。
///
/// ファイルサイズの上限だけでは、圧縮率の高い画像による過大なデコード後メモリ
/// （decompression bomb）を防げない。RGBA8では 4 byte/px であり、24 Mpxは96 MB、
/// 同時読込2件で192 MBとなる。全プロセス合計300 MBというメモリ目標（spec.md 5.2）
/// の内側に収まる値として定めた。
pub const MAX_IMAGE_TOTAL_PIXELS: u32 = 24_000_000;

/// 画像の同時読込数（7.3）。
pub const MAX_CONCURRENT_IMAGE_LOADS: usize = 2;

#[cfg(test)]
mod tests {
    use super::*;

    /// デコード後のメモリがメモリ目標の内側に収まることを固定する。
    ///
    /// 上限を引き上げるときは、この計算とspec.md 5.2の目標を併せて見直す。
    #[test]
    fn decoded_image_memory_fits_in_budget() {
        const BYTES_PER_PIXEL: u64 = 4; // RGBA8
        const MEMORY_BUDGET_BYTES: u64 = 300 * 1024 * 1024;

        let concurrent = u64::try_from(MAX_CONCURRENT_IMAGE_LOADS).unwrap();
        let decoded = u64::from(MAX_IMAGE_TOTAL_PIXELS) * BYTES_PER_PIXEL * concurrent;

        assert!(
            decoded < MEMORY_BUDGET_BYTES,
            "デコード後 {decoded} バイトがメモリ目標 {MEMORY_BUDGET_BYTES} バイトを超える"
        );
    }

    /// 長辺の制限だけでは総ピクセル数を抑えられないことを示す。
    ///
    /// 2つの上限は独立に効き、どちらか一方では足りない。
    #[test]
    fn edge_limit_alone_allows_more_than_total_limit() {
        let square = u64::from(MAX_IMAGE_EDGE_PIXELS) * u64::from(MAX_IMAGE_EDGE_PIXELS);
        assert!(square > u64::from(MAX_IMAGE_TOTAL_PIXELS));
    }
}
