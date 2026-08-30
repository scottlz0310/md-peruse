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

/// ディレクトリ1階層の走査結果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ScanResult {
    /// 走査したディレクトリのワークスペース相対パス。要求の `path` と同じ値を返す。
    ///
    /// どのディレクトリの結果かを示す情報であり、陳腐化した応答の判定には使えない。
    /// 同一パスの再走査とワークスペース切替では新旧の `path` が一致するため、
    /// 破棄はFrontendが持つワークスペース世代とパス世代で行う（design-decisions.md 5.3）。
    pub path: String,
    /// 直下の要素。サブディレクトリの中身は含まない。
    pub entries: Vec<FileNode>,
}

/// 文書内の画像参照に対するresource IDの発行要求。
///
/// 画像はワークスペース走査の対象外のため、描画時にまとめて発行する
/// （design-decisions.md 5.4、6.2）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ImageResourceRequest {
    /// 画像を参照している文書のワークスペース相対パス。
    /// 相対リンクの基点として使う。
    pub document_path: String,
    /// 文書内に現れた画像参照。Markdownに書かれた文字列をそのまま渡す。
    pub references: Vec<String>,
}

/// 1件の画像参照に対する発行結果。
///
/// 一部の画像が失敗しても他の画像は表示するため、成功と失敗を要素ごとに表す。
/// 失敗した画像は本文全体を壊さず、その位置に原因を表示する（design-decisions.md 7.3）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ImageResource {
    /// 要求に含まれていた参照文字列。要求と応答の対応付けに使う。
    pub reference: String,
    /// 発行したresource ID。失敗した場合は `None`。
    pub resource_id: Option<String>,
    /// 発行できなかった理由。成功した場合は `None`。
    pub error: Option<super::error::IpcError>,
}
