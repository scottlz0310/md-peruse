# md-peruse タスク管理

実装タスクと未決事項の解決状況を追跡する。作業手順とフェーズの定義は [docs/dev-flow.md](./docs/dev-flow.md)、設計判断は [docs/design-decisions.md](./docs/design-decisions.md) を正本とし、本書は進捗の正本とする。

## 運用ルール

- チェックボックスは未完了 `[ ]` と完了 `[x]` の2状態で運用する。GFMのタスクリストが解釈できない独自記法は使わない。
- 着手中のフェーズは「進捗サマリ」の状態列で示す。
- Pull Requestを作成するときに、対象タスクの状態と `CHANGELOG.md` を併せて更新する。
- フェーズ最後のタスクを閉じるPull Requestでは、「進捗サマリ」の状態と [dev-flow.md](./docs/dev-flow.md) のフェーズ完了条件も併せて更新する。
- 未決事項を解決したら、結論を `docs/design-decisions.md` へ記載し、本書のチェックを閉じる。
- Phase 4以降のタスクは、着手時にフェーズ内で詳細化する。現時点では完了条件の粒度で保持する。

## 進捗サマリ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| Phase 0 | リポジトリ整備 | 完了 |
| Phase 1 | MSIX技術スパイク | 完了 |
| Phase 2 | 開発基盤と品質ガードレール | 完了 |
| Phase 3 | 詳細設計 | 着手中 |
| Phase 4 | 機能実装 | 未着手 |
| Phase 5 | 配布パイプラインとStore公開 | 未着手 |

着手順は [dev-flow.md](./docs/dev-flow.md) 「1.1 フェーズの着手順」と第5章「着手順」を正本とし、本書では重複して定義しない。本書は各タスクの状態のみを追跡する。

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
- [x] x64とARM64のReleaseビルドを生成する
- [x] `Package.appxmanifest` とパッケージ用アセットを作成する
- [x] アプリアイコンをTauriテンプレートの既定からmd-peruse独自のものへ差し替える
- [x] packaged classic app、`mediumIL`、`runFullTrust` を設定する（`broadFileSystemAccess` は宣言しない）
- [x] winapp CLIを固定バージョンで導入し、アーキテクチャ別MSIXを生成する
- [x] 開発用自己署名証明書でローカル検証用パッケージを署名する
- [x] Windows App Certification Kit（WACK）を実行し、結果を保存する（x64。OVERALL_RESULT は PASS。[design-decisions.md](./docs/design-decisions.md) 13.3）
- [x] custom URI scheme protocolを1つ登録し、オリジンとURL形式を実測する（`http://mdperuse-img.localhost/<path>`。[design-decisions.md](./docs/design-decisions.md) 5.4）
- [x] CSPとDOMPurifyの許可URIパターンを実測値で検証する（[design-decisions.md](./docs/design-decisions.md) 5.5。確定はPhase 3）
- [x] MSIX環境でフォルダー選択、読込、監視、関連付け起動を最小検証コードで確認する（[design-decisions.md](./docs/design-decisions.md) 13.4）
- [x] MSIX環境でアプリ設定ディレクトリの解決先を確認する（パッケージ領域へリダイレクトされ、アンインストールで併せて削除される。[design-decisions.md](./docs/design-decisions.md) 13.4）
- [x] 起動時間とアイドル時メモリを測定し、[spec.md](./docs/spec.md) の暫定目標を確定または改訂する（目標は据え置き。[design-decisions.md](./docs/design-decisions.md) 13.3）

### このフェーズで解決する未決事項

- [x] 各ツールの初期バージョン（winapp CLI 0.6.1 を含め確定。[design-decisions.md](./docs/design-decisions.md) 4.10）
- [x] ARM64のビルド方式（x64ホストからのクロスコンパイルに確定。[design-decisions.md](./docs/design-decisions.md) 13.2）
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
- [x] 依存ライセンス一覧の生成手段を確定し、未更新時にCIを失敗させる（`cargo-about` と `scripts/generate-licenses.ts`。[design-decisions.md](./docs/design-decisions.md) 11.3）

### このフェーズで解決する未決事項

- [x] `bun:test` でのDOMテスト成立可否とVitestへの退避条件（[design-decisions.md](./docs/design-decisions.md) 14.5）
- [x] ライセンス一覧の生成手段（[design-decisions.md](./docs/design-decisions.md) 11.3）

## Phase 3: 詳細設計

4単位へ分け、[dev-flow.md](./docs/dev-flow.md) 第5章「着手順」の順序で進める。単位ごとにPull Requestを分ける。型と定数は実コードとして置き、選択の理由は [design-decisions.md](./docs/design-decisions.md) へ記録する。

### 3-1 IPCインターフェース

- [x] Tauri commandとeventの型（`FileNode`、走査オプション、読込結果、ファイル変更イベント、テーマ変更イベント）をTypeScriptとRustの双方で定義する（Rust側を正本に `ts-rs` で生成。[design-decisions.md](./docs/design-decisions.md) 5.3）
- [x] IPCのversion、request ID、cancelの契約を定義する（いずれもwire契約へ導入しない。[design-decisions.md](./docs/design-decisions.md) 5.3）
- [x] TypeScriptとRustの型定義を同期させる手段を決め（手書きの二重定義か生成か）、wire契約の一致をCIで検証できるようにする（`ts-rs` で生成し、`Rust` ジョブが差分を検査する）
- [x] エラーの `code` 体系と `retryable` の判定基準を定義する（`IpcError` と `ErrorCode`。retryableはcodeから導出。[design-decisions.md](./docs/design-decisions.md) 5.3）
- [x] custom image protocolのresource ID生成、無効化、キャッシュ方針を定義する（ソルトと変更世代のHMAC、文書単位で発行、ワークスペース切替で無効化。[design-decisions.md](./docs/design-decisions.md) 5.4）
- [x] 非Markdownファイルをツリーへ表示するかを決め、走査オプションへ反映する（表示しない。[design-decisions.md](./docs/design-decisions.md) 6.3）

### 3-2 描画とナビゲーション

- [ ] `rehype-sanitize` schemaを最終定義し、既定schemaからの拡張差分を列挙する
- [ ] Raw HTMLをテキストとして出力するhandlerの実装方針を決める
- [ ] 見出しアンカーのID生成規則と、相対リンク（アンカー付き、ルート外リンクとloose tabを含む）の解決規則を定義する
- [ ] YAML front matterの扱いを決める
- [ ] Mermaid、コードブロック、KaTeX、画像の処理上限を定義する
- [ ] CSPとTauri capabilityの最終値を確定する

### 3-3 状態管理

- [ ] 永続化する状態を決め、設定ファイルのスキーマと `schemaVersion` を定義する
- [ ] ファイル監視の開始、停止、ワークスペース切り替え時のライフサイクルを定義する
- [ ] 削除、rename、atomic replace後のタブ状態と、置換時の再読込例外の可否を定義する
- [ ] 同時に開けるタブ数の上限、最近使ったフォルダーと最後のワークスペースの復元、関連付け起動でワークスペース外のファイルを開いたときの状態を決める

### 3-4 UIとUX

- [ ] メニューをネイティブ実装とするかWebView内実装とするかを決め、メニュー、ショートカット、パンくずの操作仕様を定義する
- [ ] スプリッターの幅範囲、刻み、設定保存と、文字サイズの範囲、刻み、ショートカットを定義する
- [ ] 文書内検索とリンク遷移の戻る／進む操作の採否を決める
- [ ] 単一ファイルまたは単一フォルダーのドラッグ＆ドロップの扱いと、英語UIの採否を決める

### 完了条件

- [ ] IPCの入力、出力、失敗条件がTypeScriptとRustの両方で定義されている
- [ ] IPCのversion、request ID、cancelの契約が定義されている
- [ ] TypeScriptとRustのwire契約が一致していることをCIで検証できる
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
- [ ] 走査応答の世代管理（ワークスペース世代とパス世代）を実装し、同一パスの再走査・別パスの同時走査・ワークスペース切替の競合をテストで固定する（[design-decisions.md](./docs/design-decisions.md) 5.3）

### 完了条件

- [ ] [spec.md](./docs/spec.md) の機能要件をテストで確認できる
- [ ] atomic replaceによる連続更新でプレビューが壊れない
- [ ] キーボードだけで主要操作を完了できる
- [ ] 不正なMarkdownやMermaid入力でアプリが停止しない
- [ ] セキュリティ回帰テストが通る
- [ ] 陳腐化した走査応答が新しいツリーを上書きせず、別パスの同時走査が相互に無効化されない
- [ ] `forced-colors` 有効時にMermaid図とコードブロックが判読できる
- [ ] [spec.md](./docs/spec.md) の性能目標を満たす

## Phase 5: 配布パイプラインとStore公開

- [ ] MSIXのIdentity、Publisher、表示名、アイコンをPartner Centerの登録内容と一致させる
- [x] 比率2.067のワイドロゴを用意し、`Wide310x150Logo` と `Square310x310Logo` をマニフェストへ追加する（[design-decisions.md](./docs/design-decisions.md) 13.1）
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
- [ ] ARM64実機でのインストール、起動、WACKを確認している
- [ ] Store提出物とCIで検証した成果物が一致している
- [ ] プライバシーポリシーとデータ収集申告が提出内容と整合している
- [ ] Tauri Updaterや `.appinstaller` に依存せず、Store更新だけで更新できる

## 未決事項の一覧

未決事項の内容と解決フェーズの割り当ては [dev-flow.md](./docs/dev-flow.md) 第8章、判断の根拠は [design-decisions.md](./docs/design-decisions.md) 第15章を参照する。解決状況は各Phaseのチェックリストで追跡する。
