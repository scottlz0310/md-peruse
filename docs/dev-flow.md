# md-peruse 開発フロー

設計判断と未決事項は [design-decisions.md](./design-decisions.md) を正本とする。

## 1. 基本方針

- Tauri v2、React、TypeScript、Vite、Bunを基本スタックとする。
- 実装を本格化する前に、MSIX生成とMicrosoft Store適合性を技術スパイクで検証する。
- FrontendとRust間の境界を明示し、ファイルシステム操作をRust側へ集約する。
- 各フェーズの完了条件を満たしてから次へ進む。ただしPhase 1とPhase 2は「1.1 フェーズの着手順」に従い、一部を先行させる。
- Phase 1のスパイク成果物は使い捨てとし、そのまま製品コードへ持ち込まない。スパイクで確定した設定値と手順だけを[design-decisions.md](./design-decisions.md)へ反映する。

### 1.1 フェーズの着手順

実装順序の正本は本書とする。フェーズは第2章以降で番号順に定義するが、着手は次の順序で行う。

1. Phase 0のリポジトリ整備
2. Phase 1のうち最小アプリ（スケルトン）の作成
3. Phase 2のうちCI/CDと品質ガードレールの配置
4. Phase 1の残り（MSIX生成、署名、WACK、実測）
5. Phase 2の残り

スケルトンとCI/CDを先に立てることで、Phase 1のスパイクを含む以降の変更をPull Requestとレビューサイクルへ乗せられる状態を早期に確保する。各フェーズの完了条件は、この着手順を経てフェーズを閉じる時点で判定する。

進捗の追跡は[tasks.md](../tasks.md)で行う。本書は着手順と完了条件を、`tasks.md` は各タスクの状態をそれぞれ担当し、着手順を二重に定義しない。

## 2. Phase 0: リポジトリ整備

### 目的

以降のフェーズで参照する運用ドキュメントと規約を先に整える。

### 作業

- リポジトリを初期化し、既定ブランチと保護設定を決める。
- `README.md` を作成し、プロダクト概要とドキュメントの入口を示す。
- ライセンスを選定し、`LICENSE` を配置する。
- `CHANGELOG.md` を作成し、Keep a Changelog形式で運用する。
- `tasks.md` を作成し、フェーズごとのタスクと未決事項の解決状況を追跡する。
- Conventional Commitsを規約として明記する。
- `.gitignore`、`.editorconfig`、PRテンプレートを配置する。

### 完了条件

- [ ] ドキュメントの入口と更新責務が定義されている。
- [ ] ライセンスが確定している。
- [ ] CHANGELOGとtasks.mdの更新タイミングが規約として明文化されている。

## 3. Phase 1: MSIX技術スパイク

### 目的

Tauriアプリをx64とARM64でビルドし、MSIXとしてインストール、起動、検証できることを実装初期に確認する。

このフェーズの目的は製品機能の実装ではなく、MSIX環境で必要な権限と挙動が得られることの確認である。フォルダー選択、読込、監視、関連付け起動は、正式設計を待たない最小の検証コードで確認する。

### 作業

- Bun + Vite + React + TypeScript + Tauri v2の最小アプリを作成する。
- Tauriでx64とARM64のReleaseビルドを生成する。
- ARM64のビルド方式（ネイティブARM64ランナーかクロスコンパイルか）を確定する。
- `Package.appxmanifest` とパッケージ用アセットを作成する。
- packaged classic app、`mediumIL`、`runFullTrust` を設定し、`broadFileSystemAccess` を宣言しない。
- winapp CLIを固定バージョンで導入し、アーキテクチャ別MSIXを生成する。
- BunとWinGet版winapp CLIだけでビルドできるか確認し、Node.jsが必要ならビルド時依存として明記する。
- 開発用自己署名証明書でローカル検証用パッケージを署名する。
- Windows App Certification Kit（WACK）を実行する。
- custom URI scheme protocolを1つ登録し、WebView2上で実際に配信されるオリジンとURL形式を実測する。
- CSPとDOMPurifyの許可URIパターンを実測値に合わせて検証する。
- MSIX環境でアプリ設定ディレクトリの解決先と、実際の格納先を確認する。
- 起動時間とアイドル時メモリを測定し、[spec.md](./spec.md)の暫定目標を確定または改訂する。

### 完了条件

- [x] x64版MSIXをインストールして起動できる。
- [x] ARM64版MSIXがx64版と同一の手順で生成できる。WACKはパッケージをインストールして実行するためホストと同じアーキテクチャを要する。ARM64版のインストール、起動、WACKはPhase 5の提出前検証で行う（開発環境にARM64実機がないため）。
- [x] WACKの結果を保存し、Store提出を妨げる失敗がない。
- [x] Package Identity、Publisher、バージョンの管理方法が確定している。
- [x] Bun、winapp CLI、Node.jsの依存境界が確定している。
- [x] MSIX環境でフォルダー選択、読込、監視、ファイル関連付けが最小検証コードで動作する。
- [x] custom protocolのオリジンとURL形式が実測で確定している。
- [x] アプリ設定の保存先が確認されている。
- [x] 起動時間とメモリの目標値が実測に基づいて確定している。

## 4. Phase 2: 開発基盤と品質ガードレール

### 作業

- `bun:test` でReactコンポーネントのDOMテストが成立する構成を確立する。成立しない場合にVitestへ退避する条件を、このフェーズの時点で明文化する。
- Bunのバージョンを固定し、`bun.lock` をコミットする。
- CIでは `bun install --frozen-lockfile` を使用し、lockfileの変更を伴うインストールを失敗させる。
- BiomeでLintとFormattingを実行する。
- `tsc --noEmit` で型検査を実行する。
- LefthookでFrontendとRustの品質チェックをGit Hooksへ組み込む。
- Rustでは `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` を実行する。
- GitHub ActionsでPull Requestごとのテスト、ビルド、静的検査を実行する。
- Codecovでテストカバレッジを可視化する。RustとFrontendのカバレッジを分けて集計する。
- RenovateでJavaScript依存関係、Cargo依存関係、GitHub Actionsを更新する。共有プリセット `github>scottlz0310/renovate-config` を拡張し、リポジトリローカルの `renovate.json` は最小限にする。
- 共有プリセットにBun向けの調整が必要な場合は、リポジトリローカルではなくプリセット側へ反映する。
- Bun本体の更新は通常依存から分離し、MSIX生成とWACKが成功するまで自動マージしない。
- 依存ライセンス一覧の生成手段を確定し、生成物が最新でない場合にCIを失敗させる。

### 完了条件

- [x] `bun:test` でReactコンポーネントのテストがCIとローカルの両方で実行できる。または退避条件に従いVitestへ切り替えている。
- [x] ローカルとCIで同じ品質チェックを再現できる。
- [x] lockfileを変更しない依存関係インストールがCIで成功する。
- [x] Renovateの更新単位と自動マージ条件が定義されている。
- [x] Bun更新が通常のJavaScript依存更新と分離されている。
- [x] ライセンス一覧の生成がCIへ組み込まれている。

## 5. Phase 3: 詳細設計

### 着手順

Phase 3は次の4単位へ分け、この順序で着手する。単位ごとにPull Requestを分ける。

1. IPCインターフェース
2. 描画とナビゲーション
3. 状態管理
4. UIとUX

「描画とナビゲーション」を2番目に置くのは、CSPとcapabilityの最終値が `rehype-sanitize` schemaとcustom image protocolの設計に依存するためである。この2つを早く閉じることで、P0の未決事項が長く残らない。

### 成果物の形式

型と定数は実コードとして置き、選択の理由は [design-decisions.md](./design-decisions.md) へ記録する。IPCの型はTypeScriptとRustの双方に定義する。ただし `tsc --noEmit` と `cargo check` が検査するのは各言語内の整合性だけであり、両者のwire契約（フィールド名、必須性、version、エラー `code` の集合）が一致しているかは検出しない。クロス言語の一致をどう保証するか（Rust側の型からTypeScriptの型を生成する、または双方を突き合わせる契約テストを置く）は5.1で決定し、決めた手段をCIで実行できる状態にする。

Phase 3では型と定数のみを置き、振る舞いの実装はPhase 4で行う。

### 5.1 IPCインターフェース

RustとTypeScript間のTauri command / eventについて、次の型とエラー契約を定義する。

- `FileNode`
- フォルダー走査オプション
- ファイル読込結果
- ファイル変更イベント
- テーマ変更イベント
- custom image protocolのresource IDとエラー応答
- IPCのversion、request ID、cancelの契約
- エラーの `code` 体系と `retryable` の判定基準
- TypeScriptとRustの型定義を同期させる手段と、wire契約の一致をCIで検証する方法

### 5.2 描画とナビゲーション

- `rehype-sanitize` schemaの最終定義と、既定schemaからの拡張差分
- Raw HTMLをテキストとして出力するhandlerの実装方針
- 見出しアンカーのID生成規則
- 相対リンクの解決規則と、アンカー付き相対リンクの挙動
- ルート外Markdownリンクをloose tabで許可するか
- YAML front matterの扱い
- Mermaidとコードブロックの処理上限
- KaTeXのマクロ展開と出力サイズの上限
- 画像のピクセル寸法上限
- CSPとTauri capabilityの最終値

### 5.3 状態管理

次の状態について、メモリ上だけで保持するか、アプリ設定として永続化するかを決定し、設定ファイルのスキーマと `schemaVersion` を定義する。

- 選択中のファイルパス
- 開いているルートフォルダー
- 最近開いたフォルダー
- テーマ設定
- サイドバー幅とサイドバー表示状態
- 文字サイズ
- ウィンドウ位置とサイズ

あわせて次を確定する。

- ファイル監視の開始、停止、ワークスペース切り替え時のライフサイクル
- 削除、rename、atomic replace後のタブ状態と、置換時の再読込例外の可否
- 同時に開けるタブ数の上限
- 関連付け起動でワークスペース外のファイルを開いたときの状態

### 5.4 UIとUX

- メニューをネイティブ実装とするかWebView内実装とするか
- メニュー、ショートカット、パンくずの操作仕様
- スプリッターの幅範囲、刻み、設定保存
- 文字サイズの範囲、刻み、ショートカット
- 文書内検索の採否
- リンク遷移の戻る／進む操作の採否
- 単一ファイルまたは単一フォルダーのドラッグ＆ドロップ
- 英語UIを初期版へ含めるか

### 完了条件

- [ ] IPCの入力、出力、失敗条件がTypeScriptとRustの両方で定義されている。
- [ ] IPCのversion、request ID、cancelの契約が定義されている。
- [ ] TypeScriptとRustのwire契約が一致していることをCIで検証できる。
- [ ] エラーコード体系が定義され、Frontendが文字列比較なしで分岐できる。
- [ ] 永続化する状態と保存先、スキーマが確定している。
- [ ] ファイル監視の開始、停止、ワークスペース切り替え時のライフサイクルが確定している。
- [ ] sanitize schemaの拡張差分が列挙され、暗黙の許可が存在しない。
- [ ] CSPとcapabilityの最終値が確定している。
- [ ] P1の未決事項のうち、実装前に確定が必要なものが解消している。

## 6. Phase 4: 機能実装

### 6.1 Rust Core

- ディレクトリ走査とノイズ除外
- Markdownファイルの読込
- ファイル変更監視とdebounce
- ローカル画像のパス検証と非同期custom protocol
- ファイル共有、文字コード、10 MiB上限
- Windows固有のパス比較（大文字小文字、Unicode正規化、コンポーネント境界）

### 6.2 Frontend Markdown

- unifiedによるGFMの構文解析とReact要素への変換
- Raw HTMLのテキスト出力とsanitize schemaの適用
- Mermaidの非同期レンダリングとDOMPurifyによるSVG sanitize
- lowlightによるコードブロックのシンタックスハイライトと言語の遅延登録
- KaTeXによる数式表示（遅延ロード）
- 採用が決定した場合のみfront matter表示、文書内検索、履歴操作
- Markdown、Mermaid、数式、画像、リンクの安全な描画

### 6.3 UI/UX

- Titlebar
- Breadcrumb
- SidebarとTreeView
- Resizer
- PreviewArea
- キーボード操作
- OS連動と手動切り替えに対応したテーマ
- ハイコントラストとReduced Motion
- 国際化のための文字列分離
- ライセンス表記の表示

### 完了条件

- [ ] [spec.md](./spec.md) の機能要件をテストで確認できる。
- [ ] ファイル更新がプレビューへ反映される。
- [ ] atomic replaceによる連続更新でプレビューが壊れない。
- [ ] 陳腐化した走査応答が新しいツリーを上書きしない（同一パスの再走査とワークスペース切替）。
- [ ] キーボードだけで主要操作を完了できる。
- [ ] 不正なMarkdownやMermaid入力でアプリが停止しない。
- [ ] Raw HTML、危険なURL scheme、境界外画像が遮断され、セキュリティ回帰テストが通る。
- [ ] `forced-colors` 有効時にMermaid図とコードブロックが判読できる。
- [ ] [spec.md](./spec.md) の性能目標を満たす。

## 7. Phase 5: 配布パイプラインとStore公開

### 作業

- MSIXのIdentity、Publisher、表示名、アイコンをPartner Centerの登録内容と一致させる。
- バージョン番号を各マニフェストと設定ファイルで同期し、不一致をCIで検出する。
- GitHub Actionsでx64版とARM64版をビルドする。
- winapp CLIでMSIXを生成する。
- WACK結果とMSIXをリリースartifactとして保存する。
- ARM64実機でMSIXをインストールして起動し、WACKを実行することを提出前に確認する（Phase 1では開発環境にARM64実機がないため生成までを実施した）。
- プライバシーポリシーとデータ収集申告を準備する。
- Store掲載情報（説明、スクリーンショット、年齢区分、掲載言語）を準備する。
- Microsoft Partner Centerで初回登録と審査申請を行う。
- 更新版向けにMicrosoft Store Submission API連携を構築する。利用するAPIのバージョンと認証方式、MSIXパッケージフローへの対応状況を着手時点で確認する。
- Store Submission APIの実行前に手動承認ゲートを設ける。
- API連携が利用できない場合に備え、手動提出の手順書を維持する。

### 完了条件

- [ ] x64版とARM64版のMSIXが同一バージョンで生成される。
- [ ] 対象MSIXについてWACKが完了している。
- [ ] Store提出物とCIで検証した成果物が一致している。
- [ ] プライバシーポリシーとデータ収集申告が提出内容と整合している。
- [ ] Tauri Updaterや `.appinstaller` に依存せず、Store更新だけで更新できる。

## 8. 未決事項と解決フェーズの対応

技術スタックの選定は [design-decisions.md](./design-decisions.md) の第4章で確定済みであり、本表では扱わない。それ以外の未決事項を、解決するフェーズへ割り当てる。フェーズ完了時に未解決の項目が残っていないことを確認する。

| 未決事項 | 解決フェーズ |
| --- | --- |
| 各ツールの初期バージョン | Phase 1 |
| ARM64のビルド方式 | Phase 1 |
| `bun:test` でのDOMテスト成立可否とVitestへの退避条件 | Phase 2 |
| custom image protocolのURL形式 | Phase 1 |
| custom image protocolのresource ID生成、無効化、キャッシュ方針 | Phase 3-1（IPC） |
| CSPの最終値とcapabilityの最小集合 | Phase 1で検証、Phase 3-2（描画・ナビ）で確定 |
| MSIXでのフォルダー選択、監視、関連付け起動 | Phase 1 |
| MSIXでのアプリ設定保存先 | Phase 1 |
| BunのみでのMSIXビルド可否 | Phase 1 |
| ライセンス一覧の生成手段 | Phase 2 |
| IPCの型、version、request ID、cancel、error契約 | Phase 3-1（IPC） |
| `rehype-sanitize` schemaの最終定義 | Phase 3-2（描画・ナビ） |
| Raw HTMLをテキスト出力するhandlerの実装方針 | Phase 3-2（描画・ナビ） |
| 削除、rename、atomic replace後のタブ状態 | Phase 3-3（状態管理） |
| 見出しアンカーと相対リンクの規則 | Phase 3-2（描画・ナビ） |
| YAML front matterの扱い | Phase 3-2（描画・ナビ） |
| 文書内検索と履歴操作の採否 | Phase 3-4（UI・UX） |
| Mermaidとコードブロックの処理上限 | Phase 3-2（描画・ナビ） |
| KaTeXのマクロ展開と出力サイズの上限 | Phase 3-2（描画・ナビ） |
| 画像のピクセル寸法上限 | Phase 3-2（描画・ナビ） |
| 非Markdownファイルのツリー表示 | Phase 3-1（IPC） |
| タブ数の上限 | Phase 3-3（状態管理） |
| メニューの実装方式 | Phase 3-4（UI・UX） |
| スプリッターと文字サイズの操作仕様 | Phase 3-4（UI・UX） |
| ルート外Markdownリンクとloose tab | Phase 3-2（描画・ナビ） |
| 関連付け起動でのワークスペース外ファイル | Phase 3-3（状態管理） |
| 最近使ったフォルダーと最後のワークスペース復元 | Phase 3-3（状態管理） |
| ドラッグ＆ドロップ | Phase 3-4（UI・UX） |
| 英語UIの採否 | Phase 3-4（UI・UX） |
| lowlightへ登録する言語allowlist | Phase 4 |
| 長いパスへの対応方針 | Phase 4 |
| 大規模ツリーでの監視範囲の縮退モード | Phase 4 |
