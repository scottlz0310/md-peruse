//! 画像のcustom protocolによる配信（design-decisions.md 5.4、7.3、7.4）。
//!
//! URLは `http://mdperuse-img.localhost/<resource-id>` である。IDを対応表で引き、ファイル全体を
//! 読み、発行時と同じ規則で形式と上限を検証してから返す。検証と配信の間に対象が置換されうる
//! ため、発行時に通っていても配信時にもう一度通す。
//!
//! 応答の本文を読み取れるのは `img` 要素だけにする。`Access-Control-Allow-Origin` を付けない
//! ため、Frontendのスクリプトは `fetch` で画像のバイト列を読めない（5.4）。

use std::fs::File;
use std::io::Read;
use std::sync::Arc;

use tauri::http::{Method, Request, Response, StatusCode, header};
use tauri::{Manager, Runtime};
use tokio::sync::Semaphore;

use super::error::ImageError;
use super::format::{self, ImageFormat, ImageRejection};
use crate::ipc::error::ErrorCode;
use crate::limits::{MAX_CONCURRENT_IMAGE_LOADS, MAX_IMAGE_BYTES};
use crate::path_guard::ResolveError;
use crate::state::{AppState, WorkspaceHandle};

/// custom protocolのスキーム名。WebView2では `http://mdperuse-img.localhost` として配信される
/// （5.4の実測）。CSPの `img-src` とsanitize schemaはこのオリジンを前提にする。
pub const SCHEME: &str = "mdperuse-img";

/// 画像の応答へ付けるCSP。
///
/// `img` 要素として読み込まれたSVGはスクリプトを実行しないが、URLへ直接遷移された場合の
/// 保険としてレスポンス側でも止める（7.4）。SVGの `style` 要素による見た目だけを許し、
/// スクリプト、外部取得、フォームを `sandbox` と `default-src 'none'` で断つ。
const IMAGE_CSP: &str = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

/// 成功した応答のキャッシュ指定。
///
/// IDは内容の変更を監視が検知するたびに変わるため、同じIDの内容は変わらないものとして
/// 長期にキャッシュさせてよい（5.4）。
const IMAGE_CACHE_CONTROL: &str = "private, max-age=31536000, immutable";

/// custom protocolを登録する。
///
/// 読込は同時に `MAX_CONCURRENT_IMAGE_LOADS` 件までとする（7.3）。上限はデコード後のメモリを
/// 抑えるためのものであり、待つ要求はブロッキングスレッドを占有せずに非同期で待つ。
pub fn register<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    let limiter = Arc::new(Semaphore::new(MAX_CONCURRENT_IMAGE_LOADS));
    builder.register_asynchronous_uri_scheme_protocol(SCHEME, move |context, request, responder| {
        let workspace = context.app_handle().state::<AppState>().workspace();
        let limiter = Arc::clone(&limiter);
        tauri::async_runtime::spawn(async move {
            responder.respond(respond(workspace, limiter, request).await);
        });
    })
}

/// 上限の枠を取ってから、ブロッキングスレッドで配信する。
async fn respond(
    workspace: WorkspaceHandle,
    limiter: Arc<Semaphore>,
    request: Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    // セマフォは閉じないため、枠の取得は失敗しない。
    let _permit = limiter
        .acquire_owned()
        .await
        .expect("読込の枠を取得できない");
    tauri::async_runtime::spawn_blocking(move || {
        serve(&workspace, request.method(), request.uri().path())
    })
    .await
    .expect("画像の配信タスクの実行に失敗")
}

/// 1件の要求に応答する。
///
/// ワークスペースのロックは、IDの照合とファイルのオープン（handleによる境界の確認を含む）の
/// 間だけ持ち、読込と検証はロックの外で行う（5.3の例外）。ロックを持ったまま最大32 MiBを
/// 読むと、他の画像も走査もワークスペースの切り替えも待たされ、同時読込の上限が実質1件に
/// なる。検証済みのhandleから読むため、ロックを離しても境界は崩れない。読込中に切り替えが
/// 起きた場合は旧ワークスペースの画像を1件配信し切るが、要求の時点では正当なIDであり、
/// Frontendは旧スコープの表示を捨てる。
pub fn serve(workspace: &WorkspaceHandle, method: &Method, path: &str) -> Response<Vec<u8>> {
    if method != Method::GET {
        let mut response = empty(StatusCode::METHOD_NOT_ALLOWED);
        response
            .headers_mut()
            .insert(header::ALLOW, header::HeaderValue::from_static("GET"));
        return response;
    }
    let resource_id = path.strip_prefix('/').unwrap_or(path);
    let opened = workspace
        .with_images(|root, images| {
            let relative = images.lookup(resource_id)?;
            Some(root.open_file(&relative))
        })
        .flatten();
    // 対応表に無いID（旧ワークスペースのID、世代の古いID、推測したID）と、ワークスペースを
    // 開いていない場合。どちらも「そのリソースは無い」ことと区別しない。
    let Some(opened) = opened else {
        return empty(StatusCode::NOT_FOUND);
    };
    match opened.map_err(ImageError::from).and_then(read_image) {
        Ok((format, bytes)) => image(format, bytes),
        Err(error) => empty(status_for(error.code())),
    }
}

/// 開いたファイルを読み、形式と上限を検証する。
fn read_image(file: File) -> Result<(ImageFormat, Vec<u8>), ImageError> {
    let declared = file.metadata().map_err(ResolveError::Io)?.len();
    if declared > u64::from(MAX_IMAGE_BYTES) {
        return Err(ImageRejection::TooLarge.into());
    }
    let mut bytes = Vec::with_capacity(usize::try_from(declared).unwrap_or_default());
    // オープンから読み取りまでの間に書き足された場合に備え、上限を1バイト超えるところまで
    // 読んで超過を検出する（`read.rs` と同じ）。
    file.take(u64::from(MAX_IMAGE_BYTES) + 1)
        .read_to_end(&mut bytes)
        .map_err(ResolveError::Io)?;
    let format = format::validate(&bytes)?;
    Ok((format, bytes))
}

/// `ErrorCode` をHTTPのステータスへ写す。
///
/// 区分は発行時と一致させる（5.4）。`img` 要素はステータスを読めないため、Frontendが画像の
/// 位置に示す理由は発行時の応答から取る。ここでの写像は診断のためのものである。
fn status_for(code: ErrorCode) -> StatusCode {
    match code {
        ErrorCode::PathRejected => StatusCode::BAD_REQUEST,
        ErrorCode::PathOutsideWorkspace => StatusCode::FORBIDDEN,
        ErrorCode::FileNotFound => StatusCode::NOT_FOUND,
        ErrorCode::ImageUnsupportedFormat => StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ErrorCode::ImageTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        ErrorCode::ImagePixelLimitExceeded => StatusCode::UNPROCESSABLE_ENTITY,
        // 読み込めない失敗（アクセス拒否、共有違反）も含むため、内容の誤りとは限らない。
        // `ImageError::code` が返すのは上の6つとこれに限られる。
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

fn image(format: ImageFormat, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, format.content_type())
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CONTENT_SECURITY_POLICY, IMAGE_CSP)
        .header(header::CACHE_CONTROL, IMAGE_CACHE_CONTROL)
        .body(bytes)
        .expect("固定のヘッダーで応答を組み立てられない")
}

/// 本文のない失敗の応答。キャッシュさせない。共有違反のような一時的な失敗が、同じIDで
/// 固定されないようにするためである。
fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::X_CONTENT_TYPE_OPTIONS, "nosniff")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("固定のヘッダーで応答を組み立てられない")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::i18n::LanguagePreference;
    use crate::image::issue::issue;
    use crate::ipc::types::FileChangeEvent;
    use crate::watch_runtime::ChangeSink;
    use std::path::{Path, PathBuf};
    use std::time::{Duration, Instant};

    const PNG: &[u8] = include_bytes!("fixtures/sample.png");
    const TIFF: &[u8] = include_bytes!("fixtures/sample.tiff");
    const WIDE: &[u8] = include_bytes!("fixtures/wide.png");

    /// 送出を捨てる `ChangeSink`。ここで見るのは配信の応答である。
    struct DiscardingSink;

    impl ChangeSink for DiscardingSink {
        fn file_change(&self, _event: FileChangeEvent) {}
        fn watcher_error(&self, _scope_id: &str, _code: ErrorCode) {}
    }

    /// テスト用の一時フォルダー。終了時に削除する。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path = std::env::temp_dir()
                .join(format!("md-peruse-protocol-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&path);
            std::fs::create_dir_all(&path).expect("一時フォルダーを作成できない");
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn open(temp: &TempDir) -> AppState {
        let state = AppState::new(LanguagePreference::System);
        state
            .open_workspace(temp.path(), Arc::new(DiscardingSink))
            .expect("ワークスペースを開けない");
        state
    }

    fn issued(state: &AppState, reference: &str) -> String {
        state
            .workspace()
            .with_images(|root, images| issue(root, images, "a.md", reference))
            .expect("ワークスペースが開いていない")
            .expect("発行できない")
    }

    fn get(state: &AppState, resource_id: &str) -> Response<Vec<u8>> {
        serve(&state.workspace(), &Method::GET, &format!("/{resource_id}"))
    }

    /// 発行したIDで、内容から判定した `Content-Type` とともに画像を返す（7.3）。
    #[test]
    fn an_issued_image_is_served_with_its_headers() {
        let temp = TempDir::new("served");
        // 拡張子と実体を食い違わせる。`Content-Type` は実体に従う。
        std::fs::write(temp.path().join("a.jpg"), PNG).unwrap();
        let state = open(&temp);
        let resource_id = issued(&state, "a.jpg");

        let response = get(&state, &resource_id);

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_slice(), PNG);
        let headers = response.headers();
        assert_eq!(headers[header::CONTENT_TYPE], "image/png");
        assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff");
        assert_eq!(headers[header::CONTENT_SECURITY_POLICY], IMAGE_CSP);
        assert_eq!(headers[header::CACHE_CONTROL], IMAGE_CACHE_CONTROL);
        // Frontendのスクリプトに画像のバイト列を読ませない（5.4）。
        assert!(!headers.contains_key(header::ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    /// 対応表に無いIDと、ワークスペースを開いていない場合は404とする（5.4）。
    #[test]
    fn unknown_ids_are_not_found() {
        let temp = TempDir::new("unknown");
        std::fs::write(temp.path().join("a.png"), PNG).unwrap();
        let state = open(&temp);
        let resource_id = issued(&state, "a.png");

        for path in [
            "/".to_owned(),
            format!("/{}", "0".repeat(64)),
            format!("/{resource_id}/extra"),
            "/../a.png".to_owned(),
        ] {
            let response = serve(&state.workspace(), &Method::GET, &path);
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
            assert!(response.body().is_empty());
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        }

        // 開き直すとソルトごと替わり、旧IDは404になる。
        state
            .open_workspace(temp.path(), Arc::new(DiscardingSink))
            .unwrap();
        assert_eq!(get(&state, &resource_id).status(), StatusCode::NOT_FOUND);

        state.close_workspace();
        assert_eq!(get(&state, &resource_id).status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn only_get_is_allowed() {
        let temp = TempDir::new("method");
        std::fs::write(temp.path().join("a.png"), PNG).unwrap();
        let state = open(&temp);
        let resource_id = issued(&state, "a.png");

        for method in [Method::POST, Method::PUT, Method::DELETE, Method::HEAD] {
            let response = serve(&state.workspace(), &method, &format!("/{resource_id}"));
            assert_eq!(
                response.status(),
                StatusCode::METHOD_NOT_ALLOWED,
                "{method}"
            );
            assert_eq!(response.headers()[header::ALLOW], "GET");
        }
    }

    /// 書き換えを監視が検知すると、旧IDでは配信しない（5.4）。
    ///
    /// 長期キャッシュを返す前提は「内容が変わればIDが変わる」ことであり、旧IDで新しい内容を
    /// 返すと、キャッシュ済みのWebViewと取得し直したWebViewで表示が食い違う。
    #[test]
    fn a_rewritten_image_is_not_served_under_the_old_id() {
        let temp = TempDir::new("rewritten");
        std::fs::write(temp.path().join("a.png"), PNG).unwrap();
        let state = open(&temp);
        let resource_id = issued(&state, "a.png");
        assert_eq!(get(&state, &resource_id).status(), StatusCode::OK);

        std::fs::write(temp.path().join("a.png"), WIDE).unwrap();

        let deadline = Instant::now() + Duration::from_secs(10);
        while get(&state, &resource_id).status() != StatusCode::NOT_FOUND {
            assert!(Instant::now() < deadline, "書き換え後も旧IDで配信している");
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// 配信時にも発行時と同じ規則で検証する。発行後に置き換えられた内容は配信しない（5.4）。
    ///
    /// `serve` を通すと、置き換えを検知した監視が先にIDを無効化して404になりうる。ここでは
    /// 置き換えた後の読込と検証だけを見る。
    #[test]
    fn replaced_contents_are_validated_again() {
        let temp = TempDir::new("replaced");
        let mut oversized = PNG.to_vec();
        oversized.resize(MAX_IMAGE_BYTES as usize + 1, 0);
        std::fs::write(temp.path().join("oversized.png"), &oversized).unwrap();
        std::fs::write(temp.path().join("a.tiff"), TIFF).unwrap();
        std::fs::write(temp.path().join("wide.png"), WIDE).unwrap();
        std::fs::write(temp.path().join("a.png"), PNG).unwrap();

        let cases = [
            ("a.png", Ok(ImageFormat::Png)),
            ("a.tiff", Err(ErrorCode::ImageUnsupportedFormat)),
            ("wide.png", Err(ErrorCode::ImagePixelLimitExceeded)),
            ("oversized.png", Err(ErrorCode::ImageTooLarge)),
        ];
        for (name, expected) in cases {
            let file = File::open(temp.path().join(name)).unwrap();
            let result = read_image(file)
                .map(|(format, _)| format)
                .map_err(|error| error.code());
            assert_eq!(result, expected, "{name}");
        }
    }

    /// 発行時と同じ区分をHTTPのステータスへ写す。
    #[test]
    fn error_codes_map_to_statuses() {
        let cases = [
            (ErrorCode::PathRejected, StatusCode::BAD_REQUEST),
            (ErrorCode::PathOutsideWorkspace, StatusCode::FORBIDDEN),
            (ErrorCode::FileNotFound, StatusCode::NOT_FOUND),
            (
                ErrorCode::ImageUnsupportedFormat,
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
            ),
            (ErrorCode::ImageTooLarge, StatusCode::PAYLOAD_TOO_LARGE),
            (
                ErrorCode::ImagePixelLimitExceeded,
                StatusCode::UNPROCESSABLE_ENTITY,
            ),
            (
                ErrorCode::ImageDecodeFailed,
                StatusCode::INTERNAL_SERVER_ERROR,
            ),
        ];
        for (code, expected) in cases {
            assert_eq!(status_for(code), expected, "{code:?}");
        }
    }

    /// 枠が埋まっている間は読込を始めず、枠が空けば応答する（7.3）。
    #[test]
    fn loads_wait_for_a_free_slot() {
        let temp = TempDir::new("limit");
        std::fs::write(temp.path().join("a.png"), PNG).unwrap();
        let state = open(&temp);
        let resource_id = issued(&state, "a.png");
        let limiter = Arc::new(Semaphore::new(MAX_CONCURRENT_IMAGE_LOADS));
        let held: Vec<_> = (0..MAX_CONCURRENT_IMAGE_LOADS)
            .map(|_| Arc::clone(&limiter).try_acquire_owned().unwrap())
            .collect();

        let (done, finished) = std::sync::mpsc::channel();
        let request = Request::get(format!("http://mdperuse-img.localhost/{resource_id}"))
            .body(Vec::new())
            .unwrap();
        let workspace = state.workspace();
        let task_limiter = Arc::clone(&limiter);
        tauri::async_runtime::spawn(async move {
            let response = respond(workspace, task_limiter, request).await;
            let _ = done.send(response.status());
        });

        assert!(
            finished.recv_timeout(Duration::from_millis(300)).is_err(),
            "枠が埋まっているのに応答した"
        );
        drop(held);
        assert_eq!(
            finished.recv_timeout(Duration::from_secs(10)),
            Ok(StatusCode::OK)
        );
        // 応答を返した後は枠を返している。
        assert_eq!(limiter.available_permits(), MAX_CONCURRENT_IMAGE_LOADS);
    }
}
