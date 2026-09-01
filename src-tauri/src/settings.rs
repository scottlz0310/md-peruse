//! アプリ設定として永続化する状態のスキーマ。
//!
//! 保存先、書込み方式、保存対象は design-decisions.md 11.1 を正本とする。
//! 読み書きはRust側が担い、Frontendへは表示に必要な値だけを投影して渡す。
//! Frontendに設定ファイルを直接触らせないことで、`fs` 系のcapabilityを増やさずに
//! 済む（5.5）。ここに置くのは型と既定値、および値の組み立て規則だけであり、
//! ファイルI/OとIDの採番はPhase 4で実装する。

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 設定ファイルのスキーマ版。
///
/// 読み込んだ値がこれより小さいときはマイグレーションし、大きいとき（新しい版で
/// 書かれたファイルを古い版が読んだとき）は既定値で起動して破損時と同じ手順で
/// 退避する。未知のキーを落としたまま起動すると、次の書込みで新しい版の設定を
/// 破壊するためである。
pub const SCHEMA_VERSION: u32 = 1;

/// アプリ設定ディレクトリ内の設定ファイル名。
pub const SETTINGS_FILE_NAME: &str = "settings.json";

/// 「最近使ったフォルダー」の保持件数。
///
/// メニューへ一覧を並べる用途であり、これ以上は選ぶより開き直すほうが速い。
pub const MAX_RECENT_FOLDERS: usize = 10;

/// サイドバー幅の既定値（px）。
///
/// 範囲と刻みの正本は `src/state/sidebar-width.ts` とする（design-decisions.md 10.2）。
pub const DEFAULT_SIDEBAR_WIDTH: u32 = 280;

/// プレビュー本文の文字サイズの既定値（%）。
///
/// 段階の並びの正本は `src/state/font-scale.ts` とする（design-decisions.md 10.3）。
pub const DEFAULT_FONT_SCALE_PERCENT: u16 = 100;

// 既定値が10.2の範囲と10.3の段階へ収まることをコンパイル時に固定する。
//
// 正本はFrontend側にあり言語をまたぐため参照できない。ここへ写した値が食い違うと、
// Frontendが読み込み時に既定値を別の値へ丸めることになる。文字サイズでは、既定値の
// まま拡大しても丸めで別の段階へ飛ぶ。範囲や段階を変えるときは、ここが既定値の
// 見直しを促す。
const _: () = {
    assert!(DEFAULT_SIDEBAR_WIDTH >= 200);
    assert!(DEFAULT_SIDEBAR_WIDTH <= 600);

    let steps = [80u16, 90, 100, 110, 125, 150, 175, 200];
    let mut index = 0;
    let mut found = false;
    while index < steps.len() {
        if steps[index] == DEFAULT_FONT_SCALE_PERCENT {
            found = true;
        }
        index += 1;
    }
    assert!(found);
};

/// 配色テーマの設定値。
///
/// IPCの `Theme`（5.3）がOSから得た実際の配色を表す2値であるのに対し、こちらは
/// ユーザーの選択を表す。`System` を選んだときの実際の配色は `ThemeChangedEvent`
/// で受け取るため、両者を同じ型で表さない。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum ThemePreference {
    #[default]
    System,
    Light,
    Dark,
}

/// ウィンドウの位置とサイズ。
///
/// Frontendへは渡さない。復元はRust側でウィンドウへ適用する。接続されていない
/// ディスプレイの座標や画面外への復元を弾く検証はPhase 4で実装する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPlacement {
    /// 仮想デスクトップ座標。マルチディスプレイでは負値を取りうる。
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    /// 最大化状態。最大化中も、復元したときの位置とサイズを `x`〜`height` に保つ。
    pub maximized: bool,
}

/// 設定ファイルの内容。
///
/// `serde(default)` により、欠落したキーは既定値で埋める。`deny_unknown_fields` を
/// 付けないことで未知のキーは読み捨てる（11.1）。どちらも、手で編集されたファイルや
/// 別の版が書いたファイルを読んでも起動できるようにするためである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub schema_version: u32,
    pub theme: ThemePreference,
    pub sidebar_width: u32,
    /// サイドバーの表示状態。幅とは独立に保持する（10.2）。
    pub sidebar_visible: bool,
    pub font_scale_percent: u16,
    /// 未保存（初回起動）のときは `None` とし、OSとTauriの既定に任せる。
    pub window: Option<WindowPlacement>,
    /// 最近使ったフォルダーの絶対パス。新しいものが先頭。
    ///
    /// 絶対パスは設定ファイルとRust側のメモリに留め、Frontendへ渡さない（7.1）。
    pub recent_folders: Vec<String>,
    /// 最後に開いていたワークスペースの絶対パス。起動時に開き直す（9.2）。
    ///
    /// 通常タブ、loose tab、選択中ファイル、スクロール位置は復元しない。
    pub last_workspace: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            theme: ThemePreference::default(),
            sidebar_width: DEFAULT_SIDEBAR_WIDTH,
            sidebar_visible: true,
            font_scale_percent: DEFAULT_FONT_SCALE_PERCENT,
            window: None,
            recent_folders: Vec::new(),
            last_workspace: None,
        }
    }
}

/// 最近使ったフォルダーの表示用の1件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RecentFolderView {
    /// 不透明なID。Frontendはこの値でワークスペースを開くよう要求する。
    ///
    /// 絶対パスを渡さないための間接参照であり、値に意味を持たせない。対応表はRust側が
    /// 保持し、プロセスをまたいでは有効でない。受け取ったIDは5.3の原則どおりRust側で
    /// 再検証し、未知のIDは `ErrorCode::RecentFolderNotFound` で拒否する。
    pub id: String,
    /// 表示名。`recent_folder_label` が作る。
    pub label: String,
}

/// Frontendへ渡す設定の投影。
///
/// `Settings` をそのまま渡さないのは、絶対パスとウィンドウ配置がFrontendの表示に
/// 不要であり、7.1の「ネイティブ絶対パスをFrontendのURLまたはDOMへ露出しない」を
/// 例外なく保つためである。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct UiSettings {
    pub theme: ThemePreference,
    pub sidebar_width: u32,
    pub sidebar_visible: bool,
    pub font_scale_percent: u16,
    /// 新しいものが先頭。最大 `MAX_RECENT_FOLDERS` 件。
    pub recent_folders: Vec<RecentFolderView>,
}

/// 最近使ったフォルダーの表示名を作る。
///
/// 末尾2コンポーネント（親フォルダー名とフォルダー名）に限る。フォルダー名だけでは
/// 同名フォルダーを区別できず、絶対パス全体は7.1により渡せないためである。
/// 区切りは表示上 `\` へ揃える。
pub fn recent_folder_label(absolute_path: &str) -> String {
    let normalized = absolute_path.replace('/', "\\");
    let trimmed = normalized.trim_end_matches('\\');
    // ドライブ直下（`C:\`）は末尾の区切りを落とすと `C:` だけが残る。区切りを補って
    // ドライブそのものであることを示す。
    if trimmed.is_empty() || trimmed.ends_with(':') {
        return format!("{trimmed}\\");
    }
    let components: Vec<&str> = trimmed.split('\\').filter(|c| !c.is_empty()).collect();
    let tail = components.len().saturating_sub(2);
    components[tail..].join("\\")
}

/// 最近使ったフォルダーへ1件加えた一覧を返す。
///
/// 同じフォルダーを開き直したときに一覧が重複で埋まらないよう、既存の同値を取り除いて
/// から先頭へ積み、`MAX_RECENT_FOLDERS` 件で切り詰める。
///
/// `path` と `history` は正規化済み（大文字小文字と8.3形式の短い名前を解決した）絶対
/// パスであることを前提とする。正規化は7.1の境界判定と同じ手順で呼び出し側が行う。
pub fn push_recent_folder(history: &[String], path: &str) -> Vec<String> {
    let mut next = Vec::with_capacity(history.len() + 1);
    next.push(path.to_owned());
    next.extend(history.iter().filter(|p| p.as_str() != path).cloned());
    next.truncate(MAX_RECENT_FOLDERS);
    next
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 既定値で書いた設定を読み戻せることを固定する。
    #[test]
    fn defaults_round_trip_through_json() {
        let defaults = Settings::default();
        let json = serde_json::to_string(&defaults).expect("既定値を直列化できる");
        let parsed: Settings = serde_json::from_str(&json).expect("直列化した値を読み戻せる");
        assert_eq!(parsed, defaults);
        assert_eq!(parsed.schema_version, SCHEMA_VERSION);
    }

    /// 未知のキーを読み捨て、欠落したキーを既定値で埋めることを固定する（11.1）。
    #[test]
    fn unknown_keys_are_ignored_and_missing_keys_fall_back() {
        let json = r#"{"schemaVersion":1,"theme":"dark","futureKey":{"nested":true}}"#;
        let parsed: Settings = serde_json::from_str(json).expect("未知のキーがあっても読める");
        assert_eq!(parsed.theme, ThemePreference::Dark);
        assert_eq!(parsed.sidebar_width, DEFAULT_SIDEBAR_WIDTH);
        assert!(parsed.sidebar_visible);
        assert_eq!(parsed.window, None);
    }

    /// JSONのキーがcamelCaseであることを固定する。TypeScriptの生成物と対応させる。
    #[test]
    fn keys_are_camel_case() {
        let json = serde_json::to_string(&Settings::default()).expect("直列化できる");
        for key in [
            "\"schemaVersion\"",
            "\"sidebarWidth\"",
            "\"sidebarVisible\"",
            "\"fontScalePercent\"",
            "\"recentFolders\"",
            "\"lastWorkspace\"",
        ] {
            assert!(json.contains(key), "欠けているキー: {key}");
        }
    }

    #[test]
    fn recent_folder_label_keeps_last_two_components() {
        let cases = [
            ("C:\\Users\\dev\\src\\md-peruse", "src\\md-peruse"),
            ("C:\\projects", "C:\\projects"),
            ("C:\\", "C:\\"),
            ("C:", "C:\\"),
            ("C:\\Users\\dev\\src\\md-peruse\\", "src\\md-peruse"),
            ("C:/Users/dev/docs", "dev\\docs"),
            ("\\\\server\\share\\docs", "share\\docs"),
        ];
        for (path, expected) in cases {
            assert_eq!(recent_folder_label(path), expected, "入力: {path}");
        }
    }

    #[test]
    fn push_recent_folder_moves_duplicates_to_front() {
        let history = vec!["C:\\a".to_owned(), "C:\\b".to_owned(), "C:\\c".to_owned()];
        let cases = [
            ("C:\\d", vec!["C:\\d", "C:\\a", "C:\\b", "C:\\c"]),
            ("C:\\b", vec!["C:\\b", "C:\\a", "C:\\c"]),
            ("C:\\a", vec!["C:\\a", "C:\\b", "C:\\c"]),
        ];
        for (path, expected) in cases {
            assert_eq!(push_recent_folder(&history, path), expected, "入力: {path}");
        }
    }

    /// 上限を超えた分を古いものから捨てることを固定する。
    #[test]
    fn push_recent_folder_truncates_to_limit() {
        let history: Vec<String> = (0..MAX_RECENT_FOLDERS)
            .map(|i| format!("C:\\dir{i}"))
            .collect();
        let next = push_recent_folder(&history, "C:\\new");
        assert_eq!(next.len(), MAX_RECENT_FOLDERS);
        assert_eq!(next[0], "C:\\new");
        let dropped = format!("C:\\dir{}", MAX_RECENT_FOLDERS - 1);
        assert!(!next.contains(&dropped));
    }
}
