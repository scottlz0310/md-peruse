use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// IPCの失敗を表す機械可読な識別子。
///
/// Frontendはこの値で分岐し、`message` の文字列比較を行わない
/// （design-decisions.md 5.3）。再試行可否は各codeから導出する。
///
/// アプリ起動前の失敗（WebView2 Runtimeの欠落、MSIXのPackage Identity）は
/// IPCが成立しないためここに含めない。画像の失敗はcustom image protocolの
/// 応答で表す。Mermaid、lowlight、KaTeXの失敗はFrontend内で完結する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum ErrorCode {
    /// ワークスペースとして選択したフォルダーへアクセスできない。
    WorkspaceAccessDenied,
    /// ワークスペースのルートが存在しない。移動または削除された場合を含む。
    WorkspaceNotFound,
    /// 対象がワークスペースの境界外を指している（design-decisions.md 7.1）。
    PathOutsideWorkspace,
    /// パスの形式を受け付けられない。代替データストリーム表記、
    /// 末尾のドットや空白、device pathなどが該当する。
    PathRejected,
    /// 対象のファイルが存在しない。
    FileNotFound,
    /// ファイルへのアクセスが拒否された。
    FileAccessDenied,
    /// 他のプロセスがファイルをロックしている（共有違反）。
    FileLocked,
    /// Markdownが上限（10 MiB）を超えている。
    FileTooLarge,
    /// 未対応または不正な文字コードでデコードできない。推測変換は行わない。
    DecodeFailed,
    /// 監視のバッファがあふれ、個別のイベントを取りこぼした。
    WatcherOverflow,
    /// 監視が停止した。ワークスペースの再選択が必要になる場合がある。
    WatcherStopped,
    /// 設定ファイルが壊れており読み取れない。
    SettingsCorrupted,
}

/// IPCの失敗。
///
/// 表示場所（ネイティブダイアログ、プレビュー領域、ツリー項目、文書内要素）は
/// Frontendが呼び出しの文脈から決める。同じcodeでも、タブを開く操作で起きたか
/// ツリーの走査で起きたかによって表示先が変わるためである（design-decisions.md 12）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct IpcError {
    pub code: ErrorCode,
    /// 表示用の日本語メッセージ。
    ///
    /// ネイティブ絶対パスを含めない。対象を示すときはワークスペースルートからの
    /// 相対パスを使う（design-decisions.md 5.3、7.1）。
    pub message: String,
    /// 補足情報。原因の切り分けに使う。`message` と同じくネイティブ絶対パスを含めない。
    pub detail: Option<String>,
}
