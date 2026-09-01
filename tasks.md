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
- [ ] 同時に開けるタブ数の上限と、複数ファイル引数の扱いを決める（関連付け起動でワークスペース外のファイルを開いたときの状態は3-2で確定。[design-decisions.md](./docs/design-decisions.md) 9.1、9.2）

### 3-4 UIとUX

- [ ] メニューをネイティブ実装とするかWebView内実装とするかを決め、メニュー、ショートカット、パンくずの操作仕様を定義する
- [ ] スプリッターの幅範囲、刻み、設定保存と、文字サイズの範囲、刻み、ショートカットを定義する
- [ ] 文書内検索とリンク遷移の戻る／進む操作の採否を決める
- [ ] 単一ファイルまたは単一フォルダーのドラッグ＆ドロップの扱いと、英語UIの採否を決める

### 3-5 Store向けテレメトリ（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）

Microsoft Store版の初回リリースから送るカスタムイベントを要件化する。段階1は3-2の「CSPとTauri capabilityの最終値を確定する」より前に実施する。送信経路がWebViewからのHTTPS通信になる場合、`connect-src` とcapabilityの最終値へ影響するためである。

- [x] 段階1: Tauri + MSIX packaged classic appから利用できるMicrosoft公式のイベント送信経路を実測し、成立可否・制約・CSPとcapabilityへの影響を [design-decisions.md](./docs/design-decisions.md) へ記録する（`StoreServicesCustomEventLogger` を呼べる。Engagement と VCLibs の `PackageDependency` が必要。CSPとcapabilityへは影響しない。[design-decisions.md](./docs/design-decisions.md) 13.5）
- [ ] 段階2: イベント名、発火条件、データ最小化、送信失敗時の挙動、Store版限定条件を定義し、[spec.md](./docs/spec.md) のテレメトリ方針とIssueテンプレートの「テレメトリはスコープ外」の記述を更新する。送信単位はシングルインスタンス＋タブ起動を前提としてセッション単位へ統一する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) の決定事項）

### 完了条件

- [ ] IPCの入力、出力、失敗条件がTypeScriptとRustの両方で定義されている
- [ ] IPCのversion、request ID、cancelの契約が定義されている
- [ ] TypeScriptとRustのwire契約が一致していることをCIで検証できる
- [ ] エラーコード体系が定義され、Frontendが文字列比較なしで分岐できる
- [x] 永続化する状態と保存先、スキーマが確定している
- [x] ファイル監視のライフサイクルが確定している
- [x] sanitize schemaの許可範囲が全列挙され、暗黙の許可が存在しない
- [x] CSPとcapabilityの最終値が確定している
- [ ] P1の未決事項のうち、実装前に確定が必要なものが解消している
- [ ] Store向けカスタムイベントの送信経路と要件が確定している

## Phase 4: 機能実装

- [ ] Rust Core（走査、読込、監視、パス検証、custom protocol）
- [ ] Frontend Markdown（unified、sanitize、Mermaid、lowlight、KaTeX）
- [ ] UI/UX（Titlebar、Breadcrumb、Sidebar、Resizer、PreviewArea、テーマ、キーボード操作）
- [ ] 走査応答の世代管理（ワークスペース世代とパス世代）を実装し、同一パスの再走査・別パスの同時走査・ワークスペース切替の競合をテストで固定する（[design-decisions.md](./docs/design-decisions.md) 5.3）
- [ ] 監視スコープ（`scopeId`）の採番と破棄を実装し、暗黙のルートが異なる同名のloose tabへイベントが混入しないこと、ワークスペース切替の直前に送出された旧Watcherのイベントが新しいルートへ適用されないことをテストで固定する（[design-decisions.md](./docs/design-decisions.md) 6.4）
- [ ] 文書読込の世代を実装し、置換直後の再読込（[design-decisions.md](./docs/design-decisions.md) 6.5）で先に開始した読込が後から完了しても、新しい内容を古い内容で上書きしないことを、完了順を反転させた回帰テストで固定する。読込の開始から完了までの間に変更イベントが届く順序（A開始 → B変更 → A完了 → B読込開始）と、タブを閉じて同じパスで開き直した後に旧タブの応答が届く順序も併せて固定する
- [ ] `notify` のイベントを `watch::RawEvent` へ写像する処理とdebounce窓の時間管理を実装し、実ファイルに対するatomic replaceで開いているタブが `deleted` にならず再読込されることを、MSIX環境の実測列と突き合わせて確認する（[design-decisions.md](./docs/design-decisions.md) 6.4、6.5）
- [ ] 画像resource IDの世代管理を実装し、同一サイズ・更新時刻据え置きの書換えと、監視のバッファあふれ後の再描画でIDが更新されることをテストで固定する（[design-decisions.md](./docs/design-decisions.md) 5.4）
- [ ] Store向けカスタムイベント（`session_start`、`open_md_ok`、`open_md_fail`、`open_folder`、`launch_by_association`）の発火点を各機能の実装と同時に組み込む。キャンセルや失敗で成功イベントを送らないこと、送信失敗がファイル・フォルダー操作を失敗させないこと、開発版で本番イベントを送らないことをテストで固定する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階3）
- [ ] 「起動中に2つ目の `.md` を関連付けから開く」経路をE2E回帰項目として固定する。既存ウィンドウへのタブ追加では `session_start` と `launch_by_association` を送らず、`open_md_ok` もセッション内の最初の描画完了時だけであることを、コールドスタート経路と分けて検証する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階3）

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
- [ ] GitHub Actionsでx64版とARM64版をビルドし、MSIXとWACK結果をartifactとして保存する
- [ ] プライバシーポリシーとデータ収集申告を準備する
- [ ] Store向けカスタムイベントのデータ収集申告とプライバシーポリシーを、送信するイベントの内容に合わせて更新する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）
- [ ] 初回Store公開版でPartner Centerからカスタムイベントとパッケージバージョン別の集計を確認し、標準Sessions指標との照合方法を確定する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）
- [ ] 使用状況とカスタムイベントの計測母集団（診断データをオプトインした端末に限られること）を実データで確認し、率は読めてもインストール数へ接続できない制約を、反映遅延と並べて計測定義へ明記する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）
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

## 検討待ち

作業中に見つかった、そのPull Requestのスコープ外の事項を積む。「未決事項の一覧」が設計判断としてフェーズへ割り当て済みのものを指すのに対し、本節は割り当て先がまだ決まっていないものを保持する。

判断してフェーズが決まったら該当フェーズのタスクへ移し、本節からは削除する。「対応しない」と決めた場合も、結論を [design-decisions.md](./docs/design-decisions.md) へ残してから削除する。各項目には、見つけた文脈と判断が必要な点を書く。

- [ ] JavaScript依存のライセンス種別にallowlistがない。Rust側は `about.toml` の `accepted` が未列挙のライセンスを検出するが、JavaScript側は条文を取得できれば通るため、GPLなど再配布条件の異なる依存が入っても気づけない。生成物のコミットをやめた（[design-decisions.md](./docs/design-decisions.md) 11.3）ことで、Pull Requestの差分から気づく経路もなくなった。`scripts/generate-licenses.ts` へ許容ライセンスの列挙を足すかを決める
- [ ] 脚注セクションの見出し `<h2 class="sr-only">Footnotes</h2>` から `class` が落ちる。`src/markdown/sanitize-schema.ts` の `attributes.h2` が `["id"]` のみのため、スクリーンリーダー向けの隠し見出しが画面上に現れる。schemaへ `className` を許可するか、脚注セクションの見出しをCSSで制御するかを決める（Phase 3-2の見出しアンカー実装時に発見。sanitize schemaは全列挙の方針であり、`className` を許可する場合は値のパターンまで固定する必要がある）

## 未決事項の一覧

未決事項の内容と解決フェーズの割り当ては [dev-flow.md](./docs/dev-flow.md) 第8章、判断の根拠は [design-decisions.md](./docs/design-decisions.md) 第15章を参照する。解決状況は各Phaseのチェックリストで追跡する。
