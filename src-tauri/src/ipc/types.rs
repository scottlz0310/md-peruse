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

/// ファイル監視の通知。
///
/// Rust側でdebounceし、atomic replaceを削除と誤判定しないよう確定させたうえで通知する
/// （design-decisions.md 6.4）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileChangeEvent {
    /// 監視の発生元を表す不透明なID（design-decisions.md 6.4）。
    ///
    /// `path` はスコープからの相対パスであり、それだけでは通知先を一意にできない。
    /// 暗黙のルートが異なる2つのloose tab（`C:\A\README.md` と `C:\B\README.md`）は
    /// どちらも `README.md` になり、ワークスペースを切り替えた直後は新旧のルートが
    /// 同じ相対パスを持つ。Frontendは自分が保持するスコープと一致しないイベントを
    /// 破棄する。
    ///
    /// スコープはワークスペース、またはloose tabの暗黙のルートを単位として
    /// Rust側が採番し、プロセスをまたいでは有効でない。画像resource IDのソルトと
    /// 同じ単位である（design-decisions.md 5.4、9.1）。
    pub scope_id: String,
    pub change: FileChange,
}

/// ファイル監視が確定した変更の内容。
///
/// 種別ごとに必要な情報が異なるため、種別と情報をtagged unionで表す。旧パスを
/// 任意フィールドとして持つと、renameでないのに旧パスが入った状態や、renameなのに
/// 欠けた状態を型として表現できてしまう（`ImageResource` と同じ理由）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum FileChange {
    /// ファイルの内容が変わった。開いているタブはstaleにし、アクティブなら再読込する
    /// （design-decisions.md 6.5）。
    #[serde(rename_all = "camelCase")]
    FileModified {
        /// 変更があった対象の、スコープのルートからの相対パス。
        path: String,
    },
    /// ファイルが削除された。debounce期間内に置換もrenameも続かないことを確認済み。
    #[serde(rename_all = "camelCase")]
    FileRemoved { path: String },
    /// ファイルがrenameされた。debounce窓内で `Modify(Name(From))` と
    /// `Modify(Name(To))` を対にできた場合だけ通知する。対にできない場合は
    /// `FileRemoved` と `DirectoryChanged` として扱う（design-decisions.md 6.5）。
    #[serde(rename_all = "camelCase")]
    FileRenamed {
        /// rename後の、スコープのルートからの相対パス。
        path: String,
        /// rename前の、スコープのルートからの相対パス。開いているタブの追従に使う。
        old_path: String,
    },
    /// ディレクトリの子要素が増減した。展開済みなら、その階層だけを再取得する。
    #[serde(rename_all = "camelCase")]
    DirectoryChanged { path: String },
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
///
/// 成功と失敗の排他をtagged unionで表す。両方が入った状態や、どちらも欠けた状態を
/// 型として表現できないようにするためである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "status", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum ImageResource {
    #[serde(rename_all = "camelCase")]
    Issued {
        /// 要求に含まれていた参照文字列。要求と応答の対応付けに使う。
        reference: String,
        /// 発行したresource ID。
        resource_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Failed {
        /// 要求に含まれていた参照文字列。
        reference: String,
        /// 発行できなかった理由。
        error: super::error::IpcError,
    },
}

/// ドラッグ中の受け入れ可否（design-decisions.md 10.4）。
///
/// ドロップされたパスはRust側が受け取り、Frontendへは渡さない。`tauri://drag-drop` は
/// ネイティブ絶対パスを運ぶため、Frontendでlistenすると7.1の「ネイティブ絶対パスを
/// Frontendへ露出しない」を破る。オーバーレイの表示に必要なのは可否だけであり、
/// パスも座標も要らない。座標を渡さないのは、ドロップ先の領域によって処理を変えない
/// ためでもある（10.4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum DragState {
    /// ドラッグしていない。オーバーレイを表示しない。
    Idle,
    /// 開けるものが含まれる。受け入れる旨のオーバーレイを表示する。
    Acceptable,
    /// 開けるものが含まれない。受け入れない旨のオーバーレイを表示する。
    ///
    /// ドラッグ中のカーソルは、対象外のファイルでも常に「コピー可」になる。wryの
    /// Windows実装はCF_HDROPを取得できた時点で `DROPEFFECT_COPY` を返し、通知先の
    /// 判断を待たないためである（実測）。拒否をカーソルで示せない分をUIで補う。
    Rejected,
}
