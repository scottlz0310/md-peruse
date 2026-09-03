//! ドラッグ＆ドロップで渡されたパスの解釈（design-decisions.md 10.4）。
//!
//! ドロップされたパスはWebViewではなくRust側が受け取る。`tauri://drag-drop` は
//! ネイティブ絶対パスを運ぶため、Frontendへ渡すと7.1の「ネイティブ絶対パスを
//! Frontendへ露出しない」を破る。Frontendへ渡すのは受け入れ可否だけとし、
//! それを `DragState`（5.3）で表す。
//!
//! ここに置くのは受け入れ規則だけであり、種別の判定（`is_dir`）とワークスペースの
//! 切り替えはPhase 4で行う。

use crate::startup::files_to_open;

/// ドロップされた1項目の種別。
///
/// パス文字列からは区別が付かない。`docs.md` という名前のフォルダーは拡張子の
/// 判定では対象ファイルに見えるため、呼び出し側がファイルシステムへ問い合わせた
/// 結果を与える。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DroppedKind {
    File,
    Directory,
}

/// ドロップされた1項目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DroppedEntry {
    /// ネイティブ絶対パス。正規化は7.1の境界判定と同じ手順で呼び出し側が済ませる。
    pub path: String,
    pub kind: DroppedKind,
}

/// ドロップに対して行う処理。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DropPlan {
    /// ワークスペースとして開くフォルダー。ドロップに含まれる最初のフォルダー。
    pub workspace: Option<String>,
    /// タブで開くファイル。先頭から順に開き、最後の1つをアクティブにする。
    ///
    /// `workspace` があるときは、ワークスペースを開いた後に開く。順序を逆にすると、
    /// ワークスペースの切り替えが通常タブとloose tabを破棄する（6.1）ため、同じ
    /// ドロップで開いたファイルが消える。
    pub files: Vec<String>,
}

impl DropPlan {
    /// 行う処理が何もないことを表す。
    ///
    /// ドラッグ中の受け入れ可否はこの値で決める。可否の判定と実際の処理で別の規則を
    /// 持つと、「受け入れられる」と示しておいて何も起きない状態が生じうる。
    pub fn is_empty(&self) -> bool {
        self.workspace.is_none() && self.files.is_empty()
    }
}

/// ドロップされた項目から行う処理を決める。
///
/// フォルダーは最初の1つだけをワークスペースとして開き、2つ目以降は無視する。
/// ウィンドウとワークスペースがそれぞれ1つ（6.1、9.1）であり、2つ目を開いても
/// 1つ目を捨てることにしかならないためである。「最初の1つ」はドロップに含まれる
/// 並び順であり、これはCF_HDROPの並びで決まる。エクスプローラーの表示順とも選択順
/// とも一致しない（実測）。
///
/// ファイルは関連付け起動と同じ規則で扱う（9.2）。対象拡張子のものをすべて開き、
/// 同値は1つにまとめる。ファイルを開く経路を起動引数とドロップで分けないためである。
pub fn plan_drop(entries: &[DroppedEntry]) -> DropPlan {
    let workspace = entries
        .iter()
        .find(|entry| entry.kind == DroppedKind::Directory)
        .map(|entry| entry.path.clone());

    let file_paths: Vec<String> = entries
        .iter()
        .filter(|entry| entry.kind == DroppedKind::File)
        .map(|entry| entry.path.clone())
        .collect();

    DropPlan {
        workspace,
        files: files_to_open(&file_paths),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str) -> DroppedEntry {
        DroppedEntry {
            path: path.to_owned(),
            kind: DroppedKind::File,
        }
    }

    fn directory(path: &str) -> DroppedEntry {
        DroppedEntry {
            path: path.to_owned(),
            kind: DroppedKind::Directory,
        }
    }

    /// 名前、ドロップされた項目、期待するワークスペース、期待するファイル。
    type PlanCase = (
        &'static str,
        Vec<DroppedEntry>,
        Option<&'static str>,
        Vec<&'static str>,
    );

    #[test]
    fn plan_drop_follows_the_rules() {
        let cases: [PlanCase; 8] = [
            (
                "単一のMarkdownファイルはタブで開く",
                vec![file(r"C:\docs\a.md")],
                None,
                vec![r"C:\docs\a.md"],
            ),
            (
                "単一のフォルダーはワークスペースとして開く",
                vec![directory(r"C:\docs")],
                Some(r"C:\docs"),
                vec![],
            ),
            (
                "対象外の拡張子は落とす",
                vec![file(r"C:\docs\note.txt"), file(r"C:\docs\a.md")],
                None,
                vec![r"C:\docs\a.md"],
            ),
            (
                "対象が1つもなければ何もしない",
                vec![file(r"C:\docs\note.txt"), file(r"C:\docs\photo.png")],
                None,
                vec![],
            ),
            (
                "複数のMarkdownファイルは渡された順ですべて開く",
                vec![file(r"C:\docs\b.md"), file(r"C:\docs\a.markdown")],
                None,
                vec![r"C:\docs\b.md", r"C:\docs\a.markdown"],
            ),
            (
                "同じファイルを重複して開かない",
                vec![file(r"C:\docs\a.md"), file(r"C:\docs\a.md")],
                None,
                vec![r"C:\docs\a.md"],
            ),
            (
                "フォルダーは最初の1つだけを採る",
                vec![directory(r"C:\docs"), directory(r"C:\other")],
                Some(r"C:\docs"),
                vec![],
            ),
            (
                "フォルダーとファイルの混在は両方を処理する",
                vec![
                    file(r"C:\docs\a.md"),
                    directory(r"C:\docs\sub"),
                    file(r"C:\docs\b.md"),
                ],
                Some(r"C:\docs\sub"),
                vec![r"C:\docs\a.md", r"C:\docs\b.md"],
            ),
        ];

        for (name, entries, workspace, files) in cases {
            let plan = plan_drop(&entries);
            assert_eq!(
                plan.workspace.as_deref(),
                workspace,
                "{name}: ワークスペース"
            );
            assert_eq!(plan.files, files, "{name}: ファイル");
        }
    }

    /// 拡張子だけでは種別を決めないことを固定する。
    ///
    /// `docs.md` という名前のフォルダーは `is_markdown_path` が対象と判定する。
    /// 種別を呼び出し側から受け取らずにパスだけで分けると、フォルダーをタブで
    /// 開こうとして読込に失敗する。
    #[test]
    fn directory_named_like_a_document_is_a_workspace() {
        let plan = plan_drop(&[directory(r"C:\docs.md")]);
        assert_eq!(plan.workspace.as_deref(), Some(r"C:\docs.md"));
        assert!(plan.files.is_empty());
    }

    #[test]
    fn is_empty_matches_having_nothing_to_do() {
        let cases = [
            (vec![file(r"C:\docs\note.txt")], true),
            (vec![], true),
            (vec![file(r"C:\docs\a.md")], false),
            (vec![directory(r"C:\docs")], false),
        ];
        for (entries, expected) in cases {
            assert_eq!(
                plan_drop(&entries).is_empty(),
                expected,
                "入力: {entries:?}"
            );
        }
    }
}
