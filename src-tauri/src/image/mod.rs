//! ローカル画像の受け入れ判定（design-decisions.md 5.4、7.3）。
//!
//! 画像はワークスペース走査の対象外であり（6.2）、文書の描画時にその文書が参照する画像を
//! まとめて発行する。
//!
//! | モジュール | 担うもの |
//! | --- | --- |
//! | `reference` | 画像参照からワークスペース相対パスへの解決 |
//! | `format` | 発行時と配信時の両方が通る形式と上限の判定 |
//! | `resource` | resource IDの生成、変更世代、対応表 |
//! | `issue` | 参照1件に対する発行 |
//! | `protocol` | custom protocolによる配信 |
//! | `error` | 発行と配信が共有する失敗の区分 |

pub mod error;
pub mod format;
pub mod issue;
pub mod protocol;
pub mod reference;
pub mod resource;
