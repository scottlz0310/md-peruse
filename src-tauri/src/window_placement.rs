//! ウィンドウの位置とサイズの保存と復元（design-decisions.md 9.2、11.1）。
//!
//! 位置、サイズ、最大化の状態を、動きが落ち着くたびに設定へ反映し（書込みはdebounceされる）、
//! 起動時にメインウィンドウへ適用する。Frontendへは渡さない。
//!
//! 保存した配置が今の画面に合わないとき（外部ディスプレイを外した、解像度を変えた）は、
//! 復元せず既定の配置で開く。合わない配置へ復元すると、ウィンドウが画面の外に出て、
//! 利用者が取り戻せなくなる。

use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Runtime, WebviewWindow, WindowEvent,
};

use crate::settings::WindowPlacement;
use crate::settings_store::SettingsStore;

/// 動きが止まってから、ウィンドウの状態を読むまでの待ち時間。
///
/// 移動やサイズ変更のeventの時点では、最大化の状態がまだ反映されていない（実測）。最大化に
/// 伴うeventで読むと、画面いっぱいの大きさが「最大化していない配置」として保存され、元へ
/// 戻したときの大きさを失う。eventの後、次のeventが来なくなってから読めば、状態が揃っている。
/// ドラッグの最中に読み続けないことにもなる。
const SETTLE: Duration = Duration::from_millis(150);

/// タイトルバーの中央を確かめる縦位置。ウィンドウの上端からの物理ピクセル数。
///
/// タイトルバーは利用者がウィンドウを掴んで動かす場所である。ここが画面の外にあると、
/// ウィンドウを画面の中へ戻せない。タイトルバーの高さは100%のDPIで32 px前後であり、
/// 高いDPIではさらに厚くなるため、この位置は常にタイトルバーの内側にある。
const TITLE_BAR_PROBE: i32 = 16;

/// ディスプレイの範囲。仮想デスクトップ座標の物理ピクセルである。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Bounds {
    /// 点が範囲の内側にあるか。右端と下端は含めない。
    fn contains(&self, x: i64, y: i64) -> bool {
        let left = i64::from(self.x);
        let top = i64::from(self.y);
        x >= left
            && x < left + i64::from(self.width)
            && y >= top
            && y < top + i64::from(self.height)
    }
}

/// 保存した配置を、今接続しているディスプレイへ復元してよいか。
///
/// タイトルバーの中央が、いずれかのディスプレイの内側にあれば復元する。ウィンドウ全体が
/// 収まることまでは求めない。2つのディスプレイにまたがる配置や、解像度が下がって一部が
/// はみ出す配置は、利用者がタイトルバーを掴めるため戻せる。掴めない配置だけを弾く。
pub fn is_restorable(placement: &WindowPlacement, monitors: &[Bounds]) -> bool {
    if placement.width == 0 || placement.height == 0 {
        return false;
    }
    let center = i64::from(placement.x) + i64::from(placement.width / 2);
    let probe = i64::from(placement.y) + i64::from(TITLE_BAR_PROBE);
    monitors
        .iter()
        .any(|monitor| monitor.contains(center, probe))
}

/// 現在のウィンドウの状態から、保存する配置を決める。
///
/// 最大化中も、元へ戻したときの位置とサイズを保つ（`WindowPlacement`）。最大化中に取れる
/// 位置とサイズは画面いっぱいの値であり、それを保存すると、最大化を解いたときに画面いっぱいの
/// まま戻ってしまう。以前の配置が無ければ（初めて最大化されたとき）、いまの値を使う。
pub fn next_placement(
    previous: Option<WindowPlacement>,
    current: Bounds,
    maximized: bool,
) -> WindowPlacement {
    match (maximized, previous) {
        (true, Some(previous)) => WindowPlacement {
            maximized: true,
            ..previous
        },
        _ => WindowPlacement {
            x: current.x,
            y: current.y,
            width: current.width,
            height: current.height,
            maximized,
        },
    }
}

/// 接続中のディスプレイの範囲。取得できなかったときは `None` を返す。
fn monitors<R: Runtime>(app: &AppHandle<R>) -> Option<Vec<Bounds>> {
    let monitors = app.available_monitors().ok()?;
    Some(
        monitors
            .iter()
            .map(|monitor| Bounds {
                x: monitor.position().x,
                y: monitor.position().y,
                width: monitor.size().width,
                height: monitor.size().height,
            })
            .collect(),
    )
}

/// 保存した配置のうち、今の画面へ復元してよいもの。
///
/// ディスプレイを取得できないときは、復元してよいか判断できないため復元しない。
pub fn placement_to_restore<R: Runtime>(
    app: &AppHandle<R>,
    saved: Option<WindowPlacement>,
) -> Option<WindowPlacement> {
    let placement = saved?;
    let monitors = monitors(app)?;
    is_restorable(&placement, &monitors).then_some(placement)
}

/// 配置をウィンドウへ適用して表示する。
///
/// ウィンドウは非表示で作ってあり、配置してから表示する。表示してから動かすと、既定の位置に
/// 一瞬見える。位置は外枠の左上、サイズは内側の大きさである（`WindowPlacement`）。最大化は
/// 位置を決めた後に行い、保存した位置のディスプレイで最大化する。
pub fn apply<R: Runtime>(
    window: &WebviewWindow<R>,
    placement: WindowPlacement,
) -> tauri::Result<()> {
    window.set_position(PhysicalPosition::new(placement.x, placement.y))?;
    window.set_size(PhysicalSize::new(placement.width, placement.height))?;
    if placement.maximized {
        window.maximize()?;
    }
    window.show()
}

/// ウィンドウの移動、サイズ変更、最大化を設定へ反映し続ける。
///
/// eventが届いたら、動きが落ち着く（`SETTLE`）のを待ってから読む。読む専用のスレッドを1つ持つ。
/// eventごとにスレッドを起こすと、ドラッグで大量に届くeventのぶんだけ待ちのスレッドが増える。
/// 反映は設定のメモリ上の値を書き換えるだけで、書込みはdebounceされ、終了時に書き出される
/// （11.1）。アイドル時に周期的な書込みは行わない。
///
/// eventの送り手は、eventの購読が破棄されると無くなり、そのときスレッドも終わる。
pub fn track<R: Runtime>(window: &WebviewWindow<R>) {
    let (notify, moved) = mpsc::channel();
    let tracked = window.clone();
    thread::spawn(move || {
        while wait_until_quiet(&moved, SETTLE) {
            capture(&tracked);
        }
    });
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            // 受け手のスレッドが終わっているのは、終了処理中である。伝える相手がいない。
            let _ = notify.send(());
        }
    });
}

/// 通知を待ち、届いたあと、`quiet` の間に次の通知が来なくなるまで待つ。
///
/// 動きが落ち着いたら `true` を返す。通知の送り手がすべて無くなって待てないときは `false`
/// を返す。最後の通知のあとに送り手が無くなったときは、その通知ぶんを `true` で返す。
fn wait_until_quiet(notifications: &Receiver<()>, quiet: Duration) -> bool {
    if notifications.recv().is_err() {
        return false;
    }
    loop {
        match notifications.recv_timeout(quiet) {
            Ok(()) => continue,
            Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => return true,
        }
    }
}

/// いまのウィンドウの配置を設定へ反映する。
fn capture<R: Runtime>(window: &WebviewWindow<R>) {
    // 最小化されたウィンドウは、Windowsが画面の外（-32000, -32000）へ置く。保存すると、
    // 次の起動で画面外の位置として弾かれ、配置を失う。
    let Ok(false) = window.is_minimized() else {
        return;
    };
    let (Ok(position), Ok(size), Ok(maximized)) = (
        window.outer_position(),
        window.inner_size(),
        window.is_maximized(),
    ) else {
        // 取れなかったときは、前回の配置を保つ。
        return;
    };
    let store = window.state::<SettingsStore>();
    let placement = next_placement(
        store.settings().window,
        Bounds {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        },
        maximized,
    );
    store.set_window(placement);
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: Bounds = Bounds {
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
    };

    /// 左側のディスプレイは、仮想デスクトップ座標で負の位置にある。
    const LEFT: Bounds = Bounds {
        x: -1920,
        y: 0,
        width: 1920,
        height: 1080,
    };

    fn placement(x: i32, y: i32, width: u32, height: u32) -> WindowPlacement {
        WindowPlacement {
            x,
            y,
            width,
            height,
            maximized: false,
        }
    }

    /// タイトルバーの中央が、接続中のいずれかのディスプレイの内側なら復元する。
    #[test]
    fn a_placement_with_a_reachable_title_bar_is_restored() {
        let cases = [
            (
                "主ディスプレイの中",
                placement(100, 100, 1200, 800),
                &[PRIMARY][..],
                true,
            ),
            (
                "左のディスプレイ（負の座標）",
                placement(-1500, 50, 1200, 800),
                &[PRIMARY, LEFT][..],
                true,
            ),
            (
                "外したディスプレイの上",
                placement(-1500, 50, 1200, 800),
                &[PRIMARY][..],
                false,
            ),
            (
                "下へはみ出しても、タイトルバーは見える",
                placement(100, 1000, 1200, 800),
                &[PRIMARY][..],
                true,
            ),
            (
                "上へはみ出して、タイトルバーが見えない",
                placement(100, -400, 1200, 800),
                &[PRIMARY][..],
                false,
            ),
            (
                "タイトルバーの中央が右の外",
                placement(1500, 100, 1200, 800),
                &[PRIMARY][..],
                false,
            ),
            (
                "2つのディスプレイにまたがる（中央は右のディスプレイ）",
                placement(1400, 100, 1200, 800),
                &[
                    PRIMARY,
                    Bounds {
                        x: 1920,
                        y: 0,
                        width: 1920,
                        height: 1080,
                    },
                ][..],
                true,
            ),
            (
                "ディスプレイがない",
                placement(100, 100, 1200, 800),
                &[][..],
                false,
            ),
        ];
        for (name, saved, monitors, expected) in cases {
            assert_eq!(is_restorable(&saved, monitors), expected, "{name}");
        }
    }

    /// 続けて届く通知は1つにまとめ、動きが落ち着いてから1回だけ知らせる。
    #[test]
    fn a_burst_of_notifications_settles_once() {
        let (notify, notifications) = mpsc::channel();
        for _ in 0..50 {
            notify.send(()).unwrap();
        }
        let quiet = Duration::from_millis(30);

        assert!(wait_until_quiet(&notifications, quiet));

        // 50件はすべて読み終えている。次は、新しい通知を待つ。
        notify.send(()).unwrap();
        assert!(wait_until_quiet(&notifications, quiet));
        assert!(matches!(
            notifications.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
    }

    /// 通知の間隔が空くと、それぞれ別の落ち着きとして数える。
    #[test]
    fn notifications_apart_in_time_settle_separately() {
        let (notify, notifications) = mpsc::channel();
        let quiet = Duration::from_millis(30);
        let sender = thread::spawn(move || {
            notify.send(()).unwrap();
            thread::sleep(Duration::from_millis(200));
            notify.send(()).unwrap();
            // 最後の通知のあとに、送り手が無くなる。
        });

        let settled = (0..3)
            .take_while(|_| wait_until_quiet(&notifications, quiet))
            .count();

        sender.join().unwrap();
        assert_eq!(settled, 2);
    }

    /// 送り手がすべて無くなり、通知が残っていなければ、待たずに終わる。
    #[test]
    fn waiting_ends_when_every_sender_is_gone() {
        let (notify, notifications) = mpsc::channel::<()>();
        drop(notify);

        assert!(!wait_until_quiet(&notifications, Duration::from_millis(30)));
    }

    /// 大きさが0の配置は、壊れた値として復元しない。
    #[test]
    fn a_placement_without_a_size_is_not_restored() {
        assert!(!is_restorable(&placement(100, 100, 0, 800), &[PRIMARY]));
        assert!(!is_restorable(&placement(100, 100, 1200, 0), &[PRIMARY]));
    }

    /// ディスプレイの右端と下端は、内側に含めない。
    #[test]
    fn the_far_edges_of_a_display_are_outside() {
        assert!(PRIMARY.contains(1919, 1079));
        assert!(!PRIMARY.contains(1920, 100));
        assert!(!PRIMARY.contains(100, 1080));
        assert!(!PRIMARY.contains(-1, 100));
    }

    /// 最大化していないときは、いまの位置とサイズを保存する。
    #[test]
    fn a_normal_window_saves_its_current_bounds() {
        let previous = placement(0, 0, 500, 500);
        let current = Bounds {
            x: 40,
            y: 50,
            width: 1000,
            height: 700,
        };

        assert_eq!(
            next_placement(Some(previous), current, false),
            placement(40, 50, 1000, 700)
        );
        assert_eq!(
            next_placement(None, current, false),
            placement(40, 50, 1000, 700)
        );
    }

    /// 最大化中は、元へ戻したときの位置とサイズを保ち、最大化の状態だけを変える。
    #[test]
    fn a_maximized_window_keeps_its_restored_bounds() {
        let previous = placement(40, 50, 1000, 700);
        let screen_sized = Bounds {
            x: -8,
            y: -8,
            width: 1936,
            height: 1048,
        };

        let next = next_placement(Some(previous), screen_sized, true);

        assert_eq!(
            next,
            WindowPlacement {
                maximized: true,
                ..previous
            }
        );
    }

    /// 最大化から元へ戻したときは、最大化の状態を外し、戻った位置とサイズを保存する。
    #[test]
    fn restoring_from_maximized_saves_the_restored_bounds() {
        let previous = WindowPlacement {
            maximized: true,
            ..placement(40, 50, 1000, 700)
        };
        let restored = Bounds {
            x: 60,
            y: 70,
            width: 900,
            height: 600,
        };

        assert_eq!(
            next_placement(Some(previous), restored, false),
            placement(60, 70, 900, 600)
        );
    }

    /// 以前の配置が無いまま最大化されたときは、いまの値を使う。
    #[test]
    fn maximizing_without_a_previous_placement_uses_the_current_bounds() {
        let current = Bounds {
            x: -8,
            y: -8,
            width: 1936,
            height: 1048,
        };

        assert_eq!(
            next_placement(None, current, true),
            WindowPlacement {
                x: -8,
                y: -8,
                width: 1936,
                height: 1048,
                maximized: true,
            }
        );
    }
}
