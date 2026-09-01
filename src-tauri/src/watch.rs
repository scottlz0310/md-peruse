//! ファイル監視の時間に関する定数。
//!
//! ライフサイクルと畳み込みの規則は design-decisions.md 6.4、6.5 を正本とする。
//! ここに置くのは値だけであり、`notify` のイベントを畳み込む実装はPhase 4で行う。

/// debounceの窓（ミリ秒）。
///
/// 単一の書込みに対しても `Create` と複数の `Modify` が届き、atomic replaceでは
/// 置換先へ `Remove` が先行する（design-decisions.md 6.4の実測）。debounceは実装上の
/// 最適化ではなく、削除とrenameを誤判定しないために必要である。
///
/// 値は暫定であり、Phase 4で実測して確定する。長くすると再描画が遅れ、短くすると
/// atomic replaceの `Remove` を削除と誤判定する確率が上がる。
pub const DEBOUNCE_MS: u64 = 150;

/// 置換直後の読込失敗に対して許す再読込の回数（design-decisions.md 6.5）。
///
/// 「共有違反時に自動リトライしない」という原則の限定的な例外であり、同一イベントに
/// 対して1回だけ許す。回数を増やすと、実際に他プロセスがロックし続けている状況で
/// 失敗の提示が遅れる。
pub const REPLACE_RETRY_LIMIT: u32 = 1;

/// 再読込までの待ち時間（ミリ秒）。
///
/// 値は暫定であり、Phase 4で `DEBOUNCE_MS` と併せて実測して確定する。
pub const REPLACE_RETRY_DELAY_MS: u64 = 100;

// 再読込の待ちはdebounceの窓に収まらなければならない。窓より長いと、次のdebounceが
// 確定してから前の再読込が走り、古い内容で新しい内容を上書きしうる。両方の値を
// Phase 4で実測して差し替えるため、関係をコンパイル時に固定する。
const _: () = assert!(REPLACE_RETRY_DELAY_MS < DEBOUNCE_MS);
