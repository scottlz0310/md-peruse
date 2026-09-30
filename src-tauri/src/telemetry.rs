//! Microsoft Store向けカスタムイベント（design-decisions.md 11.4、[#21](https://github.com/scottlz0310/md-peruse/issues/21)）。
//!
//! 送信経路は `StoreServicesCustomEventLogger` であり、packaged classic appから
//! 呼べることを実測で確認している（13.5）。ここに置くのはイベントの集合、送信単位の規則、
//! Store署名のときだけ送る判定、送信の口（`EventLogger`）である。発火点は各機能の側にあり、
//! `Telemetry::record` を呼ぶ。WinRTでの実送信は `EventLogger` の実装として足す。それまでの
//! 製品は何も送らない（`NullLogger`）。
//!
//! 送信するのはイベント名だけで、パラメータを持たせない。`Log()` は文字列1つを受け取り、
//! 名前以外を運ばない形がデータ最小化の要件（11.4）をそのまま満たす。

use std::sync::Mutex;

/// Store版で送信するカスタムイベント。
///
/// 初回リリースから固定し、増やさない（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）。
/// 後からイベントを足すと、それ以前の利用状況と比較できなくなるためである。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TelemetryEvent {
    /// セッションの開始。すべての率の分母になる。
    SessionStart,
    /// Markdownの描画が完了した。ファイルを選んだ時点ではなく、描画の完了時に送る。
    OpenMdOk,
    /// Markdownを描画できなかった。
    OpenMdFail,
    /// ワークスペースを開いた。
    OpenFolder,
    /// 関連付けから起動された。
    LaunchByAssociation,
}

/// 送信するイベントの全体。順序は集計時の並びと関係しない。
pub const ALL_EVENTS: [TelemetryEvent; 5] = [
    TelemetryEvent::SessionStart,
    TelemetryEvent::OpenMdOk,
    TelemetryEvent::OpenMdFail,
    TelemetryEvent::OpenFolder,
    TelemetryEvent::LaunchByAssociation,
];

impl TelemetryEvent {
    /// Partner Centerへ現れるイベント名。
    ///
    /// 初回リリース後は変更しない。名前を変えると、Usage reportの上では別のイベントに
    /// なり、リリースをまたいだ比較ができなくなる。
    pub fn name(self) -> &'static str {
        match self {
            Self::SessionStart => "session_start",
            Self::OpenMdOk => "open_md_ok",
            Self::OpenMdFail => "open_md_fail",
            Self::OpenFolder => "open_folder",
            Self::LaunchByAssociation => "launch_by_association",
        }
    }
}

/// パッケージの署名種別。
///
/// WinRTの `Windows.ApplicationModel.PackageSignatureKind` に対応する。値の取得は
/// `package_signature_kind` が `Package::Current()` から行う。パッケージIDを持たない実行では
/// 取得自体が失敗するため、呼び出し側は `Option` として扱う。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageSignatureKind {
    None,
    Developer,
    Enterprise,
    Store,
    System,
}

impl PackageSignatureKind {
    /// WinRTの列挙値から写す。知らない値は `None`（`Option`）とし、送信しない側へ倒す。
    fn from_raw(raw: i32) -> Option<Self> {
        match raw {
            0 => Some(Self::None),
            1 => Some(Self::Developer),
            2 => Some(Self::Enterprise),
            3 => Some(Self::Store),
            4 => Some(Self::System),
            _ => Option::None,
        }
    }
}

/// このプロセスのパッケージの署名種別を返す。
///
/// パッケージIDを持たない実行（`bun run tauri dev` を含む）では `Package::Current()` が
/// 失敗するため `None`（`Option`）を返し、署名種別を得られない場合として同じ判定
/// （`should_send`）へ集約する（11.4）。
pub fn package_signature_kind() -> Option<PackageSignatureKind> {
    let package = windows::ApplicationModel::Package::Current().ok()?;
    let kind = package.SignatureKind().ok()?;
    PackageSignatureKind::from_raw(kind.0)
}

/// カスタムイベントを送ってよいかを、パッケージの署名種別から判定する。
///
/// Storeから配布されたパッケージのときだけ送る。パッケージIDを持たない実行では
/// 送信経路そのものが成立しない（13.5）が、それだけでは足りない。開発用の自己署名
/// MSIXやパッケージ化したE2E実行は、Engagement と VCLibs の `PackageDependency` を
/// 宣言していれば送信に成功してしまうためである（11.4）。
pub fn should_send(signature_kind: Option<PackageSignatureKind>) -> bool {
    matches!(signature_kind, Some(PackageSignatureKind::Store))
}

/// 1セッションで各イベントを1回だけ送るための記録。
///
/// 5つすべてをセッション単位とすることで、どの率も `session_start` を分母として
/// そのまま読める（11.4）。発生ごとに送るイベントが1つでも混ざると、その系列だけが
/// 100 %を超えうる。Partner Center側には件数しか残らないため、後から分母を推定し直す
/// こともできない。
#[derive(Debug, Clone, Default)]
pub struct SessionTelemetry {
    sent: Vec<TelemetryEvent>,
}

impl SessionTelemetry {
    pub fn new() -> Self {
        Self::default()
    }

    /// このセッションでまだ送っていなければ、送信済みとして記録して `true` を返す。
    ///
    /// 呼び出し側は `true` のときだけ送信する。記録と送信可否の判定を分けると、
    /// 送信に失敗したイベントを再送するかどうかという別の判断が要る。送信失敗は
    /// 握って進む方針（11.4）であり、再送しないため両者を分けない。
    pub fn take(&mut self, event: TelemetryEvent) -> bool {
        if self.sent.contains(&event) {
            return false;
        }
        self.sent.push(event);
        true
    }

    /// このセッションで送信済みかどうか。
    pub fn is_sent(&self, event: TelemetryEvent) -> bool {
        self.sent.contains(&event)
    }
}

/// 送信に失敗したこと。原因は運ばない。
///
/// 送信の失敗は無視する（11.4）ため、呼び出し側が原因で分岐することはない。失敗の内容に
/// パスなどが入りうる型を経由させないためでもある。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LogFailed;

/// カスタムイベントの送信の口。名前だけを受け取る（11.4）。
///
/// WinRTの `StoreServicesCustomEventLogger.Log()` は失敗をHRESULTとして返す。実装はそれを
/// `LogFailed` へ写す。例外やプロセス終了にはならない（13.5）。
pub trait EventLogger: Send + Sync {
    fn log(&self, name: &str) -> Result<(), LogFailed>;
}

/// 何も送らない送信の口。WinRTでの実送信を足すまでの間、製品はこれを使う。
#[derive(Debug, Clone, Copy, Default)]
pub struct NullLogger;

impl EventLogger for NullLogger {
    fn log(&self, _name: &str) -> Result<(), LogFailed> {
        Ok(())
    }
}

/// カスタムイベントの発火点が呼ぶ入口。
///
/// 次の3つを、発火点ごとに書かずここへ集める。
///
/// - Storeから配布されたパッケージのときだけ送る。パッケージ化した開発版・テスト版と、
///   非パッケージ実行では送らない（11.4）。判定を経路に必ず通す。
/// - 各イベントを1セッションに1回だけ送る。
/// - 送信の失敗を無視する。呼び出し元の操作の成否は、送信の成否に依存させない。
pub struct Telemetry {
    logger: Box<dyn EventLogger>,
    signature_kind: Option<PackageSignatureKind>,
    session: Mutex<SessionTelemetry>,
}

impl Telemetry {
    pub fn new(logger: Box<dyn EventLogger>, signature_kind: Option<PackageSignatureKind>) -> Self {
        Self {
            logger,
            signature_kind,
            session: Mutex::new(SessionTelemetry::new()),
        }
    }

    /// このプロセスの署名種別で作る。送信の口は `NullLogger` のままで、何も送らない。
    pub fn for_this_process() -> Self {
        Self::new(Box::new(NullLogger), package_signature_kind())
    }

    /// イベントを1つ記録する。送る条件を満たすときだけ送る。
    ///
    /// 呼び出し元の操作が完了した後に呼ぶ。送信の結果は返さない。
    pub fn record(&self, event: TelemetryEvent) {
        if !should_send(self.signature_kind) {
            return;
        }
        // `panic = "abort"` の下では毒される経路が生じない（12章）。
        let first = self
            .session
            .lock()
            .expect("テレメトリのセッション記録のロックに失敗")
            .take(event);
        if !first {
            return;
        }
        // 送信の失敗は無視し、ログにも残さない。再送もしない（11.4）。ロックは放してから送る。
        let _ = self.logger.log(event.name());
    }

    /// プロセスの起動時に記録するイベントをまとめて記録する。
    ///
    /// `session_start` は起動のたびに1回、`launch_by_association` は関連付け起動でファイルを
    /// 受け取った起動に限る。起動中のインスタンスへ渡された2つ目のプロセスの引数では呼ばない。
    /// 新しいセッションが始まらず、送ると `launch_by_association / session_start` が100 %を
    /// 超える（11.4）。
    pub fn record_process_start(&self, launched_by_association: bool) {
        self.record(TelemetryEvent::SessionStart);
        if launched_by_association {
            self.record(TelemetryEvent::LaunchByAssociation);
        }
    }
}

/// 他のモジュールのテストが、送った名前を確かめるための送信の口。
#[cfg(test)]
pub(crate) mod testing {
    use super::{EventLogger, LogFailed};
    use std::sync::{Arc, Mutex};

    /// 送った名前を記録する送信の口。`fail` のときは、記録してから失敗を返す。
    #[derive(Clone, Default)]
    pub(crate) struct RecordingLogger {
        pub(crate) names: Arc<Mutex<Vec<String>>>,
        pub(crate) fail: bool,
    }

    impl EventLogger for RecordingLogger {
        fn log(&self, name: &str) -> Result<(), LogFailed> {
            self.names.lock().unwrap().push(name.to_owned());
            if self.fail { Err(LogFailed) } else { Ok(()) }
        }
    }

    impl RecordingLogger {
        /// これまでに送った名前。
        pub(crate) fn sent(&self) -> Vec<String> {
            self.names.lock().unwrap().clone()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::testing::RecordingLogger;
    use super::*;

    #[test]
    fn event_names_are_stable_and_unique() {
        let expected = [
            (TelemetryEvent::SessionStart, "session_start"),
            (TelemetryEvent::OpenMdOk, "open_md_ok"),
            (TelemetryEvent::OpenMdFail, "open_md_fail"),
            (TelemetryEvent::OpenFolder, "open_folder"),
            (TelemetryEvent::LaunchByAssociation, "launch_by_association"),
        ];
        for (event, name) in expected {
            assert_eq!(event.name(), name);
        }

        for (index, event) in ALL_EVENTS.iter().enumerate() {
            let duplicated = ALL_EVENTS
                .iter()
                .skip(index + 1)
                .any(|other| other.name() == event.name());
            assert!(!duplicated, "重複したイベント名: {}", event.name());
        }
    }

    /// イベントを増やさない制約（#21）を、集合の要素数として固定する。
    #[test]
    fn event_set_stays_at_five() {
        assert_eq!(ALL_EVENTS.len(), 5);
    }

    #[test]
    fn each_event_is_sent_once_per_session() {
        let mut session = SessionTelemetry::new();
        for event in ALL_EVENTS {
            assert!(session.take(event), "1回目は送る: {}", event.name());
            assert!(!session.take(event), "2回目は送らない: {}", event.name());
            assert!(session.is_sent(event));
        }
    }

    /// イベントどうしが互いの送信可否へ影響しないことを固定する。
    #[test]
    fn events_are_tracked_independently() {
        let mut session = SessionTelemetry::new();
        assert!(session.take(TelemetryEvent::OpenMdFail));
        assert!(!session.is_sent(TelemetryEvent::OpenMdOk));
        assert!(session.take(TelemetryEvent::OpenMdOk));
    }

    /// Store署名のパッケージだけが送信対象であることを固定する。
    ///
    /// 開発用の自己署名MSIXは `Developer` を返す。パッケージIDを持たない実行では
    /// 署名種別を取得できず `None` になる。どちらも送らない。
    #[test]
    fn only_store_signed_packages_send_events() {
        let cases = [
            (None, false),
            (Some(PackageSignatureKind::None), false),
            (Some(PackageSignatureKind::Developer), false),
            (Some(PackageSignatureKind::Enterprise), false),
            (Some(PackageSignatureKind::System), false),
            (Some(PackageSignatureKind::Store), true),
        ];
        for (kind, expected) in cases {
            assert_eq!(should_send(kind), expected, "入力: {kind:?}");
        }
    }

    /// 新しいセッションでは送信済みの記録を引き継がないことを固定する。
    #[test]
    fn a_new_session_starts_empty() {
        let mut first = SessionTelemetry::new();
        assert!(first.take(TelemetryEvent::SessionStart));

        let second = SessionTelemetry::new();
        for event in ALL_EVENTS {
            assert!(!second.is_sent(event));
        }
    }

    fn telemetry(
        logger: &RecordingLogger,
        signature_kind: Option<PackageSignatureKind>,
    ) -> Telemetry {
        Telemetry::new(Box::new(logger.clone()), signature_kind)
    }

    /// WinRTの列挙値を写す。知らない値は署名種別を得られない場合として扱い、送らない側へ倒す。
    #[test]
    fn signature_kinds_map_from_the_winrt_values() {
        let cases = [
            (0, Some(PackageSignatureKind::None)),
            (1, Some(PackageSignatureKind::Developer)),
            (2, Some(PackageSignatureKind::Enterprise)),
            (3, Some(PackageSignatureKind::Store)),
            (4, Some(PackageSignatureKind::System)),
            (5, None),
            (-1, None),
        ];
        for (raw, expected) in cases {
            assert_eq!(PackageSignatureKind::from_raw(raw), expected, "入力: {raw}");
        }
    }

    /// 送信の口までの経路が、署名種別の判定を必ず通ることを固定する。Store署名のときだけ
    /// 名前が届き、パッケージ化した開発版（`Developer`）と非パッケージ実行（`None`）では、
    /// どのイベントも届かない（11.4）。
    #[test]
    fn events_reach_the_logger_only_for_store_signed_packages() {
        let cases = [
            ("非パッケージ実行", None, false),
            ("署名なし", Some(PackageSignatureKind::None), false),
            ("開発用の署名", Some(PackageSignatureKind::Developer), false),
            (
                "企業向けの署名",
                Some(PackageSignatureKind::Enterprise),
                false,
            ),
            ("システム", Some(PackageSignatureKind::System), false),
            ("Store", Some(PackageSignatureKind::Store), true),
        ];
        for (name, kind, delivered) in cases {
            let logger = RecordingLogger::default();
            let telemetry = telemetry(&logger, kind);
            for event in ALL_EVENTS {
                telemetry.record(event);
            }
            let expected: Vec<String> = if delivered {
                ALL_EVENTS
                    .iter()
                    .map(|event| event.name().to_owned())
                    .collect()
            } else {
                Vec::new()
            };
            assert_eq!(logger.sent(), expected, "{name}");
        }
    }

    /// 各イベントは、1セッションに1回だけ届く。運ぶのはイベント名だけである（11.4）。
    #[test]
    fn each_event_reaches_the_logger_once_per_session() {
        let logger = RecordingLogger::default();
        let telemetry = telemetry(&logger, Some(PackageSignatureKind::Store));

        for _ in 0..3 {
            telemetry.record(TelemetryEvent::OpenMdOk);
        }
        telemetry.record(TelemetryEvent::OpenMdFail);
        telemetry.record(TelemetryEvent::OpenMdOk);

        assert_eq!(logger.sent(), ["open_md_ok", "open_md_fail"]);
    }

    /// 送信に失敗しても、記録した側には何も返らず、再送もしない（11.4）。
    #[test]
    fn a_failing_logger_is_ignored_and_not_retried() {
        let logger = RecordingLogger {
            fail: true,
            ..RecordingLogger::default()
        };
        let telemetry = telemetry(&logger, Some(PackageSignatureKind::Store));

        telemetry.record(TelemetryEvent::OpenFolder);
        telemetry.record(TelemetryEvent::OpenFolder);
        telemetry.record(TelemetryEvent::OpenMdOk);

        assert_eq!(logger.sent(), ["open_folder", "open_md_ok"]);
    }

    /// プロセスの起動で記録するのは `session_start` で、関連付け起動でファイルを受け取った
    /// 起動に限り `launch_by_association` も記録する。Store署名のときだけ届く（11.4）。
    #[test]
    fn process_start_records_the_session_and_the_association_launch() {
        let cases = [
            (
                "通常の起動",
                Some(PackageSignatureKind::Store),
                false,
                vec!["session_start"],
            ),
            (
                "関連付け起動",
                Some(PackageSignatureKind::Store),
                true,
                vec!["session_start", "launch_by_association"],
            ),
            (
                "開発版の関連付け起動",
                Some(PackageSignatureKind::Developer),
                true,
                vec![],
            ),
            ("非パッケージの起動", None, true, vec![]),
        ];
        for (name, kind, by_association, expected) in cases {
            let logger = RecordingLogger::default();
            let telemetry = telemetry(&logger, kind);
            telemetry.record_process_start(by_association);
            assert_eq!(logger.sent(), expected, "{name}");
        }
    }

    /// 送らない条件のイベントは、セッションの記録も消費しない。署名種別は変わらないが、
    /// 判定が先で記録が後であることを固定する（送らないのに「送った」と記録しない）。
    #[test]
    fn events_that_are_not_sent_are_not_recorded_as_sent() {
        let logger = RecordingLogger::default();
        let telemetry = telemetry(&logger, Some(PackageSignatureKind::Developer));

        telemetry.record(TelemetryEvent::SessionStart);

        assert!(
            !telemetry
                .session
                .lock()
                .unwrap()
                .is_sent(TelemetryEvent::SessionStart)
        );
    }
}
