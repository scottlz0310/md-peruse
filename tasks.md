# md-peruse タスク管理

実装タスクと未決事項の解決状況を追跡する。作業手順とフェーズの定義は [docs/dev-flow.md](./docs/dev-flow.md)、設計判断は [docs/design-decisions.md](./docs/design-decisions.md) を正本とし、本書は進捗の正本とする。

## 運用ルール

- チェックボックスは未完了 `[ ]` と完了 `[x]` の2状態で運用する。GFMのタスクリストが解釈できない独自記法は使わない。
- 着手中のフェーズは「進捗サマリ」の状態列で示す。
- Pull Requestを作成するときに、対象タスクの状態と `CHANGELOG.md` を併せて更新する。
- 未決事項を解決したら、結論を `docs/design-decisions.md` へ記載し、本書のチェックを閉じる。
- Phase 3以降のタスクは、着手時にフェーズ内で詳細化する。現時点では完了条件の粒度で保持する。

## 進捗サマリ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| Phase 0 | リポジトリ整備 | 進行中 |
| Phase 1 | MSIX技術スパイク | 未着手 |
| Phase 2 | 開発基盤と品質ガードレール | 一部先行 |
| Phase 3 | 詳細設計 | 未着手 |
| Phase 4 | 機能実装 | 未着手 |
| Phase 5 | 配布パイプラインとStore公開 | 未着手 |

Phase 1とPhase 2は一部を先行させる。着手順は [dev-flow.md](./docs/dev-flow.md) 「1.1 フェーズの着手順」を正本とし、本書では重複して定義しない。本書は各タスクの状態のみを追跡する。

## Phase 0: リポジトリ整備

- [x] リポジトリを初期化する
- [ ] 既定ブランチの保護設定を決める（必須レビュー、必須ステータスチェック）
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

- [ ] Bun + Vite + React + TypeScript + Tauri v2の最小アプリを作成する
- [ ] x64とARM64のReleaseビルドを生成する
- [ ] `Package.appxmanifest` とパッケージ用アセットを作成する
- [ ] packaged classic app、`mediumIL`、`runFullTrust` を設定する（`broadFileSystemAccess` は宣言しない）
- [ ] winapp CLIを固定バージョンで導入し、アーキテクチャ別MSIXを生成する
- [ ] 開発用自己署名証明書でローカル検証用パッケージを署名する
- [ ] Windows App Certification Kit（WACK）を実行し、結果を保存する
- [ ] custom URI scheme protocolを1つ登録し、オリジンとURL形式を実測する
- [ ] CSPとDOMPurifyの許可URIパターンを実測値で検証する
- [ ] MSIX環境でフォルダー選択、読込、監視、関連付け起動を最小検証コードで確認する
- [ ] MSIX環境でアプリ設定ディレクトリがLocalStateへ解決されることを確認する
- [ ] 起動時間とアイドル時メモリを測定し、[spec.md](./docs/spec.md) の暫定目標を確定または改訂する

### このフェーズで解決する未決事項

- [ ] 各ツールの初期バージョン
- [ ] ARM64のビルド方式（ネイティブARM64ランナー／クロスコンパイル）
- [ ] custom image protocolのURL形式とresource ID
- [ ] CSPの初期値とcapabilityの検証（確定はPhase 3）
- [ ] MSIXでのフォルダー選択、監視、関連付け起動
- [ ] MSIXでのアプリ設定保存先
- [ ] BunのみでのMSIXビルド可否（Node.js依存の有無）

## Phase 2: 開発基盤と品質ガードレール

- [ ] Bunのバージョンを固定し、`bun.lock` をコミットする
- [ ] BiomeでLintとFormattingを実行する
- [ ] `tsc --noEmit` で型検査を実行する
- [ ] LefthookでFrontendとRustの品質チェックをGit Hooksへ組み込む
- [ ] Rustで `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` を実行する
- [ ] GitHub ActionsでPull Requestごとのテスト、ビルド、静的検査を実行する
- [ ] CIで `bun install --frozen-lockfile` を使用する
- [ ] `bun:test` でReactコンポーネントのDOMテストが成立する構成を確立する
- [ ] Vitestへ退避する条件を明文化する
- [ ] Codecovでカバレッジを可視化する（RustとFrontendを分けて集計）
- [ ] Bun本体の更新を通常依存から分離する（Renovate共有プリセット側で対応）
- [ ] required status checkを設定したうえで、Renovateの `presets/options/automerge` を `renovate.json` へ戻す
- [ ] 依存ライセンス一覧の生成手段を確定し、未更新時にCIを失敗させる

### このフェーズで解決する未決事項

- [ ] `bun:test` でのDOMテスト成立可否とVitestへの退避条件
- [ ] ライセンス一覧の生成手段

## Phase 3: 詳細設計

- [ ] IPCの型、エラー契約、capabilityの最小集合を定義する
- [ ] 永続化する状態、設定ファイルのスキーマ、`schemaVersion` を定義する
- [ ] 描画とナビゲーションの仕様（sanitize schema、アンカー、相対リンク等）を確定する

### 完了条件

- [ ] IPCの入力、出力、失敗条件がTypeScriptとRustの両方で定義されている
- [ ] エラーコード体系が定義され、Frontendが文字列比較なしで分岐できる
- [ ] 永続化する状態と保存先、スキーマが確定している
- [ ] ファイル監視のライフサイクルが確定している
- [ ] sanitize schemaの拡張差分が列挙され、暗黙の許可が存在しない
- [ ] CSPとcapabilityの最終値が確定している
- [ ] P1の未決事項のうち、実装前に確定が必要なものが解消している

## Phase 4: 機能実装

- [ ] Rust Core（走査、読込、監視、パス検証、custom protocol）
- [ ] Frontend Markdown（unified、sanitize、Mermaid、lowlight、KaTeX）
- [ ] UI/UX（Titlebar、Breadcrumb、Sidebar、Resizer、PreviewArea、テーマ、キーボード操作）

### 完了条件

- [ ] [spec.md](./docs/spec.md) の機能要件をテストで確認できる
- [ ] atomic replaceによる連続更新でプレビューが壊れない
- [ ] キーボードだけで主要操作を完了できる
- [ ] 不正なMarkdownやMermaid入力でアプリが停止しない
- [ ] セキュリティ回帰テストが通る
- [ ] `forced-colors` 有効時にMermaid図とコードブロックが判読できる
- [ ] [spec.md](./docs/spec.md) の性能目標を満たす

## Phase 5: 配布パイプラインとStore公開

- [ ] MSIXのIdentity、Publisher、表示名、アイコンをPartner Centerの登録内容と一致させる
- [ ] バージョン番号を各マニフェストと設定ファイルで同期し、不一致をCIで検出する
- [ ] GitHub Actionsでx64版とARM64版をビルドし、MSIXとWACK結果をartifactとして保存する
- [ ] プライバシーポリシーとデータ収集申告を準備する
- [ ] Store掲載情報を準備する
- [ ] Partner Centerで初回登録と審査申請を行う
- [ ] Store Submission API連携を構築し、実行前に手動承認ゲートを設ける
- [ ] 手動提出の手順書を維持する

### 完了条件

- [ ] x64版とARM64版のMSIXが同一バージョンで生成される
- [ ] 対象MSIXについてWACKが完了している
- [ ] Store提出物とCIで検証した成果物が一致している
- [ ] プライバシーポリシーとデータ収集申告が提出内容と整合している
- [ ] Tauri Updaterや `.appinstaller` に依存せず、Store更新だけで更新できる

## 未決事項の一覧

未決事項の内容と解決フェーズの割り当ては [dev-flow.md](./docs/dev-flow.md) 第8章、判断の根拠は [design-decisions.md](./docs/design-decisions.md) 第15章を参照する。解決状況は各Phaseのチェックリストで追跡する。
