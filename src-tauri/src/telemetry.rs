//! Microsoft Store向けカスタムイベント（design-decisions.md 11.4、[#21](https://github.com/scottlz0310/md-peruse/issues/21)）。
//!
//! 送信経路は `StoreServicesCustomEventLogger` であり、packaged classic appから
//! 呼べることを実測で確認している（13.5）。ここに置くのはイベントの集合と送信単位の
//! 規則だけであり、WinRTの呼び出しと発火点の埋め込みはPhase 4で行う。
//!
//! 送信するのはイベント名だけで、パラメータを持たせない。`Log()` は文字列1つを受け取り、
//! 名前以外を運ばない形がデータ最小化の要件（11.4）をそのまま満たす。

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
/// Phase 4で `Package::Current()` から行う。パッケージIDを持たない実行では取得自体が
/// 失敗するため、呼び出し側は `Option` として扱う。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PackageSignatureKind {
    None,
    Developer,
    Enterprise,
    Store,
    System,
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

#[cfg(test)]
mod tests {
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
}
