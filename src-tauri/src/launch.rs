//! 関連付け起動で渡されたファイルの受け取り（design-decisions.md 9.2）。
//!
//! 受け取り口は2つある。新規に起動したプロセスの起動引数と、起動中のインスタンスへ渡された
//! 2つ目のプロセスの引数（`tauri-plugin-single-instance`）である。どちらも同じ規則
//! （`crate::startup::files_to_open`）で開く対象を選び、`open_document` で開く。
//!
//! 開くのは、次の2つがそろってからである。
//!
//! - 最後のワークスペースの復元が済んだこと。復元は開いたタブを破棄するため、先に開くと
//!   タブが消える。復元してから開けば、ファイルが復元先の中なら通常タブ、外ならloose tabに
//!   なり、アプリが起動中だったときと同じ状態になる。
//! - Frontendが購読と起動時の問い合わせを終えたこと。`open-document` はWebViewが購読する前に
//!   送ると誰にも届かない。
//!
//! それまでに届いたファイルは、届いた順に保留する。保留は最初のプロセスの起動の直後から
//! 効かせる必要がある。プラグインは起動処理より先に2つ目のプロセスの引数を受け取りうるため、
//! この状態は `tauri::Builder` の段階で登録し、他の状態に触れずに保留できるようにする。
//!
//! 保留から取り出してから開き終えるまでは、受け取りごとに1つずつ行う。複数のスレッド
//! （復元、Frontendの準備、2つ目のプロセス）が同時に開くと、先に取り出したファイルの
//! ストレージの応答が遅いとき、後のファイルが先に開き、最後にアクティブになるタブが
//! 届いた順と食い違う。

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use std::thread;

use tauri::{AppHandle, Manager, Runtime};

use crate::open_document::open_documents;
use crate::open_folder::{MAIN_WINDOW, show_error};
use crate::startup::files_to_open;

#[derive(Default)]
struct Pending {
    restored: bool,
    frontend_ready: bool,
    files: Vec<String>,
}

impl Pending {
    /// 開いてよい状態なら、保留を空にして返す。
    fn take_openable(&mut self) -> Vec<String> {
        if self.restored && self.frontend_ready {
            std::mem::take(&mut self.files)
        } else {
            Vec::new()
        }
    }
}

/// 関連付け起動で渡されたファイルの保留。
///
/// 開いてよくなったファイルは、この型の各操作の戻り値として渡す。開くこと自体はここでは
/// 行わない。開くのはファイルシステムとFrontendへの通知を伴うため、`deliver` が、保留の
/// ロックの外で行う。
#[derive(Default)]
pub struct LaunchQueue {
    pending: Mutex<Pending>,
    /// 取り出してから開き終えるまでを、受け取りごとに1つずつ行うための錠。
    order: Mutex<()>,
}

impl LaunchQueue {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, Pending> {
        // `panic = "abort"` の下では毒される経路が生じない（12章）。
        self.pending
            .lock()
            .expect("起動ファイルの保留のロックに失敗")
    }

    /// 保留から取り出す処理と、取り出したファイルを開く処理を、届いた順に1つずつ行う。
    ///
    /// 取り出してから開き終えるまでを、別の受け取りと重ねない。重ねると、先に取り出した
    /// ファイルのストレージの応答が遅いとき、後から取り出したファイルが先に開き、最後に
    /// アクティブになるタブが届いた順と食い違う（9.2）。錠は取り出しの前に取る。取り出して
    /// から取ると、その間に別の受け取りが追い越せる。
    fn deliver(&self, take: impl FnOnce(&Self) -> Vec<String>, open: impl FnOnce(&[String])) {
        let _in_order = self.order.lock().expect("起動ファイルの順序のロックに失敗");
        let openable = take(self);
        open(&openable);
    }

    /// ファイルを保留の末尾へ加え、いま開いてよいものを返す。
    fn push(&self, files: Vec<String>) -> Vec<String> {
        let mut pending = self.lock();
        pending.files.extend(files);
        pending.take_openable()
    }

    /// 最後のワークスペースの復元が済んだことを記録し、いま開いてよいものを返す。
    fn mark_restored(&self) -> Vec<String> {
        let mut pending = self.lock();
        pending.restored = true;
        pending.take_openable()
    }

    /// Frontendの準備が済んだことを記録し、いま開いてよいものを返す。
    fn mark_frontend_ready(&self) -> Vec<String> {
        let mut pending = self.lock();
        pending.frontend_ready = true;
        pending.take_openable()
    }
}

/// コマンドライン全体（`argv[0]` を含む）から、開くファイルの絶対パスを選ぶ。
///
/// 相対パスは、そのプロセスの作業ディレクトリ（`base`）で解決する。2つ目のプロセスの相対パスを
/// 起動中のインスタンスの作業ディレクトリで解決すると、別のファイルを指す。
fn requested_files(argv: &[String], base: &Path) -> Vec<String> {
    let absolute: Vec<String> = argv
        .iter()
        .skip(1)
        .map(|arg| {
            let path = Path::new(arg);
            if path.is_absolute() {
                arg.clone()
            } else {
                base.join(path).to_string_lossy().into_owned()
            }
        })
        .collect();
    files_to_open(&absolute)
}

/// 新規に起動したプロセスの起動引数を受け取る。
///
/// 作業ディレクトリは空を渡す。相対パスはそのまま残り、開くときにプロセス自身の作業
/// ディレクトリで解決される。
pub fn received_at_startup<R: Runtime>(app: &AppHandle<R>, argv: &[String]) {
    receive(app, argv, Path::new(""));
}

/// 起動中のインスタンスへ渡された、2つ目のプロセスの引数を受け取る。
///
/// ウィンドウを前面へ出してから、ファイルを別のスレッドで開く。プラグインの呼び出しは、
/// 2つ目のプロセスの通知を処理するスレッドで行われる。ここでファイルシステムを待つと、
/// 応答の遅いストレージで通知の処理が止まる。
pub fn second_instance<R: Runtime>(app: &AppHandle<R>, argv: Vec<String>, cwd: String) {
    focus_main_window(app);
    let app = app.clone();
    thread::spawn(move || receive(&app, &argv, Path::new(&cwd)));
}

/// 起動時の、最後のワークスペースの復元が済んだことを知らせる。復元に失敗した場合も呼ぶ。
///
/// 復元と同じスレッドから、復元の直後に呼ぶ。
pub fn restored<R: Runtime>(app: &AppHandle<R>) {
    app.state::<LaunchQueue>()
        .deliver(LaunchQueue::mark_restored, |files| open(app, files));
}

/// Frontendの準備が済んだことを知らせる。
///
/// Frontendが `open-document` を購読し、開いているワークスペースを問い合わせ終えたあとに
/// 呼ぶ（`frontend_ready_command`）。
pub fn frontend_ready<R: Runtime>(app: &AppHandle<R>) {
    app.state::<LaunchQueue>()
        .deliver(LaunchQueue::mark_frontend_ready, |files| open(app, files));
}

fn receive<R: Runtime>(app: &AppHandle<R>, argv: &[String], base: &Path) {
    let files = requested_files(argv, base);
    app.state::<LaunchQueue>()
        .deliver(|queue| queue.push(files), |files| open(app, files));
}

/// ファイルを開く。開けなかったものの理由は、1つのダイアログへまとめて示す。
fn open<R: Runtime>(app: &AppHandle<R>, files: &[String]) {
    if files.is_empty() {
        return;
    }
    let failures = open_documents(app, files);
    if !failures.is_empty() {
        show_error(app, &failures);
    }
}

/// メインウィンドウを、最小化や非表示から戻して前面へ出す。
///
/// 操作の失敗は返さない。渡されたファイルは開くため、前面に出せなくても利用者の要求は
/// 果たされ、伝える相手もいない。
fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::ipc::types::OpenDocumentEvent;
    use crate::open_document::OPEN_DOCUMENT_EVENT;
    use crate::state::AppState;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::Arc;
    use tauri::Listener;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    /// `argv[0]` は開く対象にしない。相対パスは、そのプロセスの作業ディレクトリで解決する。
    #[test]
    fn requested_files_resolve_against_the_launching_directory() {
        let cases: [(&str, Vec<&str>, &str, Vec<&str>); 6] = [
            (
                "絶対パスはそのまま",
                vec![r"C:\app\md-peruse.exe", r"D:\docs\a.md"],
                r"C:\work",
                vec![r"D:\docs\a.md"],
            ),
            (
                "相対パスは作業ディレクトリで解決する",
                vec![r"C:\app\md-peruse.exe", r"docs\a.md"],
                r"C:\work",
                vec![r"C:\work\docs\a.md"],
            ),
            (
                "実行ファイル自身は、対象の拡張子でも開かない",
                vec![r"C:\app\odd.md", r"D:\docs\a.md"],
                r"C:\work",
                vec![r"D:\docs\a.md"],
            ),
            (
                "対象外の引数は落とす",
                vec![r"C:\app\md-peruse.exe", "--debug", r"D:\docs\notes.txt"],
                r"C:\work",
                vec![],
            ),
            (
                "複数の引数は渡された順",
                vec![r"C:\app\md-peruse.exe", r"D:\b.md", r"D:\a.markdown"],
                r"C:\work",
                vec![r"D:\b.md", r"D:\a.markdown"],
            ),
            (
                "作業ディレクトリが空なら、相対パスのまま残す",
                vec![r"C:\app\md-peruse.exe", r"docs\a.md"],
                "",
                vec![r"docs\a.md"],
            ),
        ];
        for (name, argv, base, expected) in cases {
            assert_eq!(
                requested_files(&strings(&argv), Path::new(base)),
                strings(&expected),
                "{name}"
            );
        }
    }

    /// 復元とFrontendの準備の両方がそろうまで開かず、そろった時点で、届いた順に返す。
    /// どちらが先でも同じ。そろったあとに届いたものは、すぐ返す。
    #[test]
    fn files_are_held_until_both_conditions_are_met() {
        #[derive(Clone, Copy)]
        enum Step {
            Push(&'static [&'static str]),
            Restored,
            Ready,
        }
        use Step::{Push, Ready, Restored};
        // 名前、順に起こす出来事、出来事ごとに返るファイル。
        type Case = (&'static str, Vec<Step>, Vec<Vec<&'static str>>);

        let cases: [Case; 6] = [
            (
                "復元が先",
                vec![Push(&["a"]), Restored, Ready],
                vec![vec![], vec![], vec!["a"]],
            ),
            (
                "Frontendの準備が先",
                vec![Push(&["a"]), Ready, Restored],
                vec![vec![], vec![], vec!["a"]],
            ),
            (
                "そろったあとに届いたものはすぐ返す",
                vec![Restored, Ready, Push(&["a"]), Push(&["b"])],
                vec![vec![], vec![], vec!["a"], vec!["b"]],
            ),
            (
                "そろう前に届いたものは、届いた順",
                vec![Push(&["a"]), Push(&["b", "c"]), Restored, Ready],
                vec![vec![], vec![], vec![], vec!["a", "b", "c"]],
            ),
            (
                "返したものは二度返さない",
                vec![Push(&["a"]), Restored, Ready, Ready, Restored],
                vec![vec![], vec![], vec!["a"], vec![], vec![]],
            ),
            (
                "何も届かなければ、そろっても返すものがない",
                vec![Restored, Ready],
                vec![vec![], vec![]],
            ),
        ];
        for (name, steps, expected) in cases {
            let queue = LaunchQueue::new();
            let returned: Vec<Vec<String>> = steps
                .into_iter()
                .map(|step| match step {
                    Push(files) => queue.push(strings(files)),
                    Restored => queue.mark_restored(),
                    Ready => queue.mark_frontend_ready(),
                })
                .collect();
            let expected: Vec<Vec<String>> = expected
                .iter()
                .map(|files| strings(files.as_slice()))
                .collect();
            assert_eq!(returned, expected, "{name}");
        }
    }

    /// 先に取り出したファイルを開く処理が遅くても、そのあとに届いた2つ目の起動が追い越さない。
    /// 取り出してから開き終えるまでを直列にしないと、後のファイルが先に開き、最後にアクティブに
    /// なるタブが届いた順と食い違う（9.2）。
    #[test]
    fn a_slow_opening_is_not_overtaken_by_a_later_launch() {
        use std::sync::mpsc;
        use std::time::Duration;

        let queue = Arc::new(LaunchQueue::new());
        // 起動引数のファイルを保留し、復元を済ませておく。Frontendの準備が済むと、取り出せる。
        assert!(queue.push(strings(&["a"])).is_empty());
        assert!(queue.mark_restored().is_empty());
        let opened = Arc::new(Mutex::new(Vec::<Vec<String>>::new()));
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel::<()>();

        let first = {
            let (queue, opened) = (Arc::clone(&queue), Arc::clone(&opened));
            thread::spawn(move || {
                queue.deliver(LaunchQueue::mark_frontend_ready, |files| {
                    started_tx.send(()).unwrap();
                    // ストレージの応答が遅い。
                    release_rx.recv().unwrap();
                    opened.lock().unwrap().push(files.to_vec());
                });
            })
        };
        started_rx.recv().unwrap();

        // 先のファイルを開いている間に、2つ目のプロセスの起動が届く。
        let second = {
            let (queue, opened) = (Arc::clone(&queue), Arc::clone(&opened));
            thread::spawn(move || {
                queue.deliver(
                    |queue| queue.push(strings(&["b"])),
                    |files| opened.lock().unwrap().push(files.to_vec()),
                );
            })
        };
        thread::sleep(Duration::from_millis(100));
        assert!(
            opened.lock().unwrap().is_empty(),
            "先のファイルより先に開いた"
        );

        release_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        assert_eq!(
            *opened.lock().unwrap(),
            vec![strings(&["a"]), strings(&["b"])]
        );
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("md-peruse-launch-{name}-{}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }

        fn write(&self, relative: &str) -> PathBuf {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"# doc\n").unwrap();
            path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// 状態を登録した `mock_app`。
    fn app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(AppState::new(LanguagePreference::System));
        app.manage(LaunchQueue::new());
        app
    }

    fn collect(app: &tauri::App<tauri::test::MockRuntime>) -> Arc<Mutex<Vec<OpenDocumentEvent>>> {
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);
        app.listen(OPEN_DOCUMENT_EVENT, move |event| {
            sink.lock()
                .expect("記録のロックに失敗")
                .push(serde_json::from_str(event.payload()).expect("指示を解釈できない"));
        });
        received
    }

    fn paths(events: &Arc<Mutex<Vec<OpenDocumentEvent>>>) -> Vec<String> {
        events
            .lock()
            .unwrap()
            .iter()
            .map(|event| event.path.clone())
            .collect()
    }

    fn argv(files: &[&Path]) -> Vec<String> {
        std::iter::once("md-peruse.exe".to_owned())
            .chain(files.iter().map(|file| file.to_string_lossy().into_owned()))
            .collect()
    }

    /// 新規に起動して渡されたファイルは、復元とFrontendの準備の両方が済むまで開かない。
    /// 開く前にWebViewへ送ると、購読前のeventは誰にも届かない。
    #[test]
    fn a_startup_file_is_not_opened_before_both_conditions_are_met() {
        let temp = TempDir::new("startup");
        let a = temp.write("a.md");
        let app = app();
        let events = collect(&app);

        received_at_startup(app.handle(), &argv(&[&a]));
        assert!(paths(&events).is_empty());
        restored(app.handle());
        assert!(paths(&events).is_empty(), "Frontendの準備の前に開いた");
        frontend_ready(app.handle());

        assert_eq!(paths(&events), ["a.md"]);
    }

    /// 応答の遅いストレージでは、Frontendの準備のほうが先に済む。復元が済んだ時点で開く。
    #[test]
    fn a_startup_file_is_opened_when_the_restore_finishes_last() {
        let temp = TempDir::new("slow-restore");
        let a = temp.write("a.md");
        let app = app();
        let events = collect(&app);

        received_at_startup(app.handle(), &argv(&[&a]));
        frontend_ready(app.handle());
        assert!(paths(&events).is_empty(), "復元の前に開いた");
        restored(app.handle());

        assert_eq!(paths(&events), ["a.md"]);
    }

    /// 起動中に届いた2つ目の起動は、準備が済んでいれば既存のインスタンスのタブとして、
    /// すぐ開く。新しい文書が、すでに開いた文書のあとに来る。
    #[test]
    fn a_second_launch_opens_at_once_once_the_app_is_ready() {
        let temp = TempDir::new("second");
        let a = temp.write("a.md");
        let b = temp.write("sub/b.md");
        let app = app();
        let events = collect(&app);
        received_at_startup(app.handle(), &argv(&[&a]));
        restored(app.handle());
        frontend_ready(app.handle());
        assert_eq!(paths(&events), ["a.md"]);

        receive(app.handle(), &argv(&[&b]), &temp.0);

        assert_eq!(paths(&events), ["a.md", "b.md"]);
    }

    /// 準備が済む前に届いた2つ目の起動は、起動引数のファイルのあとに、届いた順で開く。
    #[test]
    fn a_second_launch_before_ready_follows_the_startup_files() {
        let temp = TempDir::new("early-second");
        let a = temp.write("a.md");
        let b = temp.write("b.md");
        let app = app();
        let events = collect(&app);

        received_at_startup(app.handle(), &argv(&[&a]));
        receive(app.handle(), &argv(&[&b]), &temp.0);
        restored(app.handle());
        frontend_ready(app.handle());

        assert_eq!(paths(&events), ["a.md", "b.md"]);
    }

    /// 相対パスの2つ目の起動は、起動中のインスタンスではなく、2つ目のプロセスの作業
    /// ディレクトリで解決する。
    #[test]
    fn a_relative_path_is_resolved_against_the_second_process_directory() {
        let temp = TempDir::new("relative");
        temp.write("work/notes.md");
        let app = app();
        let events = collect(&app);
        restored(app.handle());
        frontend_ready(app.handle());

        let command_line = strings(&["md-peruse.exe", "notes.md"]);
        receive(app.handle(), &command_line, &temp.0.join("work"));

        assert_eq!(paths(&events), ["notes.md"]);
    }

    /// 対象のファイルを含まない起動は、何も開かない。
    #[test]
    fn a_launch_without_documents_opens_nothing() {
        let app = app();
        let events = collect(&app);
        restored(app.handle());
        frontend_ready(app.handle());

        receive(
            app.handle(),
            &strings(&["md-peruse.exe", "--debug"]),
            Path::new(r"C:\work"),
        );

        assert!(paths(&events).is_empty());
    }
}
