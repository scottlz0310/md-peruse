use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// ツリーへ表示する要素の種別。
///
/// 非Markdownファイルは表示しないため、この2値で足りる
/// （design-decisions.md 6.3、spec.md 3章）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum FileNodeKind {
    Directory,
    Markdown,
}

/// ツリーの1要素。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileNode {
    /// ワークスペースルートからの相対パス。区切りは `/` とする。
    /// ネイティブ絶対パスをFrontendへ露出しない（design-decisions.md 7.1）。
    pub path: String,
    /// 表示名。`path` の最終要素。
    pub name: String,
    pub kind: FileNodeKind,
    /// ディレクトリのとき、子要素を持つか。遅延展開の判断に使う。
    /// ファイルのときは `None`。
    pub has_children: Option<bool>,
}

/// ディレクトリ1階層の走査要求。
///
/// ルート直下を最初に取得し、サブフォルダーは展開時に取得する（spec.md 3章）。
/// 再帰的な一括走査は行わない。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ScanRequest {
    /// 走査するディレクトリのワークスペース相対パス。ルート自身は空文字とする。
    pub path: String,
}

/// 読み込んだファイルの文字コード。
///
/// BOMで判定できるものだけを扱い、CP932などの推測変換は行わない
/// （design-decisions.md 6.3）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum TextEncoding {
    Utf8,
    Utf8Bom,
    Utf16Le,
    Utf16Be,
}

/// ファイル読込の結果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileContent {
    /// 読み込んだファイルのワークスペース相対パス。
    pub path: String,
    /// 本文。改行はLFへ正規化済み（design-decisions.md 6.3）。
    pub text: String,
    /// 判定した文字コード。BOMは `text` から除去済み。
    pub encoding: TextEncoding,
    /// 読み込んだバイト数。上限（10 MiB）の判定はRust側で行う。
    ///
    /// TauriのJSON IPCは `serde_json` を通るため、Frontendが受け取るのはJavaScriptの
    /// `number` である。`u64` は `ts-rs` が `bigint` へ写像し実値と乖離するため、
    /// 上限が10 MiBであることを踏まえて `u32` とする。
    pub byte_size: u32,
}

/// ファイル監視から届く変更の種別。
///
/// Rust側でdebounceし、atomic replaceを削除と誤判定しないよう確定させたうえで通知する
/// （design-decisions.md 6.4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum FileChangeKind {
    /// ファイルの内容が変わった。アクティブ文書は再読込し、非アクティブタブはdirtyにする。
    FileModified,
    /// ファイルが削除された。debounce期間内に置換が続かないことを確認済み。
    FileRemoved,
    /// ディレクトリの子要素が増減した。展開済みなら、その階層だけを再取得する。
    DirectoryChanged,
}

/// ファイル監視の通知。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileChangeEvent {
    pub kind: FileChangeKind,
    /// 変更があった対象のワークスペース相対パス。
    pub path: String,
}

/// 配色テーマ。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum Theme {
    Light,
    Dark,
}

/// OSの配色設定が変わったときの通知。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ThemeChangedEvent {
    pub theme: Theme,
}
