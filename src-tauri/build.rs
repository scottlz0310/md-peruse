fn main() {
    declare_common_controls();
    tauri_build::build()
}

/// リンクするバイナリへ、comctl32 v6 への依存をマニフェストとして宣言する。
///
/// `tauri` の `test` feature をdev-dependencyで有効にすると、libが comctl32 v6 の関数
/// （`TaskDialogIndirect`、`SetWindowSubclass` など）を参照する。v6 を読み込むには
/// アプリケーションマニフェストの依存宣言が要るが、cargoが作るテストバイナリはマニフェストを
/// 持たない。宣言がないと既定の v5 が読まれ、テストは1件も走らないまま起動時に
/// `STATUS_ENTRYPOINT_NOT_FOUND` で落ちる（design-decisions.md 14.2）。
///
/// テストターゲットだけを対象にする `rustc-link-arg-tests` はこのcargo（1.98.1）が受け付け
/// ないため、全ターゲットへ効く `rustc-link-arg` を使う。製品バイナリのマニフェストは
/// `tauri_build` が用意しており、既に同じ依存を宣言している。この宣言を足しても内容は
/// 変わらないことを実測で確認した。
///
/// `RUSTFLAGS` や `.cargo/config.toml` ではなくbuild scriptから渡す。CIのカバレッジ計測は
/// `cargo llvm-cov` で行い、これが `RUSTFLAGS` を設定する。`RUSTFLAGS` が設定されると
/// cargoは `.cargo/config.toml` の `rustflags` を無視するため、そちらへ置くとカバレッジ計測の
/// ときだけ宣言が消え、テストが起動しなくなる。
fn declare_common_controls() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    println!(
        "cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' \
         name='Microsoft.Windows.Common-Controls' version='6.0.0.0' \
         processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
    );
}
