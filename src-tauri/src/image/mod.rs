//! ローカル画像の受け入れ判定（design-decisions.md 5.4、7.3）。
//!
//! 画像はワークスペース走査の対象外であり（6.2）、文書の描画時にその文書が参照する画像を
//! まとめて発行する。ここが持つのは、発行時と配信時の両方が通る判定そのものである。
//! resource IDの発行と世代、custom protocolによる配信は別のモジュールが担う。

pub mod format;
pub mod reference;
