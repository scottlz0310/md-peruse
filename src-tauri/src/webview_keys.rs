//! WebViewにフォーカスがあるときのキー入力をネイティブメニューへ渡す（design-decisions.md 10.1）。
//!
//! WebView2はキー入力を別プロセスで受け取り、ホストウィンドウのアクセラレータ処理へ渡さない。
//! そのままでは `Ctrl+O` もアクセスキー（`Alt+F`）も効かない（実測）。WebView2が
//! ホストへ知らせる `AcceleratorKeyPressed` で拾い、メニューの選択と同じ処理へ渡す。
//! `Alt` 単独と `F10` はWebView2がホストへ渡しており、何もしなくてもメニューが開く（実測）。
//!
//! 同じ場所でWebView2のブラウザーアクセラレータキー（`Ctrl+R` の再読込、`Ctrl+P` の印刷、
//! `F12` の開発者ツールなど）も無効にする。製品UIにない操作だからである（10章）。無効にしても
//! キーはページへ届くため、WebView内で処理する `Ctrl+F` や `Alt+←` は影響を受けない（実測）。

use std::sync::mpsc::{self, TryRecvError};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use webview2_com::AcceleratorKeyPressedEventHandler;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
    COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, ICoreWebView2Controller, ICoreWebView2Settings3,
};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};
use windows::Win32::UI::WindowsAndMessaging::{PostMessageW, SC_KEYMENU, WM_SYSCOMMAND};
use windows::core::Interface;

use crate::menu::{ACCELERATORS, IMPLEMENTED, MenuCommand};

/// 押されたキーと修飾キーの状態。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeyPress {
    /// `WM_SYSKEYDOWN`（`Alt` を伴う押下）として届いたか。
    pub system: bool,
    pub virtual_key: u16,
    pub ctrl: bool,
    pub shift: bool,
    pub alt: bool,
}

/// キー入力の行き先。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyRoute {
    /// メニューの項目を選んだときと同じ処理を行う。
    Command(MenuCommand),
    /// アクセスキーとしてメニューバーへ渡す。値は小文字にした文字。
    MenuAccessKey(u16),
    /// WebViewへそのまま渡す。
    Page,
}

/// キー入力の行き先を決める。
///
/// メニューへ載せたコマンド（`IMPLEMENTED`）のアクセラレータだけを奪う。載せていない
/// コマンドの割り当てはネイティブ側でも登録されないため、同じ扱いにする。
pub fn route(key: KeyPress) -> KeyRoute {
    if let Some(command) = ACCELERATORS
        .iter()
        .filter(|(command, _)| IMPLEMENTED.contains(command))
        .find(|(_, accelerator)| parse(accelerator) == Some(Chord::of(key)))
        .map(|(command, _)| *command)
    {
        return KeyRoute::Command(command);
    }
    // 英数字以外（`Alt+←` など）はアクセスキーにならず、WebView内の処理（9.3）へ残す。
    let alphanumeric = matches!(key.virtual_key, 0x30..=0x39 | 0x41..=0x5A);
    if key.system && key.alt && !key.ctrl && alphanumeric {
        return KeyRoute::MenuAccessKey(u16::from((key.virtual_key as u8).to_ascii_lowercase()));
    }
    KeyRoute::Page
}

/// 修飾キーと仮想キーの組み合わせ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Chord {
    ctrl: bool,
    shift: bool,
    alt: bool,
    virtual_key: u16,
}

impl Chord {
    fn of(key: KeyPress) -> Self {
        Self {
            ctrl: key.ctrl,
            shift: key.shift,
            alt: key.alt,
            virtual_key: key.virtual_key,
        }
    }
}

/// `ACCELERATORS` の表記を仮想キーの組み合わせへ変換する。
///
/// 受け付けるキー名は `ACCELERATORS` で使う範囲（英字、数字、`F1`〜`F24`、`Equal`、
/// `Minus`）に限る。仮想キーはTauriが内部で使う `muda` がネイティブのアクセラレータ表へ
/// 登録する値に揃える。変換できない表記は `None` を返し、`every_accelerator_is_routable`
/// が止める。
fn parse(accelerator: &str) -> Option<Chord> {
    let mut chord = Chord {
        ctrl: false,
        shift: false,
        alt: false,
        virtual_key: 0,
    };
    let (modifiers, key) = accelerator.rsplit_once('+').unwrap_or(("", accelerator));
    for modifier in modifiers.split('+').filter(|part| !part.is_empty()) {
        match modifier {
            "Ctrl" => chord.ctrl = true,
            "Shift" => chord.shift = true,
            "Alt" => chord.alt = true,
            _ => return None,
        }
    }
    chord.virtual_key = match key.as_bytes() {
        [letter @ b'A'..=b'Z'] | [letter @ b'0'..=b'9'] => u16::from(*letter),
        [b'F', number @ ..] => {
            let number: u16 = std::str::from_utf8(number).ok()?.parse().ok()?;
            if !(1..=24).contains(&number) {
                return None;
            }
            // VK_F1 = 0x70
            0x6F + number
        }
        b"Equal" => 0xBB, // VK_OEM_PLUS
        b"Minus" => 0xBD, // VK_OEM_MINUS
        _ => return None,
    };
    Some(chord)
}

/// `attach` の失敗。WebView2の設定を始められなかった、または設定の呼び出しが失敗した。
///
/// 起動を止める失敗であり、呼び出し側が原因を示して終了する（`startup_failure`）。
#[derive(Debug)]
pub struct AttachError(String);

impl AttachError {
    fn new(context: &str, cause: &dyn std::fmt::Display) -> Self {
        Self(format!("{context}: {cause}"))
    }
}

impl std::fmt::Display for AttachError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl std::error::Error for AttachError {}

/// UIスレッドで実行した設定の結果を、`attach` へ取り出す。
///
/// `with_webview` の閉包は、メインスレッド（起動処理の中）から呼ぶと、その場で実行される。
/// 実行されないまま戻ったときは、設定が済んでいないため、失敗として扱う。
fn settled(received: Result<Result<(), AttachError>, TryRecvError>) -> Result<(), AttachError> {
    match received {
        Ok(result) => result,
        Err(TryRecvError::Empty | TryRecvError::Disconnected) => Err(AttachError::new(
            "WebView2の設定が、呼び出しの中で実行されなかった",
            &"閉包が実行されていない",
        )),
    }
}

/// メインウィンドウのWebViewへキー入力の転送を組み込み、ブラウザーアクセラレータキーを無効にする。
///
/// 失敗するのはWebView2のランタイムが `ICoreWebView2Settings3`（2021年のランタイム）より古い
/// 場合などであり、そのまま起動するとメニューのキーが効かない状態で動き続けるため、起動を止める。
/// COMの呼び出しの失敗は、panicにせず、`Result` で返す。`panic = "abort"` のReleaseでは、
/// panicすると原因を示せない。
pub fn attach<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), AttachError> {
    let app = window.app_handle().clone();
    let hwnd = window
        .hwnd()
        .map_err(|error| AttachError::new("ウィンドウのhandleを取得できない", &error))?
        .0 as isize;
    let (sender, receiver) = mpsc::channel();
    window
        .with_webview(move |webview| {
            // SAFETY: WebView2のCOM呼び出しはWebViewを作ったUIスレッドで行う必要があり、
            // `with_webview` の閉包はそのスレッドで呼ばれる。
            let result = unsafe { configure(&webview.controller(), app, hwnd) };
            // 受け手が先に去っていても、設定は済んでいる。
            let _ = sender.send(result);
        })
        .map_err(|error| AttachError::new("WebView2の設定を始められない", &error))?;
    settled(receiver.try_recv())
}

/// WebView2のcontrollerへ、ブラウザーアクセラレータキーの無効化とキー入力の通知を組み込む。
///
/// # Safety
///
/// WebViewを作ったUIスレッドで呼ぶ。
unsafe fn configure<R: Runtime>(
    controller: &ICoreWebView2Controller,
    app: AppHandle<R>,
    hwnd: isize,
) -> Result<(), AttachError> {
    // SAFETY: 呼び出し側が、UIスレッドで呼ぶことを保証する。
    unsafe {
        controller
            .CoreWebView2()
            .and_then(|core| core.Settings())
            .and_then(|settings| settings.cast::<ICoreWebView2Settings3>())
            .and_then(|settings| settings.SetAreBrowserAcceleratorKeysEnabled(false))
            .map_err(|error| {
                AttachError::new(
                    "WebView2のブラウザーアクセラレータキーを無効にできない",
                    &error,
                )
            })?;

        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
            args.KeyEventKind(&mut kind)?;
            let system = kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN;
            if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && !system {
                return Ok(());
            }
            let mut virtual_key = 0u32;
            args.VirtualKey(&mut virtual_key)?;
            // イベントはキーのメッセージを処理しているUIスレッドで届くため、
            // `GetKeyState` はこの押下の時点の修飾キーを返す。
            let pressed = |key: u16| GetKeyState(i32::from(key)) < 0;
            let key = KeyPress {
                system,
                virtual_key: virtual_key as u16,
                ctrl: pressed(VK_CONTROL.0),
                shift: pressed(VK_SHIFT.0),
                alt: pressed(VK_MENU.0),
            };
            match route(key) {
                KeyRoute::Command(command) => {
                    args.SetHandled(true)?;
                    crate::menu_command::handle_command(&app, command);
                }
                KeyRoute::MenuAccessKey(character) => {
                    args.SetHandled(true)?;
                    // ホストのウィンドウが `Alt+文字` を受け取ったときと同じ経路で、
                    // 該当するメニューを開く（該当しなければOSが警告音を鳴らす）。
                    PostMessageW(
                        Some(HWND(hwnd as _)),
                        WM_SYSCOMMAND,
                        WPARAM(SC_KEYMENU as usize),
                        LPARAM(character as isize),
                    )?;
                }
                KeyRoute::Page => {}
            }
            Ok(())
        }));
        let mut token = 0i64;
        controller
            .add_AcceleratorKeyPressed(&handler, &mut token)
            .map_err(|error| AttachError::new("WebView2のキー入力の通知を登録できない", &error))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use muda::accelerator::{Accelerator, Modifiers};

    fn key(virtual_key: u16) -> KeyPress {
        KeyPress {
            system: false,
            virtual_key,
            ctrl: false,
            shift: false,
            alt: false,
        }
    }

    #[test]
    fn keys_are_routed() {
        let cases = [
            (
                "Ctrl+O",
                KeyPress {
                    ctrl: true,
                    ..key(0x4F)
                },
                KeyRoute::Command(MenuCommand::OpenFolder),
            ),
            // 修飾キーは厳密に一致させる（ネイティブのアクセラレータと同じ）。
            (
                "Ctrl+Shift+O",
                KeyPress {
                    ctrl: true,
                    shift: true,
                    ..key(0x4F)
                },
                KeyRoute::Page,
            ),
            ("O", key(0x4F), KeyRoute::Page),
            (
                "Ctrl+W",
                KeyPress {
                    ctrl: true,
                    ..key(0x57)
                },
                KeyRoute::Command(MenuCommand::CloseTab),
            ),
            (
                "F5",
                key(0x74),
                KeyRoute::Command(MenuCommand::ReloadDocument),
            ),
            // 割り当てのないキーはページへ渡す。
            ("F6", key(0x75), KeyRoute::Page),
            (
                "Alt+F",
                KeyPress {
                    system: true,
                    alt: true,
                    ..key(0x46)
                },
                KeyRoute::MenuAccessKey(u16::from(b'f')),
            ),
            (
                "Alt+1",
                KeyPress {
                    system: true,
                    alt: true,
                    ..key(0x31)
                },
                KeyRoute::MenuAccessKey(u16::from(b'1')),
            ),
            // 戻る／進む（9.3）はWebView内で処理する。
            (
                "Alt+Left",
                KeyPress {
                    system: true,
                    alt: true,
                    ..key(0x25)
                },
                KeyRoute::Page,
            ),
            (
                "Alt+Right",
                KeyPress {
                    system: true,
                    alt: true,
                    ..key(0x27)
                },
                KeyRoute::Page,
            ),
            (
                "Ctrl+Alt+F",
                KeyPress {
                    system: true,
                    ctrl: true,
                    alt: true,
                    ..key(0x46)
                },
                KeyRoute::Page,
            ),
            // 文書内検索（8.6）はWebView内で処理する。
            (
                "Ctrl+F",
                KeyPress {
                    ctrl: true,
                    ..key(0x46)
                },
                KeyRoute::Page,
            ),
        ];
        for (name, input, expected) in cases {
            assert_eq!(route(input), expected, "{name}");
        }
    }

    #[test]
    fn accelerator_notation_is_parsed() {
        let chord = |ctrl, shift, alt, virtual_key| {
            Some(Chord {
                ctrl,
                shift,
                alt,
                virtual_key,
            })
        };
        let cases = [
            ("Ctrl+O", chord(true, false, false, 0x4F)),
            ("Ctrl+0", chord(true, false, false, 0x30)),
            ("Ctrl+Shift+Alt+B", chord(true, true, true, 0x42)),
            ("F5", chord(false, false, false, 0x74)),
            ("F24", chord(false, false, false, 0x87)),
            ("Ctrl+Equal", chord(true, false, false, 0xBB)),
            ("Ctrl+Minus", chord(true, false, false, 0xBD)),
            ("F25", None),
            ("F0", None),
            ("Ctrl+Plus", None),
            ("Meta+O", None),
            ("Ctrl+o", None),
        ];
        for (notation, expected) in cases {
            assert_eq!(parse(notation), expected, "{notation}");
        }
    }

    /// すべての割り当てがキー入力の照合に載ることを固定する。
    ///
    /// 変換できない表記を足すと、メニューには表示されるのにWebViewにフォーカスがあると
    /// 効かないアクセラレータになる。実行するまで気づけないため、ここで止める。
    /// 修飾キーは実物のパーサー（`muda`）の解釈と一致することも確かめる。
    #[test]
    fn every_accelerator_is_routable() {
        for (command, notation) in ACCELERATORS {
            let chord = parse(notation)
                .unwrap_or_else(|| panic!("照合できない表記: {notation}（{command:?}）"));
            let parsed: Accelerator = notation.parse().expect("パースできない");
            let modifiers = parsed.modifiers();
            assert_eq!(
                chord.ctrl,
                modifiers.contains(Modifiers::CONTROL),
                "{notation}"
            );
            assert_eq!(
                chord.shift,
                modifiers.contains(Modifiers::SHIFT),
                "{notation}"
            );
            assert_eq!(chord.alt, modifiers.contains(Modifiers::ALT), "{notation}");
        }
    }

    #[test]
    fn a_configuration_that_ran_reports_its_result() {
        assert!(settled(Ok(Ok(()))).is_ok());
        let error = settled(Ok(Err(AttachError::new("設定", &"失敗")))).unwrap_err();
        assert_eq!(error.to_string(), "設定: 失敗");
    }

    #[test]
    fn a_configuration_that_did_not_run_is_a_failure() {
        for received in [Err(TryRecvError::Empty), Err(TryRecvError::Disconnected)] {
            assert!(settled(received).is_err());
        }
    }
}
