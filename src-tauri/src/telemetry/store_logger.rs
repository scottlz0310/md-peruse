//! `StoreServicesCustomEventLogger` での実送信（design-decisions.md 11.4、13.5）。
//!
//! winmd も、そこから生成したバインディングも持ち込まない。呼ぶのは `GetDefault()` と
//! `Log()` の2つだけで、必要なのは活性化するクラス名、statics インターフェースのIID、
//! 2つのvtableの並びに限られる。値は SDK の `Microsoft.Services.Store.Engagement.winmd` の
//! メタデータから読み取ったもので、13.5に記録している。インターフェースはIIDで固定される
//! ため、SDKの更新でメソッドの並びが変わることはない。
//!
//! `Log()` は常駐の専用スレッドで呼ぶ。起動時の記録はメインスレッドで行われ、DLLの
//! ロードと `Log()` の待ちで呼び出し元を止めないためと、MTAと送信の口のオブジェクトを
//! セッションの間ずっと生かすためである。イベントの記録は最初の1件で初めてスレッドを立てる。
//! Storeから配布されていない実行は `Telemetry::record` が送信の手前で止めるため、
//! スレッドも活性化も生じない。

use super::{EventLogger, LogFailed};
use std::ffi::c_void;
use std::mem;
use std::ptr;
use std::sync::OnceLock;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use windows::Win32::Foundation::E_POINTER;
use windows::Win32::System::WinRT::{RO_INIT_MULTITHREADED, RoGetActivationFactory, RoInitialize};
use windows::core::{
    Error, GUID, HRESULT, HSTRING, IInspectable, IInspectable_Vtbl, IUnknown_Vtbl, Interface,
    Result as WinResult,
};

const CLASS_NAME: &str = "Microsoft.Services.Store.Engagement.StoreServicesCustomEventLogger";

/// `IStoreServicesCustomEventLoggerStatics`。
///
/// `IStoreServicesCustomEventLogger`（`6D544721-C351-3A70-95B6-161F52FBC13D`）のIIDは、
/// `GetDefault()` が既定のインターフェースを直接返すため、実行時には使わない。
const STATICS_IID: GUID = GUID::from_u128(0x5e9c9d4b_a892_32f3_87ac_410b81f89cd6);

/// `IStoreServicesCustomEventLoggerStatics`。`IInspectable` のあとに `GetDefault` が続く。
#[repr(C)]
struct StaticsVtbl {
    base: IInspectable_Vtbl,
    get_default: unsafe extern "system" fn(this: *mut c_void, result: *mut *mut c_void) -> HRESULT,
}

/// `IStoreServicesCustomEventLogger`。`IInspectable` のあとに `Log` が続く。
///
/// 続く `LogForVariation` は呼ばないため定義しない。
#[repr(C)]
struct LoggerVtbl {
    base: IInspectable_Vtbl,
    log: unsafe extern "system" fn(this: *mut c_void, event_name: *mut c_void) -> HRESULT,
}

/// COMインターフェースポインタの先頭にあるvtableを返す。
///
/// # Safety
///
/// `interface` が指すオブジェクトのvtableが、`V` の並びであること。
unsafe fn vtable<V>(interface: &IInspectable) -> &V {
    unsafe { &**interface.as_raw().cast::<*const V>() }
}

/// 成功して返ったインターフェースポインタの所有権を受け取る。
///
/// 成功しても空のポインタが返ったときは失敗として扱う。
fn owned(raw: *mut c_void) -> WinResult<IInspectable> {
    if raw.is_null() {
        return Err(Error::from(E_POINTER));
    }
    Ok(unsafe { IInspectable::from_raw(raw) })
}

/// `IStoreServicesCustomEventLogger`。Dropで解放する。
struct CustomEventLogger(IInspectable);

impl CustomEventLogger {
    fn get_default() -> WinResult<Self> {
        let class_name = HSTRING::from(CLASS_NAME);
        let factory: IInspectable = unsafe { RoGetActivationFactory(&class_name)? };
        Self::from_factory(&factory)
    }

    /// 活性化ファクトリから statics を得て、`GetDefault()` でロガーを得る。
    fn from_factory(factory: &IInspectable) -> WinResult<Self> {
        let mut statics = ptr::null_mut();
        unsafe {
            (vtable::<IUnknown_Vtbl>(factory).QueryInterface)(
                factory.as_raw(),
                &STATICS_IID,
                &mut statics,
            )
        }
        .ok()?;
        let statics = owned(statics)?;

        let mut logger = ptr::null_mut();
        unsafe { (vtable::<StaticsVtbl>(&statics).get_default)(statics.as_raw(), &mut logger) }
            .ok()?;
        Ok(Self(owned(logger)?))
    }

    fn log(&self, event_name: &str) -> WinResult<()> {
        let event_name = HSTRING::from(event_name);
        // `HSTRING` はハンドルを1つ持つだけの型で、`Log` は借りるだけである。解放は
        // `event_name` のDropが行う。
        let handle = unsafe { mem::transmute_copy::<HSTRING, *mut c_void>(&event_name) };
        unsafe { (vtable::<LoggerVtbl>(&self.0).log)(self.0.as_raw(), handle) }.ok()
    }
}

/// イベント名を1つ送る関数。送信スレッドの中で作って使うため、`Send` は要らない。
type Sink = Box<dyn FnMut(&str) -> WinResult<()>>;

/// MTAを保ってロガーを得る。ロガーは返した関数が持つ。
fn open_default() -> WinResult<Sink> {
    unsafe { RoInitialize(RO_INIT_MULTITHREADED)? };
    let logger = CustomEventLogger::get_default()?;
    Ok(Box::new(move |name| logger.log(name)))
}

/// 名前を受け取って送るスレッドの本体。
///
/// 送信の口を得られなければ何もせず終わる。受け手が捨てられ、以後の記録は失敗として
/// 返り、`Telemetry::record` が無視する（11.4）。1件の失敗で後続を止めない。
fn run(names: Receiver<String>, open: fn() -> WinResult<Sink>) {
    let Ok(mut sink) = open() else { return };
    for name in names {
        let _ = sink(&name);
    }
}

fn start(open: fn() -> WinResult<Sink>) -> Sender<String> {
    let (sender, names) = mpsc::channel();
    // スレッドを立てられなければ、closureと一緒に受け手が捨てられ、以後の送信が失敗する。
    let _ = thread::Builder::new()
        .name("store-telemetry".to_owned())
        .spawn(move || run(names, open));
    sender
}

/// Store向けカスタムイベントの送信の口。
pub struct StoreEventLogger {
    sender: OnceLock<Sender<String>>,
    open: fn() -> WinResult<Sink>,
}

impl StoreEventLogger {
    pub fn for_store() -> Self {
        Self::with_opener(open_default)
    }

    fn with_opener(open: fn() -> WinResult<Sink>) -> Self {
        Self {
            sender: OnceLock::new(),
            open,
        }
    }
}

impl EventLogger for StoreEventLogger {
    fn log(&self, name: &str) -> Result<(), LogFailed> {
        let open = self.open;
        self.sender
            .get_or_init(|| start(open))
            .send(name.to_owned())
            .map_err(|_| LogFailed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::ManuallyDrop;
    use std::sync::Mutex;
    use std::sync::atomic::{AtomicI32, AtomicU32, Ordering::SeqCst};
    use std::thread::ThreadId;
    use std::time::{Duration, Instant};
    use windows::Win32::Foundation::{E_FAIL, E_NOINTERFACE, E_NOTIMPL, S_OK};

    // ---- 偽のCOMオブジェクト ----
    //
    // 本物のDLLを使わずに、vtableの並び、引数の渡し方、所有権の受け渡しを確かめる。
    // 本物との突き合わせは、パッケージ化した実行での実測（13.5）が担う。

    /// 偽のオブジェクトが共有する、テストごとの設定と記録。
    #[derive(Default)]
    struct World {
        query_interface: Option<HRESULT>,
        get_default: Option<HRESULT>,
        null_logger: bool,
        log: Option<HRESULT>,
        asked_for: Mutex<Vec<GUID>>,
        logged: Mutex<Vec<String>>,
        /// 生きているオブジェクトの数。
        live: AtomicI32,
    }

    /// 偽のオブジェクト。先頭がvtableへのポインタで、COMの規約どおりである。
    #[repr(C)]
    struct Object {
        vtable: *const c_void,
        refs: AtomicU32,
        world: *const World,
    }

    fn new_object(world: &World, vtable: *const c_void) -> *mut c_void {
        world.live.fetch_add(1, SeqCst);
        let object = Object {
            vtable,
            refs: AtomicU32::new(1),
            world,
        };
        Box::into_raw(Box::new(object)).cast()
    }

    fn world_of<'a>(this: *mut c_void) -> &'a World {
        unsafe { &*(*this.cast::<Object>()).world }
    }

    unsafe extern "system" fn add_ref(this: *mut c_void) -> u32 {
        unsafe { (*this.cast::<Object>()).refs.fetch_add(1, SeqCst) + 1 }
    }

    unsafe extern "system" fn release(this: *mut c_void) -> u32 {
        let left = unsafe { (*this.cast::<Object>()).refs.fetch_sub(1, SeqCst) } - 1;
        if left == 0 {
            world_of(this).live.fetch_sub(1, SeqCst);
            drop(unsafe { Box::from_raw(this.cast::<Object>()) });
        }
        left
    }

    unsafe extern "system" fn factory_query_interface(
        this: *mut c_void,
        iid: *const GUID,
        interface: *mut *mut c_void,
    ) -> HRESULT {
        let world = world_of(this);
        let iid = unsafe { *iid };
        world.asked_for.lock().unwrap().push(iid);
        if let Some(failure) = world.query_interface {
            return failure;
        }
        if iid != STATICS_IID {
            return E_NOINTERFACE;
        }
        unsafe { *interface = new_object(world, ptr::from_ref(&STATICS).cast()) };
        S_OK
    }

    unsafe extern "system" fn no_interface(
        _: *mut c_void,
        _: *const GUID,
        _: *mut *mut c_void,
    ) -> HRESULT {
        E_NOINTERFACE
    }

    unsafe extern "system" fn get_iids(_: *mut c_void, _: *mut u32, _: *mut *mut GUID) -> HRESULT {
        E_NOTIMPL
    }

    unsafe extern "system" fn get_runtime_class_name(
        _: *mut c_void,
        _: *mut *mut c_void,
    ) -> HRESULT {
        E_NOTIMPL
    }

    unsafe extern "system" fn get_trust_level(_: *mut c_void, _: *mut i32) -> HRESULT {
        E_NOTIMPL
    }

    unsafe extern "system" fn get_default(this: *mut c_void, result: *mut *mut c_void) -> HRESULT {
        let world = world_of(this);
        if let Some(failure) = world.get_default {
            return failure;
        }
        let logger = if world.null_logger {
            ptr::null_mut()
        } else {
            new_object(world, ptr::from_ref(&LOGGER).cast())
        };
        unsafe { *result = logger };
        S_OK
    }

    unsafe extern "system" fn log(this: *mut c_void, event_name: *mut c_void) -> HRESULT {
        let world = world_of(this);
        // 受け取ったHSTRINGは借り物で、解放は呼び出し側が持つ。
        let event_name =
            ManuallyDrop::new(unsafe { mem::transmute_copy::<*mut c_void, HSTRING>(&event_name) });
        world
            .logged
            .lock()
            .unwrap()
            .push(event_name.to_string_lossy());
        world.log.unwrap_or(S_OK)
    }

    const fn inspectable(
        query_interface: unsafe extern "system" fn(
            *mut c_void,
            *const GUID,
            *mut *mut c_void,
        ) -> HRESULT,
    ) -> IInspectable_Vtbl {
        IInspectable_Vtbl {
            base: IUnknown_Vtbl {
                QueryInterface: query_interface,
                AddRef: add_ref,
                Release: release,
            },
            GetIids: get_iids,
            GetRuntimeClassName: get_runtime_class_name,
            GetTrustLevel: get_trust_level,
        }
    }

    static FACTORY: IInspectable_Vtbl = inspectable(factory_query_interface);
    static STATICS: StaticsVtbl = StaticsVtbl {
        base: inspectable(no_interface),
        get_default,
    };
    static LOGGER: LoggerVtbl = LoggerVtbl {
        base: inspectable(no_interface),
        log,
    };

    fn factory(world: &World) -> IInspectable {
        let raw = new_object(world, ptr::from_ref(&FACTORY).cast());
        unsafe { IInspectable::from_raw(raw) }
    }

    #[test]
    fn events_reach_the_logger_through_the_vtables() {
        let world = World::default();
        let factory = factory(&world);
        let logger = CustomEventLogger::from_factory(&factory).unwrap();

        logger.log("session_start").unwrap();
        logger.log("open_md_ok").unwrap();

        assert_eq!(
            *world.logged.lock().unwrap(),
            ["session_start", "open_md_ok"]
        );
        // statics は、そのIIDで要求する。
        assert_eq!(*world.asked_for.lock().unwrap(), [STATICS_IID]);
    }

    #[test]
    fn the_class_name_and_statics_iid_are_the_ones_in_the_sdk_metadata() {
        // 偽のオブジェクトは同じ定数を使うため、値そのものはここで固定する。
        // 値の出どころは13.5（winmdのメタデータ）。
        assert_eq!(
            CLASS_NAME,
            "Microsoft.Services.Store.Engagement.StoreServicesCustomEventLogger"
        );
        assert_eq!(
            STATICS_IID,
            GUID {
                data1: 0x5E9C9D4B,
                data2: 0xA892,
                data3: 0x32F3,
                data4: [0x87, 0xAC, 0x41, 0x0B, 0x81, 0xF8, 0x9C, 0xD6],
            }
        );
    }

    #[test]
    fn each_failing_step_is_returned_as_its_error() {
        let cases: [(&str, World, HRESULT); 3] = [
            (
                "staticsを得られない",
                World {
                    query_interface: Some(E_NOINTERFACE),
                    ..World::default()
                },
                E_NOINTERFACE,
            ),
            (
                "GetDefaultが失敗する",
                World {
                    get_default: Some(E_FAIL),
                    ..World::default()
                },
                E_FAIL,
            ),
            (
                "GetDefaultが成功しても空のポインタを返す",
                World {
                    null_logger: true,
                    ..World::default()
                },
                E_POINTER,
            ),
        ];
        for (case, world, expected) in cases {
            let factory = factory(&world);
            let error = CustomEventLogger::from_factory(&factory)
                .err()
                .unwrap_or_else(|| panic!("{case}: 失敗するはず"));
            assert_eq!(error.code(), expected, "{case}");
            // 失敗しても、途中で得たものを解放している（残るのはファクトリだけ）。
            assert_eq!(world.live.load(SeqCst), 1, "{case}");
        }
    }

    #[test]
    fn a_failing_log_is_returned_as_its_error() {
        let world = World {
            log: Some(E_FAIL),
            ..World::default()
        };
        let factory = factory(&world);
        let logger = CustomEventLogger::from_factory(&factory).unwrap();

        let error = logger.log("session_start").unwrap_err();

        assert_eq!(error.code(), E_FAIL);
        // 失敗した呼び出しも、名前は渡っている。
        assert_eq!(*world.logged.lock().unwrap(), ["session_start"]);
    }

    #[test]
    fn every_object_is_released_exactly_once() {
        let world = World::default();
        let factory = factory(&world);
        let logger = CustomEventLogger::from_factory(&factory).unwrap();

        // statics は得たあとで手放し、ファクトリとロガーが残る。
        assert_eq!(world.live.load(SeqCst), 2);
        drop(logger);
        assert_eq!(world.live.load(SeqCst), 1);
        drop(factory);
        assert_eq!(world.live.load(SeqCst), 0);
    }

    // ---- 送信スレッド ----

    /// 条件が成り立つまで待つ。成り立たなければ、その場で失敗させる。
    fn wait_until(what: &str, condition: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(Instant::now() < deadline, "待ち切れなかった: {what}");
            thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn the_sender_thread_starts_with_the_first_event_and_delivers_in_order() {
        static OPENED: AtomicU32 = AtomicU32::new(0);
        static SEEN: Mutex<Vec<(ThreadId, String)>> = Mutex::new(Vec::new());
        fn open() -> WinResult<Sink> {
            OPENED.fetch_add(1, SeqCst);
            Ok(Box::new(|name| {
                SEEN.lock()
                    .unwrap()
                    .push((thread::current().id(), name.to_owned()));
                Ok(())
            }))
        }

        let logger = StoreEventLogger::with_opener(open);
        // 記録がなければ、スレッドも送信の口も作らない。
        assert_eq!(OPENED.load(SeqCst), 0);

        logger.log("session_start").unwrap();
        logger.log("open_md_ok").unwrap();
        logger.log("open_folder").unwrap();
        wait_until("3件の配送", || SEEN.lock().unwrap().len() == 3);

        let seen = SEEN.lock().unwrap();
        let names: Vec<&str> = seen.iter().map(|(_, name)| name.as_str()).collect();
        assert_eq!(names, ["session_start", "open_md_ok", "open_folder"]);
        // 1本のスレッドで、呼び出し元とは別のスレッドで送る。
        assert!(seen.iter().all(|(id, _)| *id == seen[0].0));
        assert_ne!(seen[0].0, thread::current().id());
        assert_eq!(OPENED.load(SeqCst), 1);
    }

    #[test]
    fn a_failed_send_does_not_stop_later_events() {
        static SEEN: Mutex<Vec<String>> = Mutex::new(Vec::new());
        fn open() -> WinResult<Sink> {
            Ok(Box::new(|name| {
                SEEN.lock().unwrap().push(name.to_owned());
                if name == "session_start" {
                    Err(Error::from(E_FAIL))
                } else {
                    Ok(())
                }
            }))
        }

        let logger = StoreEventLogger::with_opener(open);
        logger.log("session_start").unwrap();
        logger.log("open_md_ok").unwrap();

        wait_until("2件の配送", || SEEN.lock().unwrap().len() == 2);
        assert_eq!(*SEEN.lock().unwrap(), ["session_start", "open_md_ok"]);
    }

    #[test]
    fn events_fail_quietly_when_the_sender_cannot_be_opened() {
        fn open() -> WinResult<Sink> {
            Err(Error::from(E_FAIL))
        }

        let logger = StoreEventLogger::with_opener(open);

        // スレッドが終わって受け手が捨てられると、以後の記録は失敗として返る。
        // 呼び出し元は`Telemetry::record`で、その失敗を無視する（11.4）。
        wait_until("受け手の破棄", || {
            logger.log("session_start").is_err()
        });
        assert_eq!(logger.log("open_md_ok"), Err(LogFailed));
    }
}
