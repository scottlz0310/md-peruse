# Changelog

`md-peruse` の変更履歴を記録する。

書式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/) に従い、バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従う。製品バージョンの正本はGitタグ `vMAJOR.MINOR.PATCH` とする。

## 記載方針

- 変更は `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security` へ分類する。
- 初回リリース（`0.1.0`）までは、開発基盤とリポジトリ構成の変更も記録する。
- 初回リリース以降は、利用者から見て観測できる変更を記録する。依存関係の定型更新やCIの内部調整は記載しない。
- 記録はPull Requestごとに行い、リリース時に `Unreleased` からバージョン見出しへ移す。

## [Unreleased]

### Added
- Store向けカスタムイベント（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）の実施計画を `tasks.md` と [dev-flow.md](./docs/dev-flow.md) へ追加。Phase 3-5（送信経路の実測と要件確定）、Phase 4（発火点の実装と「起動中に2つ目の `.md` を関連付けから開く」経路のE2E回帰）、Phase 5（データ収集申告、Partner Centerでの確認、計測母集団の制約の明記）の4段階に分ける。送信単位はシングルインスタンス＋タブ起動を前提としてセッション単位へ統一する
- Store向けカスタムイベント（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）の実施計画を `tasks.md` と [dev-flow.md](./docs/dev-flow.md) へ追加。Phase 3-5（送信経路の実測と要件確定）、Phase 4（発火点の実装）、Phase 5（データ収集申告とPartner Centerでの確認）の4段階に分ける
- Store向けカスタムイベントの送信経路の実測結果を [design-decisions.md](./docs/design-decisions.md) 13.5 へ追加。packaged classic appから `StoreServicesCustomEventLogger` を呼び出せること、`Microsoft.Services.Store.Engagement` と `Microsoft.VCLibs.140.00` の `PackageDependency` が必要であること、CSPとTauri capabilityの最終値には影響しないことを確認した
- Raw HTMLをソース文字列として出力する `remark-rehype` のhandlerを `src/markdown/raw-html.ts` へ追加。block（`root`・`blockquote`・`listItem`・`footnoteDefinition` 直下）は `pre/code` で包んで改行とインデントを保持し、それ以外（`paragraph`・`heading`・`strong`・`link`・表セルなど）は素のテキストとしてタグと本文の分断を避ける。HTMLコメントも同じ扱いとし、`allowDangerousHtml` と `rehype-raw` は使わない（[design-decisions.md](./docs/design-decisions.md) 8.1）
- unifiedパイプラインの依存（unified、remark-parse、remark-gfm、remark-math、remark-rehype、rehype-katex）を追加。schemaを実パイプラインの出力に対して検証する統合テストで使う
- `rehype-sanitize` のschemaを `src/markdown/sanitize-schema.ts` へ追加。既定schemaを継承せず、パイプラインが生成する要素だけを全列挙する。KaTeXは `output: "mathml"` としてstyleとsvgを生成させない（[design-decisions.md](./docs/design-decisions.md) 8.2、8.5）
- custom image protocolのresource ID契約を追加。ワークスペース単位のソルトと、相対パス・変更世代のHMACをIDとし、文書単位で一括発行する。監視が変更を検知すればIDが変わるため長期キャッシュを返せる。画像固有のエラーcodeも追加（[design-decisions.md](./docs/design-decisions.md) 5.4）
- IPCのエラー契約を追加。原因ごとに列挙した `ErrorCode`（14種）と `IpcError` をRust側で定義し、再試行可否は `src/types/error.ts` の `RETRYABLE` からcodeで導出する。表示場所はFrontendが呼び出しの文脈から決める
- IPCの契約としてプロトコルバージョン・request ID・キャンセルを導入しないことを確定し、根拠を [design-decisions.md](./docs/design-decisions.md) 5.3 へ記録。陳腐化した走査応答の破棄はFrontendが持つワークスペース世代とパス世代で行い、走査の応答は対象ディレクトリを示す `ScanResult` として返す
- IPCの型定義を追加。Rust側を正本とし、`ts-rs` で `src/types/generated/` へTypeScriptの定義を生成する。生成物はコミットし、CIの `Rust` ジョブが乖離を検出する
- 概略要件定義書、設計判断、開発フローの設計文書を追加
- `README.md`、`CHANGELOG.md`、`tasks.md` を追加
- `.gitattributes` と `.editorconfig` を追加し、改行コードとインデント規則を統一
- Pull RequestテンプレートとIssueテンプレート（バグ報告・機能要望）を追加
- Renovate共有プリセットを参照する `renovate.json` を追加。required status checkが整うまで、脆弱性更新を含むすべての自動マージを停止する
- `SECURITY.md` を追加し、脆弱性の非公開報告経路（GitHub Security Advisories）と想定する脅威を定義
- Bun + Vite + React + TypeScript + Tauri v2 のアプリケーションスケルトンを追加。BiomeとTypeScriptの型検査を導入し、CSPとcapabilityの初期値を設定
- LefthookでFrontendとRustの品質チェックをpre-commitへ組み込み
- GitHub ActionsのCIワークフローを追加。Pull Requestと `main` へのpushで、Frontend（Biome・型検査・ビルド）とRust（`cargo fmt`・`clippy`・`cargo test`）を検査する
- `codecov.yml` を追加し、RustとFrontendをflagsで分けて集計する方針を定義。テスト構成の確立までアップロードは行わない
- `main` ブランチの保護を設定し、CIの `Frontend` / `Rust` を required status check とした
- MSIXパッケージングを追加。`packaging/Package.appxmanifest.template` と `scripts/build-msix.ps1` により、x64とARM64のMSIXを生成・署名できる
- アイコンの原本と生成物の一致検査を追加。`scripts/check-icons.ts` が `assets/app-icon.png` から再生成して `src-tauri/icons` とバイト比較し、CIの `Frontend` ジョブとpre-commitで実行する
- サードパーティライセンス一覧の生成を追加。JavaScript側は `scripts/generate-licenses.ts` が `dependencies` の推移閉包を辿り、Rust側は `cargo-about` が収集する。SPDXメタデータは条文として扱わず、上流が条文を同梱しない場合は `licenses/overrides/` の本文を使う。生成物 `src/generated/third-party-licenses.json` はコミットし、CIの `Licenses` ジョブが未更新を検出する
- FrontendのDOMテスト構成を追加。`bun:test` に happy-dom と Testing Library を組み合わせ、`bunfig.toml` のpreloadで初期化する。CIとpre-commitで `bun test` を実行する
- CIからCodecovへカバレッジをアップロード。Frontendは `bun test --coverage`、Rustは `cargo llvm-cov` でlcovを生成し、OIDCで認証してflagsを `frontend` と `rust` に分けて集計する。RustのlcovはWindowsのジョブがartifactへ保存し、`Coverage` ジョブ（ubuntu）がアップロードする

### Changed

- 非Markdownファイルをツリーへ表示しないことを確定（[design-decisions.md](./docs/design-decisions.md) 6.3）。あわせて `tasks.md` の運用ルールへ、フェーズ最後のPull Requestで進捗サマリと完了条件も更新する旨を追加した
- Phase 3を4単位（IPC、描画とナビゲーション、状態管理、UIとUX）へ詳細化し、着手順と成果物の形式を [dev-flow.md](./docs/dev-flow.md) 第5章に定義。P1未決事項の解決先を単位まで細分した
- Bunのバージョン固定を `package.json` の `packageManager` から `.bun-version` へ移行。Renovateの `bun-version` マネージャは `.bun-version` を対象とし、`packageManager` からはBun本体を更新できないため（[design-decisions.md](./docs/design-decisions.md) 4.4）
- Bun本体（`bun-version`）を `Bun runtime` グループへ切り出し、自動マージを無効化。MSIX生成とWACKがrequired status checkに含まれず、自動マージのゲートで破壊を検出できないため手動でマージする
- Renovateの自動マージを再開。required status checkが揃ったため、`presets/options/automerge` を `extends` へ戻し、`renovate.json` のautomerge打ち消しを削除した。レビューの必須範囲（人が作成する変更とRenovateの定型更新の区別）を [design-decisions.md](./docs/design-decisions.md) 4.12 に定義した
- アプリアイコンをTauriテンプレートの既定からmd-peruse独自のデザインへ差し替え。正方形アイコンの原本は `assets/app-icon.png`（1024x1024）、横長タイルの原本は `assets/wide-logo.png`（3100x1500）とし、各サイズは生成する
- MSIXのタイルへ `Wide310x150Logo` と `Square310x310Logo` を追加し、`BackgroundColor` をアイコンの実測色へ変更。横長タイルはパッケージ工程で原本から直接生成する
- MSIX環境での動作をスパイクで実測し、設計判断を確定（[design-decisions.md](./docs/design-decisions.md) 5.4、5.5、6.4、11.1、13.4）

[Unreleased]: https://github.com/scottlz0310/md-peruse/commits/main
