# md-peruse タスク管理

実装タスクと未決事項の解決状況を追跡する。作業手順とフェーズの定義は [docs/dev-flow.md](./docs/dev-flow.md)、設計判断は [docs/design-decisions.md](./docs/design-decisions.md) を正本とし、本書は進捗の正本とする。

## 運用ルール

- チェックボックスは未完了 `[ ]` と完了 `[x]` の2状態で運用する。GFMのタスクリストが解釈できない独自記法は使わない。
- 着手中のフェーズは「進捗サマリ」の状態列で示す。
- Pull Requestを作成するときに、対象タスクの状態と `CHANGELOG.md` を併せて更新する。
- フェーズ最後のタスクを閉じるPull Requestでは、「進捗サマリ」の状態と [dev-flow.md](./docs/dev-flow.md) のフェーズ完了条件も併せて更新する。
- 未決事項を解決したら、結論を `docs/design-decisions.md` へ記載し、本書のチェックを閉じる。
- Phase 4以降のタスクは、着手時にフェーズ内で詳細化する。現時点では完了条件の粒度で保持する。
- 作業中に見つかった、そのPull Requestのスコープ外の事項は「検討待ち」へ積む。その場で直さず、フェーズを割り当てられる状態になってから該当フェーズのタスクへ移す。

## 進捗サマリ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| Phase 0 | リポジトリ整備 | 完了 |
| Phase 1 | MSIX技術スパイク | 完了 |
| Phase 2 | 開発基盤と品質ガードレール | 完了 |
| Phase 3 | 詳細設計 | 完了 |
| Phase 4 | 機能実装 | 着手中（4-1 Rust Core完了、4-2 Frontend着手） |
| Phase 5 | 配布パイプラインとStore公開 | 未着手 |

着手順は [dev-flow.md](./docs/dev-flow.md) 「1.1 フェーズの着手順」、第5章「着手順」、第6章「着手順」を正本とし、本書では重複して定義しない。本書は各タスクの状態のみを追跡する。

## Phase 0: リポジトリ整備

- [x] リポジトリを初期化する
- [x] 既定ブランチの保護設定を決める（required status check は `Frontend` / `Rust` / `Coverage` / `Licenses`。[design-decisions.md](./docs/design-decisions.md) 4.12）
- [x] `LICENSE` を配置する（MIT）
- [x] `.gitignore` を配置する
- [x] `README.md` を作成し、ドキュメントの入口と更新責務を示す
- [x] `CHANGELOG.md` を作成し、Keep a Changelog形式の記載方針を定める
- [x] `tasks.md` を作成する
- [x] Conventional Commitsを規約として明記する
- [x] `.editorconfig` を配置する
- [x] `.gitattributes` を配置する
- [x] Pull Requestテンプレートを配置する
- [x] Issueテンプレートを配置する
- [x] Renovate共有プリセットを参照する `renovate.json` を配置する
- [x] `SECURITY.md` を配置し、GitHubのprivate vulnerability reportingを有効化する

### 完了条件

- [x] ドキュメントの入口と更新責務が定義されている
- [x] ライセンスが確定している
- [x] CHANGELOGとtasks.mdの更新タイミングが規約として明文化されている

## Phase 1: MSIX技術スパイク

- [x] Bun + Vite + React + TypeScript + Tauri v2の最小アプリを作成する
- [x] x64のReleaseビルドを生成する（ARM64のReleaseビルドも生成できたが、ARM64は対応外とした。[design-decisions.md](./docs/design-decisions.md) 3章）
- [x] `Package.appxmanifest` とパッケージ用アセットを作成する
- [x] アプリアイコンをTauriテンプレートの既定からmd-peruse独自のものへ差し替える
- [x] packaged classic app、`mediumIL`、`runFullTrust` を設定する（`broadFileSystemAccess` は宣言しない）
- [x] winapp CLIを固定バージョンで導入し、MSIXを生成する
- [x] 開発用自己署名証明書でローカル検証用パッケージを署名する
- [x] Windows App Certification Kit（WACK）を実行し、結果を保存する（x64。OVERALL_RESULT は PASS。[design-decisions.md](./docs/design-decisions.md) 13.3）
- [x] custom URI scheme protocolを1つ登録し、オリジンとURL形式を実測する（`http://mdperuse-img.localhost/<path>`。[design-decisions.md](./docs/design-decisions.md) 5.4）
- [x] CSPとDOMPurifyの許可URIパターンを実測値で検証する（[design-decisions.md](./docs/design-decisions.md) 5.5。確定はPhase 3）
- [x] MSIX環境でフォルダー選択、読込、監視、関連付け起動を最小検証コードで確認する（[design-decisions.md](./docs/design-decisions.md) 13.4）
- [x] MSIX環境でアプリ設定ディレクトリの解決先を確認する（パッケージ領域へリダイレクトされ、アンインストールで併せて削除される。[design-decisions.md](./docs/design-decisions.md) 13.4）
- [x] 起動時間とアイドル時メモリを測定し、[spec.md](./docs/spec.md) の暫定目標を確定または改訂する（目標は据え置き。[design-decisions.md](./docs/design-decisions.md) 13.3）

### このフェーズで解決する未決事項

- [x] 各ツールの初期バージョン（winapp CLI 0.6.1 を含め確定。[design-decisions.md](./docs/design-decisions.md) 4.10）
- [x] ARM64の扱い（x64ホストからのクロスコンパイルでビルドできることを確認したうえで、実機で検証できないため対応外とした。[design-decisions.md](./docs/design-decisions.md) 3章、13.2）
- [x] custom image protocolのURL形式（`http://mdperuse-img.localhost/<resource-id>`。resource IDの生成方式はPhase 3）
- [x] CSPの初期値とcapabilityの検証（実測反映済み。確定はPhase 3）
- [x] MSIXでのフォルダー選択、監視、関連付け起動（いずれも動作。[design-decisions.md](./docs/design-decisions.md) 13.4）
- [x] MSIXでのアプリ設定保存先（Roamingを使用。[design-decisions.md](./docs/design-decisions.md) 11.1、13.4）
- [x] BunのみでのMSIXビルド可否（Node.jsは不要。[design-decisions.md](./docs/design-decisions.md) 13.2）

## Phase 2: 開発基盤と品質ガードレール

- [x] Bunのバージョンを固定し、`bun.lock` をコミットする（`.bun-version`。[design-decisions.md](./docs/design-decisions.md) 4.4）
- [x] BiomeでLintとFormattingを実行する
- [x] `tsc --noEmit` で型検査を実行する
- [x] LefthookでFrontendとRustの品質チェックをGit Hooksへ組み込む
- [x] Rustで `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` を実行する
- [x] GitHub ActionsでPull Requestごとのテスト、ビルド、静的検査を実行する
- [x] CIで `bun install --frozen-lockfile` を使用する
- [x] `bun:test` でReactコンポーネントのDOMテストが成立する構成を確立する（happy-dom + Testing Library。[design-decisions.md](./docs/design-decisions.md) 14.5）
- [x] Vitestへ退避する条件を明文化する（[design-decisions.md](./docs/design-decisions.md) 14.5）
- [x] Codecovでカバレッジを可視化する（RustとFrontendを分けて集計。CIからOIDCでアップロードする。[design-decisions.md](./docs/design-decisions.md) 4.11）
- [x] Bun本体の更新を通常依存から分離する（`.bun-version` へ移行し、`renovate.json` で `Bun runtime` グループへ切り出して自動マージを無効化。[design-decisions.md](./docs/design-decisions.md) 4.4）
- [x] required status checkを設定したうえで、Renovateの `presets/options/automerge` を戻し、`renovate.json` のautomerge打ち消し（`vulnerabilityAlerts.automerge` と `packageRules`）を解除する
- [x] 依存ライセンス一覧の生成手段を確定し、条文を取得できないパッケージがある場合にCIを失敗させる（`cargo-about` と `scripts/generate-licenses.ts`。生成物はコミットせずlockfileから都度生成する。[design-decisions.md](./docs/design-decisions.md) 11.3）

### このフェーズで解決する未決事項

- [x] `bun:test` でのDOMテスト成立可否とVitestへの退避条件（[design-decisions.md](./docs/design-decisions.md) 14.5）
- [x] ライセンス一覧の生成手段（[design-decisions.md](./docs/design-decisions.md) 11.3）

## Phase 3: 詳細設計

5単位へ分け、[dev-flow.md](./docs/dev-flow.md) 第5章「着手順」の順序で進める。単位ごとにPull Requestを分ける。型と定数は実コードとして置き、選択の理由は [design-decisions.md](./docs/design-decisions.md) へ記録する。

### 3-1 IPCインターフェース

- [x] Tauri commandとeventの型（`FileNode`、走査オプション、読込結果、ファイル変更イベント、テーマ変更イベント）をTypeScriptとRustの双方で定義する（Rust側を正本に `ts-rs` で生成。[design-decisions.md](./docs/design-decisions.md) 5.3）
- [x] IPCのversion、request ID、cancelの契約を定義する（いずれもwire契約へ導入しない。[design-decisions.md](./docs/design-decisions.md) 5.3）
- [x] TypeScriptとRustの型定義を同期させる手段を決め（手書きの二重定義か生成か）、wire契約の一致をCIで検証できるようにする（`ts-rs` で生成し、`Rust` ジョブが差分を検査する）
- [x] エラーの `code` 体系と `retryable` の判定基準を定義する（`IpcError` と `ErrorCode`。retryableはcodeから導出。[design-decisions.md](./docs/design-decisions.md) 5.3）
- [x] custom image protocolのresource ID生成、無効化、キャッシュ方針を定義する（ソルトと変更世代のHMAC、文書単位で発行、ワークスペース切替で無効化。[design-decisions.md](./docs/design-decisions.md) 5.4）
- [x] 非Markdownファイルをツリーへ表示するかを決め、走査オプションへ反映する（表示しない。[design-decisions.md](./docs/design-decisions.md) 6.3）

### 3-2 描画とナビゲーション

- [x] `rehype-sanitize` schemaを最終定義する（既定schemaを継承せず全列挙。`src/markdown/sanitize-schema.ts`。[design-decisions.md](./docs/design-decisions.md) 8.2）
- [x] Raw HTMLをテキストとして出力するhandlerの実装方針を決める（block（`root`・`blockquote`・`listItem`・`footnoteDefinition` 直下）は `pre/code`、それ以外は素のテキスト。コメントも同じ扱い。`src/markdown/raw-html.ts`。[design-decisions.md](./docs/design-decisions.md) 8.1）
- [x] 見出しアンカーのID生成規則と、相対リンク（アンカー付き、ルート外リンクとloose tabを含む）の解決規則を定義する（見出しIDは自前の `rehypeHeadingIds` が既存IDを占有済みとして登録してから `user-content-` 前置で生成し、`rehype-katex` より前に置く。リンク解決はセグメント単位の復号でルート外を拒否、loose tabは関連付け起動のみ。`src/markdown/heading-id.ts`、`src/markdown/link-target.ts`。[design-decisions.md](./docs/design-decisions.md) 7.2、9.1、9.2）
- [x] YAML front matterの扱いを決める（`remark-frontmatter` でYAMLのみ解析し、本文からは除く。TOMLと先頭以外のブロックは本文として残す。[design-decisions.md](./docs/design-decisions.md) 8.1）
- [x] Mermaid、コードブロック、KaTeX、画像の処理上限を定義する（Frontendの上限は `src/markdown/limits.ts`、Rustが検証する上限は `src-tauri/src/limits.rs`。[design-decisions.md](./docs/design-decisions.md) 7.3、8.3、8.4、8.5）
- [x] CSPとTauri capabilityの最終値を確定する（`style-src` をelemとattrへ分け、`font-src` は `'none'`。capabilityは `core:event:allow-listen` / `allow-unlisten` / `opener:allow-open-url` の3つ。正本は `src-tauri/tauri.conf.json` と `src-tauri/capabilities/default.json`。[design-decisions.md](./docs/design-decisions.md) 5.5）

### 3-3 状態管理

- [x] 永続化する状態と、最近使ったフォルダー・最後のワークスペースの復元の採否を決め、設定ファイルのスキーマと `schemaVersion` を定義する（いずれも初期版へ含める。スキーマの正本は `src-tauri/src/settings.rs`、`schemaVersion` は1。Frontendへは絶対パスを渡さず `UiSettings` を投影する。[design-decisions.md](./docs/design-decisions.md) 9.2、11.1）
- [x] ファイル監視の開始、停止、ワークスペース切り替え時のライフサイクルを定義する（ワークスペース単位の再帰監視とloose tab 1件ごとのファイル単体監視の2系統。切替時は旧Watcherを停止してから状態を破棄する。定数の正本は `src-tauri/src/watch.rs`。[design-decisions.md](./docs/design-decisions.md) 6.4）
- [x] 削除、rename、atomic replace後のタブ状態と、置換時の再読込例外の可否を定義する（`loaded` / `stale` / `deleted` の3状態。renameは追跡してパスを追従させ、置換直後の読込失敗は同一イベントにつき1回だけ再読込を許す（案B）。規則の正本は `src/state/tab-status.ts`。[design-decisions.md](./docs/design-decisions.md) 6.5）
- [x] 同時に開けるタブ数の上限と、複数ファイル引数の扱いを決める（上限は20で、超過時は最終アクティブ時刻が最も古い非アクティブタブを閉じる。複数引数は対象拡張子をすべて開き、最後の1つをアクティブにする。正本は `src/state/tabs.ts` と `src-tauri/src/startup.rs`。[design-decisions.md](./docs/design-decisions.md) 9.1、9.2）

### 3-4 UIとUX

- [x] メニューをネイティブ実装とするかWebView内実装とするかを決め、メニュー、ショートカット、パンくずの操作仕様を定義する（ネイティブメニュー。コマンドとアクセラレータの正本は `src-tauri/src/menu.rs`。パンくずはツリーを展開して選択する。[design-decisions.md](./docs/design-decisions.md) 10.1）
- [x] スプリッターの幅範囲、刻み、設定保存と、文字サイズの範囲、刻みを定義する（幅は最小200 px・最大 `min(600 px, ウィンドウ幅の50 %)`・刻み16 px（`Shift` 併用64 px）、文字サイズは80〜200 %の8段階。正本は `src/state/sidebar-width.ts` と `src/state/font-scale.ts`。ショートカットは3-4の1つ目で確定。[design-decisions.md](./docs/design-decisions.md) 10.2、10.3）
- [x] 文書内検索とリンク遷移の戻る／進む操作の採否を決める（いずれも初期版へ含める。検索はWebView2標準の検索バーを使わずCSS Custom Highlight APIで自前実装し、戻る／進むはリンクを同じタブで開いたうえでHistory APIに載せずタブごとの独自スタックで持つ。正本は `src/state/find.ts` と `src/state/doc-history.ts`。[design-decisions.md](./docs/design-decisions.md) 8.6、9.3）
- [x] 単一ファイルまたは単一フォルダーのドラッグ＆ドロップの扱いと、英語UIの採否を決める（いずれも初期版へ含める。ドロップはRust側が受け取り、ファイルは関連付け起動と同じ規則で開き、フォルダーはワークスペースとして開く。Frontendへは受け入れ可否だけを渡す。UI言語は日本語と英語とし、OS追従を既定に設定で切り替える。正本は `src-tauri/src/drop.rs` と `src-tauri/src/i18n.rs`。[design-decisions.md](./docs/design-decisions.md) 10.4、10.5）

### 3-5 Store向けテレメトリ（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）

Microsoft Store版の初回リリースから送るカスタムイベントを要件化する。段階1は3-2の「CSPとTauri capabilityの最終値を確定する」より前に実施する。送信経路がWebViewからのHTTPS通信になる場合、`connect-src` とcapabilityの最終値へ影響するためである。

- [x] 段階1: Tauri + MSIX packaged classic appから利用できるMicrosoft公式のイベント送信経路を実測し、成立可否・制約・CSPとcapabilityへの影響を [design-decisions.md](./docs/design-decisions.md) へ記録する（`StoreServicesCustomEventLogger` を呼べる。Engagement と VCLibs の `PackageDependency` が必要。CSPとcapabilityへは影響しない。[design-decisions.md](./docs/design-decisions.md) 13.5）
- [x] 段階2: イベント名、発火条件、データ最小化、送信失敗時の挙動、Store版限定条件を定義し、[spec.md](./docs/spec.md) のテレメトリ方針とIssueテンプレートの「テレメトリはスコープ外」の記述を更新する。送信単位はシングルインスタンス＋タブ起動を前提としてセッション単位へ統一する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) の決定事項。5種類のイベントをすべて1セッション1回とし、`open_md_fail` も揃えた。正本は `src-tauri/src/telemetry.rs`。[design-decisions.md](./docs/design-decisions.md) 11.4）

### 完了条件

- [x] IPCの入力、出力、失敗条件がTypeScriptとRustの両方で定義されている
- [x] IPCのversion、request ID、cancelの契約が定義されている
- [x] TypeScriptとRustのwire契約が一致していることをCIで検証できる
- [x] エラーコード体系が定義され、Frontendが文字列比較なしで分岐できる
- [x] 永続化する状態と保存先、スキーマが確定している
- [x] ファイル監視のライフサイクルが確定している
- [x] sanitize schemaの許可範囲が全列挙され、暗黙の許可が存在しない
- [x] CSPとcapabilityの最終値が確定している
- [x] P1の未決事項のうち、実装前に確定が必要なものが解消している（残るP1はいずれもPhase 4へ割り当て済み）
- [x] Store向けカスタムイベントの送信経路と要件が確定している

## Phase 4: 機能実装

着手順は [dev-flow.md](./docs/dev-flow.md) 第6章「着手順」を正本とする。層ごとに6.1から6.3の順で進め、Rust Coreは5単位へ分けて単位ごとにPull Requestを分ける。

### 4-1 Rust Core

- [x] ワークスペースとパス境界。相対パスの形式検証と境界判定を `src-tauri/src/path_guard.rs` へ実装し、トラバーサル・区切り表記・代替データストリーム表記・末尾のドットや空白・境界外を指すjunctionの拒否をテストで固定する（[design-decisions.md](./docs/design-decisions.md) 7.1）
- [x] ディレクトリ走査。1階層の取得、除外一覧と属性による除外、`hasChildren` の判定、アクセス拒否を項目単位で表示する応答を実装する（[design-decisions.md](./docs/design-decisions.md) 6.2、6.3）。あわせてワークスペース状態、`ErrorCode` の文言、`scan_directory` commandを実装した
- [x] 自作commandがcapabilityの列挙なしで呼べることをFrontendの結線時に確認する。Tauriのpermissionはプラグインとcoreのcommandを対象とし、`generate_handler!` で登録したアプリ自身のcommandは対象外という前提で `capabilities/default.json` を3権限のままにしている（[design-decisions.md](./docs/design-decisions.md) 5.5）。Phase 4-2の最初の結線で、3権限のまま `scan_directory_command` と `read_file_command` を実機で呼べることを確認し、前提が正しいと確定した
- [x] ファイル読込。BOMによる文字コード判定、10 MiB上限、共有モード、改行の正規化を `src-tauri/src/read.rs` へ実装し、`read_file` commandとして公開した（[design-decisions.md](./docs/design-decisions.md) 6.3、7.1）。260文字を超えるパスは特別扱いしないことを確定した（7.1）
- [x] ファイル変更監視（前半）。`notify` を導入し、`notify::Event` から `RawEvent` への写像、監視イベント用のパス相対化、debounce窓の時間管理を実装した（[design-decisions.md](./docs/design-decisions.md) 6.4、6.5）。削除されたパスは `WorkspaceRoot::relativize` で相対化できない（実在しないパスは `canonicalize` を通せないため）ので、字面で相対化する `relativize_literal` を用意した
- [x] ファイル変更監視（後半・設計の確定）。`notify` のWindowsバックエンドを実測し、`DEBOUNCE_MS`（150）、`MAX_WINDOW_MS`（600）、`REPLACE_RETRY_DELAY_MS`（100）を据え置きで確定した。ディレクトリとファイルがイベントから区別できないこと、バッファあふれと監視停止が通知されないことを確認し、`DirectoryChanged` の生成と窓ごとのイベント数による縮退を実装した（[design-decisions.md](./docs/design-decisions.md) 6.4）。監視範囲の縮退モードは設けないと確定し、15章 P1から落とした
- [x] ファイル変更監視（後半・Tauri統合）。Watcherのライフサイクル、ルートの親の非再帰監視による `WatcherStopped` の検知、監視スコープの採番と破棄、`WatcherOverflow` / `WatcherStopped` の通知、Tauri eventの送出を `src-tauri/src/watch_runtime.rs` へ実装し、`AppState` のワークスペース開閉へ結び付けた（[design-decisions.md](./docs/design-decisions.md) 6.4）。送出先は `ChangeSink` として抽象し、Tauriのアプリインスタンスなしでライフサイクルと送出内容を検証できるようにした
- [x] custom image protocol（前半・参照解決と上限検証）。Markdownの画像参照からワークスペース相対パスへの解決を `src-tauri/src/image/reference.rs` へ、内容による形式判定とバイト数・ピクセル寸法の上限検証を `src-tauri/src/image/format.rs` へ実装した（[design-decisions.md](./docs/design-decisions.md) 7.3）。SVGはピクセル寸法の上限の対象外とし、バイト数の上限だけで守ると確定した
- [x] custom image protocol（後半・発行）。resource IDのソルトと変更世代、対応表の保持とワークスペース切替・バッファあふれでの無効化、`issue_image_resources` commandを実装した（[design-decisions.md](./docs/design-decisions.md) 5.4）。発行時はヘッダーだけで形式と寸法を判定し、判定の入口を配信時と共有する `validate_reader` へまとめた
- [x] custom image protocol（後半・配信）。非同期custom protocolによる配信、同時読込2件の上限、handleベースの最終確認、`Content-Type`・CSP・`nosniff`・キャッシュの応答ヘッダー、HTTPステータスへの写像を `src-tauri/src/image/protocol.rs` へ実装した（[design-decisions.md](./docs/design-decisions.md) 5.4、7.3、7.4）。ワークスペースのロックはhandleの取得までで離し、読込はロックの外で行うと確定した（5.3の例外）。WebView2の `img` 要素からの実際の取得は、Frontendの結線時に確認する

### 4-2以降

- [x] Rust Coreとの最小の結線。ネイティブメニュー（この時点では「フォルダーを開く」と「終了」だけ）、Rust側のフォルダー選択ダイアログ、`WorkspaceOpenedEvent`、Frontendの IPC ラッパー（`src/ipc/`）を置き、仮の画面でルート直下の走査と `.md` の読込を実機で通した（dev-flow 第6章、[design-decisions.md](./docs/design-decisions.md) 5.5、10.1）
- [x] WebViewにフォーカスがあると、ネイティブメニューのアクセラレータもアクセスキーも効かない件。WebView2の `AcceleratorKeyPressed` をRust側（`src-tauri/src/webview_keys.rs`）で受け、`menu.rs` の割り当てと照合してメニューの選択と同じ処理へ渡す。`Alt+英数字` は `SC_KEYMENU` でメニューバーへ渡す（`Alt` 単独と `F10` は転送なしで開くことを実測）。同じ場所でWebView2のブラウザーアクセラレータキーを無効にし、検討待ちの同件を閉じた（`Ctrl+R`、`Ctrl+P`、`F12`、本文がないときの `Ctrl+F` が何もしなくなり、自前の `Ctrl+F` と `Alt+←` はページへ届くことを実測）。wryの `with_browser_accelerator_keys` はTauriが公開していないため、`with_webview` で得るcontrollerへ直接設定する（[design-decisions.md](./docs/design-decisions.md) 8.6、10.1）
- [x] Markdownの基本パイプライン。`remark-parse` から `rehype-sanitize` を経て `rehype-react` でReact要素にする描画を `src/markdown/render.ts` へ、本文の表示と本文中のリンクの遷移止めを `src/preview/MarkdownDocument.tsx` へ実装し、仮の画面の生テキストを置き換えた（[design-decisions.md](./docs/design-decisions.md) 8.1）。表の桁揃えが `style` 属性へ変換される既定動作を止めた。数式は構文の解析だけを入れ、描画はKaTeXの単位で加える
- [x] リンクの解決と遷移。本文中のリンクを `resolveLinkTarget` で解決し、同一文書内のアンカーと脚注はその場で移動、別の文書は現在の表示を差し替え（見出しを指す場合は描画後に移動）、外部URLはOS既定のブラウザー、解決できないリンクと読み込めない文書は遷移せずに理由を表示する（[design-decisions.md](./docs/design-decisions.md) 7.2、8.1）。修飾キー付きクリックと中クリックは何もしない。戻る／進むの履歴は文書内検索と同じ単位で加える
- [x] 画像の表示。描画時に文書内の画像参照をまとめて `issue_image_resources` commandへ渡し、`src` をcustom protocolのURLへ書き換える。発行できなかった画像は位置に原因を表示する。`loading="lazy"` と `decoding="async"` をsanitizeの後に付ける（[design-decisions.md](./docs/design-decisions.md) 5.4、7.3、8.1）
- [x] コードハイライト。lowlightの言語allowlistを28名で確定し、文法を言語ごとに遅延登録する。対象と1ブロック・1文書の上限はsanitize済みの木を読んで決め、`pre` コンポーネントがlowlightの出力をReact要素にする。文法の読込に失敗したブロックはプレーンなまま直後に原因を示す。トークンの配色をライト／ダークで持ち、`forced-colors` では太字と斜体で区別する。React要素への変換を `rehype-react` から `hast-util-to-jsx-runtime` の直接呼び出しへ改めた（[design-decisions.md](./docs/design-decisions.md) 8.1〜8.3）
- [x] 数式の描画。自前の `rehypeMath`（`src/markdown/math.ts`）で、数式を含む文書でだけKaTeXを読み込み、MathMLを生成する。1数式・1文書の上限を超えた数式、構文エラー、KaTeXの読込失敗は、その位置にソースと理由を示す。`rehype-katex` は上限の判定とエラー表示を差し替える口がないため外した。`pipeline.test.ts` を本文描画と同じ組み立て（`markdownToHast`）へ揃えた（[design-decisions.md](./docs/design-decisions.md) 8.5）
- [x] Mermaidの図の描画。`mermaid` fenceがある文書でだけMermaidを読み込み、strictと上書きさせない設定（`htmlLabels`、`flowchart`、`themeCSS` を追加）で描画し、生成SVGをDOMPurifyでsanitizeしてから表示する。Mermaid 12が出力するインラインの `style` 属性はCSPを緩めずSVGの表示属性へ移す（実測で決定）。入力サイズ、エッジ数、タイムアウト、同時描画数、1文書の図の数の上限と、テーマ（`forced-colors` を含む）の変更時の再描画を実装した（[design-decisions.md](./docs/design-decisions.md) 5.5、8.4）
- [x] 文書内検索。`Ctrl+F` / `F3` で開く検索欄を `src/preview/DocumentFind.tsx` へ、本文のDOMから一致の `Range` を集める処理を `src/preview/find-ranges.ts` へ実装し、CSS Custom Highlight APIでハイライトする。ブロック要素の境目をまたぐ一致は出さず、描画後のDOMの入れ替わり（コードハイライト、Mermaid、テーマ変更、文書の差し替え）は `MutationObserver` で探し直す（[design-decisions.md](./docs/design-decisions.md) 8.6）
- [x] 戻る／進む。表示中の文書を1つのタブの状態（インスタンスID、スコープID、パス、状態、読込世代、履歴）として持つ `src/state/document-tab.ts` を置き、画面全体で1つだった読込世代をタブの `beginLoad` / `isCurrentLoad` へ置き換えた。本文のリンク、見出しへの移動、ツリーからの選択を履歴へ積み、`Alt+←` / `Alt+→` とマウスのサイドボタンで行き来する。戻った先を読めなければ理由を示して履歴から取り除く。タブバーと複数タブはUI/UXの単位で加える（[design-decisions.md](./docs/design-decisions.md) 9.1、9.3）
- [x] 設定の読み書き（UI/UXの前提）。`src-tauri/src/settings_store.rs` で起動時の読込、読めない設定の退避と既定値での起動（ネイティブダイアログで通知。退避できなければそのセッションは書かない）、一時ファイルとrenameによるdebounce書込み、終了時のflushを実装し、`get_ui_settings_command` / `update_ui_settings_command` を置いた。書込みの失敗は `SettingsSaveFailed` で示す。メインウィンドウとメニューは設定を読んだ後にsetupで作る（[design-decisions.md](./docs/design-decisions.md) 11.1）
- [x] 最近使ったフォルダー（不透明なIDとメニュー）、最後のワークスペースの復元、ウィンドウ配置の保存と復元（[design-decisions.md](./docs/design-decisions.md) 9.2、11.1）。フォルダー選択、最近使ったフォルダー、起動時の復元は `open_folder::open_path` へ集め、開けたときに正規化した絶対パスを記録する（`src-tauri/src/recent.rs`）。最近使ったフォルダーはファイルメニューの動的なサブメニューと、ワークスペースを開いていないときの案内の一覧に出し、どちらも不透明なIDで開く。起動時の復元は別のスレッドで行い、Frontendは購読してから `get_workspace_command` で問い合わせる。ウィンドウの位置・サイズ・最大化は `src-tauri/src/window_placement.rs` で保存し、タイトルバーの中央が接続中のディスプレイの内側にある配置だけを復元する
- [x] UI/UX: レイアウト骨格。`src/layout/SidebarLayout.tsx` でサイドバー、境界、プレビュー領域の2ペインを置き、起動時に設定を読んでから描画する。幅は保存値と実効値を分けて持ち、キー操作（`←` / `→`、`Shift`、`Home` / `End`）とドラッグで変えて設定へ保存する。プレビュー領域を独立したスクロール領域にし、戻る／進むのスクロール位置をその `scrollTop` へ移した。表示状態は読んで反映するだけで、切り替えはメニュー項目の単位で加える（[design-decisions.md](./docs/design-decisions.md) 9.3、10.2、11.1）
- [x] UI/UX: TreeView。`src/state/file-tree.ts` にツリーの状態（取得状態、展開、走査の2層世代）を、`src/tree/TreeView.tsx` にWAI-ARIAのtreeパターンによる表示とキー操作を置き、サイドバーの仮の一覧を置き換えた。フォルダーは展開したときに走査し、失敗はそのフォルダーの中に示す。`hasChildren: false` のフォルダーは展開矢印を出さない（[design-decisions.md](./docs/design-decisions.md) 5.3、6.2、10章）
- [x] UI/UX: タブバー。`src/state/tab-set.ts`（プレビュータブ、固定、重複の回避、上限と退避、閉じたときの隣の選択）と `src/tabs/TabBar.tsx`（tabsパターン、閉じるボタン、中クリック、ダブルクリックで固定）を置き、`Ctrl+Tab` / `Ctrl+Shift+Tab` でタブを移る。ツリーはシングルクリックと `Space` でプレビュー、ダブルクリックと `Enter` で固定タブとして開く（[design-decisions.md](./docs/design-decisions.md) 9.1、9.3、10章）
- [x] UI/UX: 「タブを閉じる」のメニュー項目と `Ctrl+W`。メニューの振り分けを `src-tauri/src/menu_command.rs` へ移し、Frontendが処理するコマンドをTauri event `menu-command` で渡す経路を作った。`menu.rs` の `IMPLEMENTED` に `CloseTab` を足したことで、WebViewにフォーカスがあるときも `webview_keys.rs` が同じ割り当てで拾う（[design-decisions.md](./docs/design-decisions.md) 10.1）
- [x] UI/UX: 表示メニュー（サイドバーの表示切り替え、再読み込み、文字サイズ）。Frontend担当のコマンドを `menu-command` eventで受け、表示状態と文字サイズを設定へ保存する。再読み込みは読込の理由 `reload` として履歴を動かさず、失敗しても履歴と表示を保つ。文字サイズは `style` 要素で本文の `--font-scale` へ書き、`Ctrl` + `+`（入力文字で判定し、US配列とJIS配列の両方で効く）とテンキーはWebView内で同じ操作へ割り当てる（[design-decisions.md](./docs/design-decisions.md) 10.1、10.3）
- [x] UI/UX: 「ワークスペースを閉じる」のメニュー項目。Rust側（`open_folder::close`）で監視と画像resource IDを破棄してから `workspace-closed` eventを送り、Frontendは切り替えと同じ手順でタブ、本文、ツリーを破棄してwelcome状態へ戻す。最後のワークスペースの記録を消す処理は、最後のワークスペースの復元と一緒に扱う（[design-decisions.md](./docs/design-decisions.md) 6.1、10.1）
- [x] UI/UX: Breadcrumb。`src/breadcrumb/Breadcrumb.tsx` をタブバーの下に置き、アクティブタブのパスをワークスペース名から順に示す。フォルダーのセグメントを選ぶと、サイドバーを表示し、祖先とそのフォルダーを展開して未取得のものを走査し、`TreeView` へフォーカスの要求を渡す。ツリーは走査を待つ間は見えている最も近い祖先にフォーカスを置き、利用者がツリーを操作するかフォーカスが外へ出たら要求を取り下げる（[design-decisions.md](./docs/design-decisions.md) 10.1.1）
- [x] UI/UX: テーマ（System / Light / Dark）。表示メニューのサブメニュー「テーマ」にチェック付きの3項目を置き、Rust側（`src-tauri/src/theme.rs`）で設定へ保存してウィンドウとメニューバーへ適用する。起動時は保存したテーマでウィンドウを作る。Frontendは変えず、WebViewの `prefers-color-scheme` で本文、コードハイライト、Mermaidの図が追従する（実測）。使われなくなった `Theme` / `ThemeChangedEvent` を削除し、`UiSettings` / `UiSettingsUpdate` からテーマを外した（[design-decisions.md](./docs/design-decisions.md) 10.1、11.1）
- [x] UI/UX: ウィンドウタイトル。「文書名 - ワークスペース名 - md-peruse」（タブが無ければ「ワークスペース名 - md-peruse」、ワークスペースが無ければ「md-peruse」）とし、Frontendが `core:window:allow-set-title` でアクティブタブの変化に合わせて設定する。組み立ては `src/state/window-title.ts`（[design-decisions.md](./docs/design-decisions.md) 5.5、10.1.2）
- [x] UI/UX: Reduced Motion。自前のUIにアニメーションは無く、Mermaidのエッジのアニメーション（`animate: true`）だけが `prefers-reduced-motion` を無視して動き続けるため、`reduce` のときは `App.css` の規則で止める。WebView2で、通常は図の破線が動き、`reduce` では止まることを画素の差で確認した（[design-decisions.md](./docs/design-decisions.md) 8.4、10章）
- [x] UI/UX: 狭いウィンドウでのタブバーとパンくず。アクティブなタブが変わったとき（ツリーから開く、`Ctrl+Tab`、タブを閉じた後の切り替え）と幅が変わったときに、アクティブなタブを見える位置へスクロールし、パンくずはパスと幅が変わったときに末尾（表示中の文書名）へスクロールする。両方の横スクロールバーは `scrollbar-width: thin` で細くする。幅の観測は `src/layout/use-resize-observer.ts`（[design-decisions.md](./docs/design-decisions.md) 9.1、10.1.1）
- [x] UI/UX: `forced-colors` の点検。実機のWebView2をCDPで `forced-colors: active`（Windowsの「ハイコントラスト黒」相当）にして、UIの各部と本文を確認し、読めない表示を直した。ツリーで選択した行の文字が消える（Chromiumが敷く下敷きに沈む）、Mermaidの図の線と文字が黒い背景に沈む（白い下地に載せる）、ホバーの表示が消える（細い輪郭で示す）。検索、コード、数式、リスト、フォーカスの輪郭には問題がなかった（[design-decisions.md](./docs/design-decisions.md) 10.6）
- [x] UI/UX: 文字列の分離（Frontend）と起動時のUI言語。画面内の文言を `src/i18n/messages.ts` の `Record<Language, Messages>` へ分離し、`LanguageProvider` で渡す。Appは設定の `effectiveLanguage` で描画し、`<html lang>` を合わせる。数式の理由はhastへ書くため言語ごとにプロセッサを持ち、Mermaidの失敗は種類を持たせて表示のときに文言へ変える（[design-decisions.md](./docs/design-decisions.md) 10.5）
- [x] UI/UX: UI言語の切り替え。表示メニューの「言語」（システム / 日本語 / English）、Rust側の切り替え処理（設定の保存、`AppState` の言語、メニューの組み直し、`LanguageChangedEvent` の送出）、Frontendのイベント購読（[design-decisions.md](./docs/design-decisions.md) 10.1、10.5）
- [x] UI/UX: ライセンス表記の表示。ヘルプメニューの「md-peruse について」（`about`）が、WebView内のモーダルな `<dialog>`（`src/licenses/AboutDialog.tsx`）を開く。バージョン、md-peruse自身のライセンス、サードパーティの約490件を、名前で絞り込める一覧で示し、本文は行を開いたときにだけ描く。生成物は `public/third-party-licenses.json` へ出力し、`tauri build` の前に生成して同梱し、ダイアログを開いたときに `fetch` で読む（[design-decisions.md](./docs/design-decisions.md) 10.1、11.3）
- [x] 走査応答の世代管理（ワークスペース世代とパス世代）を実装し、同一パスの再走査・別パスの同時走査・ワークスペース切替の競合をテストで固定する（[design-decisions.md](./docs/design-decisions.md) 5.3）。`src/state/file-tree.test.ts` で固定した。監視の `DirectoryChanged` による再走査は、監視イベントをFrontendへつなぐ単位で同じ仕組みに載せる
- [x] 監視スコープ（`scopeId`）の採番と破棄を実装し、暗黙のルートが異なる同名のloose tabへイベントが混入しないこと、ワークスペース切替の直前に送出された旧Watcherのイベントが新しいルートへ適用されないことをテストで固定する（[design-decisions.md](./docs/design-decisions.md) 6.4）。ワークスペース側は、Frontendが `file-change`、`watcher-error`、`images-changed` を現在のワークスペースの `scopeId` と照合して捨てることを、`src/state/tab-status.test.ts` と `src/App.test.tsx` で固定した。loose tab（暗黙のルート）も、loose tab 1つにつき1つのスコープを採番し、Frontendは開いているタブが持つスコープの通知だけを受け入れる。同じ相対パスのワークスペースの文書とloose tabの文書が別物であることと、閉じたスコープの要求が拒否されることを、`src/App.test.tsx` と `src-tauri/src/state.rs` のテストで固定した
- [x] 文書読込の世代を実装し、置換直後の再読込（[design-decisions.md](./docs/design-decisions.md) 6.5）で先に開始した読込が後から完了しても、新しい内容を古い内容で上書きしないことを、完了順を反転させた回帰テストで固定する。読込の開始から完了までの間に変更イベントが届く順序（A開始 → B変更 → A完了 → B読込開始）と、タブを閉じて同じパスで開き直した後に旧タブの応答が届く順序も併せて固定する。状態の規則は `src/state/tab-status.test.ts`、Frontendへの結線は `src/App.test.tsx`（「ファイル変更への追従」。完了順を反転させた応答が新しい表示を上書きしないこと）で固定した
- [x] `notify` のイベントを `watch::RawEvent` へ写像する処理とdebounce窓の時間管理を実装し、実ファイルに対するatomic replaceで開いているタブが `deleted` にならず再読込されることを、MSIX環境の実測列と突き合わせて確認する（[design-decisions.md](./docs/design-decisions.md) 6.4、6.5）。写像と窓は4-1で実装した。Frontendへ結線したうえで、`tauri dev`（パッケージ外）の実機で、実ファイルのatomic replace（単発と、50 ms間隔の20回連続）を行い、タブが `deleted` にならずに最後の内容へ追従し、スクロール位置も保たれることを確認した。MSIXパッケージ内での確認はPhase 5で行う
- [x] 画像resource IDの世代管理を実装し、同一サイズ・更新時刻据え置きの書換えと、監視のバッファあふれ後の再描画でIDが更新されることをテストで固定する（[design-decisions.md](./docs/design-decisions.md) 5.4）。Rust側の世代の前進とあふれ時の作り直しは4-1e（発行）で固定した。再描画の契機として、発行済みの画像が書き換わったときだけRustが `images-changed` を送り（`ImageResources::advance` が進めたかを返す。文書の窓とは別の窓で畳み込む）、Frontendが表示中の文書の画像を発行し直す。あふれ（`watcher-error`）でも発行し直す。Rust側は `watch_runtime.rs` のテスト、Frontend側は `MarkdownDocument.test.tsx` と `App.test.tsx` で固定した。実機では、表示中の画像だけを書き換えて、Markdownを読み直さずに赤から青へ更新されることを確認した
- [ ] Store向けカスタムイベント（`session_start`、`open_md_ok`、`open_md_fail`、`open_folder`、`launch_by_association`）の発火点を各機能の実装と同時に組み込む。キャンセルや失敗で成功イベントを送らないこと、送信失敗がファイル・フォルダー操作を失敗させないこと、各イベントが1セッションにつき1回しか送られないことをテストで固定する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階3）
- [ ] カスタムイベントの送信を `Package.Current.SignatureKind` が `Store` のときだけに限る判定を実装し、パッケージ化した開発版・テスト版（`Developer` 署名）と非パッケージ実行のいずれでも送信しないことを回帰テストで固定する。非パッケージ実行で経路が成立しないことに依存せず、署名種別の判定を経路に必ず通す（[design-decisions.md](./docs/design-decisions.md) 11.4）
- [ ] 文書内検索を実装し、プレビュー本文とコードブロックだけが対象になること、KaTeX出力の二重ヒットが起きないこと、一致位置とハイライトの範囲がずれないことをテストで固定する。`forced-colors` 有効時に `::highlight()` の一致が判読できることもあわせて確認する（[design-decisions.md](./docs/design-decisions.md) 8.6）。対象・二重ヒット・範囲の位置は `find-ranges.test.ts` と `App.test.tsx` で固定した。`forced-colors` は現在位置だけを示す形にし、Chromiumのエミュレーションと、実機のWebView2のCDPによるエミュレーション（[design-decisions.md](./docs/design-decisions.md) 10.6）で、検索バーと現在位置のハイライトが判読できることを確認した。残るのは実際のOSのハイコントラスト設定下のWebView2での確認である（「検討待ち」）
- [x] UI言語の切り替えを実装し、メニューから `useJapanese` / `useEnglish` / `useSystemLanguage` を選んだときに、ネイティブメニューの項目名とWebView内の文言の両方が切り替わることをテストで固定する。`LanguageChangedEvent` を受け取らないままFrontendの文言が旧言語で残らないこと、`system` を選んでいる間はイベントが飛ばないこと、言語切替の直前に発行した要求の応答が旧言語で届いても表示が壊れないことも併せて固定する（[design-decisions.md](./docs/design-decisions.md) 10.5）。Rustは `language.rs` のテストで、状態・設定・メニューの項目名とチェック・eventを固定した。Frontendは `App.test.tsx` で、eventを受けたときの案内・ラベル・数式の理由の切り替えと、eventが無いと変わらないこと、旧言語の応答が届いても壊れないことを固定した。起動時に設定の応答より先にeventが届く場合と、設定を読む前に購読が済んでいることも固定した
- [x] ドラッグ＆ドロップを実装し、`tauri://drag-enter` で判定した受け入れ可否が `DragState` としてFrontendへ届くこと、`drag-over` では判定し直さないこと、フォルダーとファイルが混在したドロップでワークスペースを先に開くこと、対象外だけのドロップで何も起きないことをテストで固定する。ドロップされた絶対パスがFrontendへ渡らないこともセキュリティ回帰として固定する（[design-decisions.md](./docs/design-decisions.md) 10.4）。前提のloose tab（9.1。スコープを持つ読込と画像の発行、ファイル単体のWatcher、スコープの破棄）とあわせて実装した。Rustは `drag_drop.rs`（受け入れ可否と実行）、`open_document.rs`（開き先の決定。payloadに絶対パスを載せないこと）、`state.rs`（スコープ）、`watch_runtime.rs`（`LooseWatcher`）のテストで、Frontendは `App.test.tsx` で固定した。実機（`tauri dev` のWebView2、Explorerからのドラッグ）で、Markdownのファイル・対象外のファイル・フォルダー・フォルダーとファイルの混在、ワークスペース内外のファイルのドロップを確認した
- [x] タブごとの戻る／進むを実装し、リンク遷移が同じタブで行われること、renameを追跡して履歴のパスが追従すること、読み込めない履歴項目が取り除かれること、WebViewのHistory APIへ何も積まれないままマウスのサイドボタンと `Alt+←` / `Alt+→` が自前のスタックだけを動かすことをテストで固定する（[design-decisions.md](./docs/design-decisions.md) 9.3）。リンク遷移が同じタブで行われること、読み込めない履歴項目の除去、History APIへ積まないこととサイドボタン・`Alt+←` / `Alt+→` は `document-tab.test.ts` と `App.test.tsx` で固定した。renameの追跡は、監視イベントをFrontendへつないだ単位（`src/state/tab-changes.ts` と `App.test.tsx`。履歴の旧パスが新しいパスへ追従すること）で固定した
- [x] 関連付け起動と単一インスタンス。`tauri-plugin-single-instance` で2つ目のプロセスを起動中のインスタンスへ渡し、ウィンドウを最小化や非表示から戻して前面へ出す。新規起動の引数と2つ目のプロセスの引数は同じ入口で、同じ規則（`files_to_open`）でファイルを選び、相対パスはそのプロセスの作業ディレクトリで解決する。開くのは、最後のワークスペースの復元が済み、Frontendが購読と起動時の問い合わせを終えて `frontend_ready_command` で知らせてからで、それまでは届いた順に保留する（`src-tauri/src/launch.rs`）。関連付け起動でも最後のワークスペースを復元し、そのあとにファイルを開く（ワークスペースの中なら通常タブ、外ならloose tab）。テレメトリの発火点はこのPRに含めない（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階3は別のPR）。Rustは保留の状態機械と開く順序、Frontendは準備の知らせの順序をテストで固定し、変異（Rust 9種、Frontend 3種）で検出できることを確かめた。実機（`tauri dev`）で、引数付きの新規起動（復元したワークスペースの隣にloose tab）と、最小化したウィンドウへの2つ目のプロセス（絶対パスはワークスペース内の通常タブ、相対パスは作業ディレクトリで解決したloose tab、引数なしは前面化だけ）を確認した。2つ目のプロセスは約0.3秒で終了コード0で終わる（[design-decisions.md](./docs/design-decisions.md) 9.2）
- [ ] 「起動中に2つ目の `.md` を関連付けから開く」経路をE2E回帰項目として固定する。既存ウィンドウへのタブ追加では `session_start` と `launch_by_association` を送らず、`open_md_ok` もセッション内の最初の描画完了時だけであることを、コールドスタート経路と分けて検証する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階3）。タブの追加と前面化は上の項目で固定した。残るのは、この経路でテレメトリを送らないことの検証で、テレメトリの発火点と同じPRで行う
- [ ] 応答の遅いストレージ（ネットワークドライブ、切断中のドライブ）をワークスペースにしたときに、走査と読込の待ち時間中もウィンドウの操作を続けられることをE2Eで確認する。commandは `spawn_blocking` でメインスレッドを解放しているが（[design-decisions.md](./docs/design-decisions.md) 5.3）、Frontendを結線するまで実機で確かめられない

### 完了条件

- [ ] [spec.md](./docs/spec.md) の機能要件をテストで確認できる
- [ ] atomic replaceによる連続更新でプレビューが壊れない
- [ ] キーボードだけで主要操作を完了できる
- [ ] 不正なMarkdownやMermaid入力でアプリが停止しない
- [ ] セキュリティ回帰テストが通る
- [ ] 陳腐化した走査応答が新しいツリーを上書きせず、別パスの同時走査が相互に無効化されない
- [ ] 画像の更新と監視のバッファあふれの後に、古い画像がキャッシュから表示されない
- [ ] `forced-colors` 有効時にMermaid図とコードブロックが判読できる
- [ ] [spec.md](./docs/spec.md) の性能目標を満たす

## Phase 5: 配布パイプラインとStore公開

- [ ] MSIXのIdentity、Publisher、表示名、アイコンをPartner Centerの登録内容と一致させる
- [x] 比率2.067のワイドロゴを用意し、`Wide310x150Logo` と `Square310x310Logo` をマニフェストへ追加する（[design-decisions.md](./docs/design-decisions.md) 13.1）
- [ ] バージョン番号を各マニフェストと設定ファイルで同期し、不一致をCIで検出する
- [ ] GitHub Actionsでx64版をビルドし、MSIXとWACK結果をartifactとして保存する
- [ ] パッケージ化したMSIXの実機で、ファイル変更への追従（atomic replaceでの再読込、画像だけの書き換え、削除、rename、フォルダーの増減）と、ドラッグ＆ドロップで開いたloose tab（外部での書き換え、相対リンクでの移動）を確認する。Phase 4では `tauri dev`（パッケージ外）で確認した（[design-decisions.md](./docs/design-decisions.md) 6.4、6.5、5.4）
- [ ] パッケージ化したMSIXの実機で、関連付け起動を確認する。別のアプリが前面にあるときにウィンドウが前面へ出るか、エクスプローラーで複数のファイルを選んで開いたときの引数の渡され方（1つのプロセスへ複数の引数か、ファイル数ぶんのプロセスか）、単一インスタンスの検出がパッケージ内でも成立するかを確かめる。Phase 4では `tauri dev`（パッケージ外）の、最小化したウィンドウで確認した（[design-decisions.md](./docs/design-decisions.md) 9.2）
- [ ] プライバシーポリシーとデータ収集申告を準備する
- [ ] Store向けカスタムイベントのデータ収集申告とプライバシーポリシーを、送信するイベントの内容に合わせて更新する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）
- [ ] 初回Store公開版でPartner Centerからカスタムイベントとパッケージバージョン別の集計を確認し、反映遅延とバージョン別フィルターの粒度を計測定義へ記録する。標準Sessions指標については、対応付けを行わない方針（[design-decisions.md](./docs/design-decisions.md) 11.4）のもとで観測した件数差を確認するにとどめ、照合方法の確定は行わない（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）
- [ ] 使用状況とカスタムイベントの計測母集団（診断データをオプトインした端末に限られること）を実データで確認し、率は読めてもインストール数へ接続できない制約を、反映遅延と並べて計測定義へ明記する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）
- [ ] Store掲載情報を準備する
- [ ] Partner Centerで初回登録と審査申請を行う
- [ ] Store Submission API連携を構築し、実行前に手動承認ゲートを設ける
- [ ] 手動提出の手順書を維持する

### 完了条件

- [ ] x64版のMSIXが生成される
- [ ] 対象MSIXについてWACKが完了している
- [ ] Store提出物とCIで検証した成果物が一致している
- [ ] プライバシーポリシーとデータ収集申告が提出内容と整合している
- [ ] Tauri Updaterや `.appinstaller` に依存せず、Store更新だけで更新できる

## 検討待ち

作業中に見つかった、そのPull Requestのスコープ外の事項を積む。「未決事項の一覧」が設計判断としてフェーズへ割り当て済みのものを指すのに対し、本節は割り当て先がまだ決まっていないものを保持する。

判断してフェーズが決まったら該当フェーズのタスクへ移し、本節からは削除する。「対応しない」と決めた場合も、結論を [design-decisions.md](./docs/design-decisions.md) へ残してから削除する。各項目には、見つけた文脈と判断が必要な点を書く。

- [ ] Markdownの読込（`read.rs` の `read_file`）が、handleの最終パスによる境界の確認を行っていない。画像の配信は `WorkspaceRoot::open_file` で開いたhandleの最終パスを確かめるが、読込は `resolve` の後に `File::open` するだけであり、その間に経路上のフォルダーを境界外へのjunctionへ差し替えられると境界外を読みうる（[design-decisions.md](./docs/design-decisions.md) 7.1「可能な箇所ではhandleベースで最終確認する」）。読込も `open_file` へ寄せるかを決める。寄せる場合は `a_file_opened_without_sharing_is_reported_as_a_sharing_violation` など既存テストのエラー区分が変わらないことを確かめる（Phase 4-1eの配信実装時に発見）
- [ ] `webview2-com` / `webview2-com-core`（`windows-core`）/ `muda` の更新は Tauri（wry）の解決版に縛られる。単独で上げると crate が二重にリンクされ、`with_webview` が返す controller とイベントハンドラの型が別物になってコンパイルが通らない（Renovate の #88 で実際に失敗）。`renovate.json` で Dependency Dashboard 承認制にして単独更新を止めた。Tauri が wry を上げたら（現在 tauri 2.11.6 = wry 0.55.1 → webview2-com 0.38.2 / windows-core 0.61.2 / muda 0.19.3）、この 3 つを Tauri と同時に上げる。承認制の代わりに Tauri とグループ化して 1 つの PR にまとめられるかも、そのときに判断する
- [ ] JavaScript依存のライセンス種別にallowlistがない。Rust側は `about.toml` の `accepted` が未列挙のライセンスを検出するが、JavaScript側は条文を取得できれば通るため、GPLなど再配布条件の異なる依存が入っても気づけない。生成物のコミットをやめた（[design-decisions.md](./docs/design-decisions.md) 11.3）ことで、Pull Requestの差分から気づく経路もなくなった。`scripts/generate-licenses.ts` へ許容ライセンスの列挙を足すかを決める。足す場合は、受け入れ済みの EPL-2.0（`elkjs`）を列挙に含める
- [x] EPL-2.0 の依存（`elkjs` 0.9.3。Mermaid 12 の `layout: elk` 用）を同梱する。EPL-2.0 はオブジェクト形式で配布する場合もソースコードの入手方法を案内する必要があるため、サードパーティライセンスの表示画面で、上流リポジトリ（https://github.com/kieler/elkjs）を示す。受け入れはMermaidの単位で判断した（[design-decisions.md](./docs/design-decisions.md) 11.3、8.4）。入手先は `licenses/overrides/elkjs/SOURCE-URL` に置き、生成物の `sourceUrl` としてダイアログが本文の前に示す
- [ ] `licenses/overrides/rehype-katex/` が残っている。`rehype-katex` は数式の単位（#75）で依存から外したため参照されない。削除してよいかを確かめる
- [x] WebView2のブラウザーアクセラレータキーが有効なままである件。まとめて無効化した（4-2以降のアクセラレータの項目で対応。[design-decisions.md](./docs/design-decisions.md) 10.1）
- [ ] Markdown本文のリンクがNFDで書かれ、実ファイルがNFCのとき解決に失敗する。NTFSは名前を正規化せず、`パ`（U+30D1）と `ハ` + 結合濁点（U+30CF U+309A）は別のファイルとして共存する（Phase 4-1aの境界判定の実測中に確認）。境界判定では正規化を行わないと決めた（[design-decisions.md](./docs/design-decisions.md) 7.1）が、リンク解決の側でNFCとNFDの両方を試すかは別の判断である。macOS由来のリポジトリをWindowsで開いたときに起こりうる。両方を試す場合は `unicode-normalization` の依存追加と、NFCとNFDの同名ファイルが共存するときにどちらを開くかの規則が要る。Phase 4-2（リンク解決）で判断する
- [ ] 脚注セクションの見出し `<h2 class="sr-only">Footnotes</h2>` から `class` が落ちる。`src/markdown/sanitize-schema.ts` の `attributes.h2` が `["id"]` のみのため、スクリーンリーダー向けの隠し見出しが画面上に現れる。schemaへ `className` を許可するか、脚注セクションの見出しをCSSで制御するかを決める（Phase 3-2の見出しアンカー実装時に発見。sanitize schemaは全列挙の方針であり、`className` を許可する場合は値のパターンまで固定する必要がある）
- [ ] UTF-32 LEのBOM（`FF FE 00 00`）がUTF-16 LEのBOM（`FF FE`）を前置しているため、UTF-32 LEのファイルをUTF-16 LEとしてデコードし、NUL文字が並んだ本文を「読めた」として表示する。[design-decisions.md](./docs/design-decisions.md) 6.3は未対応の文字コードについて「原因を表示する」と定めており、この経路だけがそれに反する。`FF FE 00 00` を先に判定して `DecodeFailed` とするかを決める（Phase 4-1cのファイル読込実装時に発見。UTF-32をエディタの既定にする経路がなく、優先度は低い）
- [ ] ARM64を対応外とした（[design-decisions.md](./docs/design-decisions.md) 3章）ことに伴う、Store側の扱いを決める。x64だけのパッケージがARM64端末のStoreに表示・提供されるか、Partner Centerで対象を絞れるか、Store掲載情報のシステム要件へ「x64のみ対応」を書くかを、Store掲載情報を準備するとき（Phase 5）に確認する。ARM64のWindowsでx64版が動くかは検証しておらず、保証しない方針である
- [ ] ツリーの行をダブルクリックすると、ラベルの語が選択されて青く反転する（実機で発見。例: `document-06-with-a-…` の `with`）。ダブルクリックは固定タブで開く操作であり、テキストの選択は意図しない。行へ `user-select: none` を付けるかを、ツリーの見た目と併せて決める（UI/UXの狭いウィンドウの実機確認で発見）
- [ ] 実際のOSのハイコントラスト設定下のWebView2で確認する（黒以外のテーマ、タイトルバー、ネイティブメニューの見た目）。CDPのエミュレーションではWebViewの内側を「ハイコントラスト黒」相当で確認済みだが、OSの設定を切り替える操作を伴うため、ユーザーの了承を得て行う（[design-decisions.md](./docs/design-decisions.md) 10.6。`forced-colors` の点検で持ち越し）
- [ ] 関連付け起動で渡したファイルは、最後のワークスペースの復元が済むまで開かない（[design-decisions.md](./docs/design-decisions.md) 9.2）。復元先がネットワークドライブなど応答の遅いストレージのとき、ファイルの表示も復元の完了まで待たされる。復元に待ち時間の上限を設けて、超えたらファイルを先に開くか、そのまま待つかを、応答の遅いストレージのE2E（Phase 4）で実測して決める（関連付け起動の実装時に見つけた）
- [ ] ドラッグ＆ドロップで開いたフォルダーを、Storeのカスタムイベント `open_folder`（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階3）の発火点へ数えるかを決める。「フォルダーを開く」、最近使ったフォルダー、起動時の復元、ドロップは、すべて `open_folder::open_path` へ集まる。「ワークスペースを開いたとき」（[design-decisions.md](./docs/design-decisions.md) 11.4）の解釈として、復元とドロップを含めるか（起動するだけで送られると、フォルダー中心の利用の指標にならない）を、段階3の着手時に決める（ドラッグ＆ドロップの実装時に見つけた）
- [ ] loose tabのWatcherは、所在フォルダーを非再帰で監視する（ファイル単体の監視は、atomic replaceで対象を失うため。[design-decisions.md](./docs/design-decisions.md) 6.4）。Downloadsのように更新の多いフォルダーの文書を開くと、無関係な変更でも監視スレッドが起きる（`coalesce` で捨てる）。窓の縮退までは実装済みだが、アイドル時の低負荷（[spec.md](./docs/spec.md) 5.2）への影響は実測していない。実測して、必要なら対象のファイル名でイベントを絞る（ドラッグ＆ドロップの実装時に見つけた）
- [ ] ウィンドウ配置の復元を、複数ディスプレイとDPIの混在する環境で確認する（最後に使ったディスプレイを外した状態、DPIの異なるディスプレイ間の移動、最大化したまま終了した状態）。判定の規則は単体テストで固定したが、実機で確認したのは1台のディスプレイでの保存と復元だけである（[design-decisions.md](./docs/design-decisions.md) 11.1）

## 未決事項の一覧

未決事項の内容と解決フェーズの割り当ては [dev-flow.md](./docs/dev-flow.md) 第8章、判断の根拠は [design-decisions.md](./docs/design-decisions.md) 第15章を参照する。解決状況は各Phaseのチェックリストで追跡する。
