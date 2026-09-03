# md-peruse 設計判断

## 1. 文書の位置付け

| 項目 | 内容 |
| --- | --- |
| 状態 | 設計段階 |
| 基準日 | 2026-08-29 |
| 役割 | 要件を実装へ落とすための設計判断、境界条件、未決事項の正本 |
| 上位文書 | [spec.md](./spec.md) |
| 実装順序 | [dev-flow.md](./dev-flow.md) |
| UI参考資料 | [uimock.html](./uimock.html) |

退避済みの旧設計合意文書から、プロダクト要件、セキュリティ境界、ファイル処理、UI、アクセシビリティに関する判断を継承する。旧文書のWinUI 3、.NET、Windows App SDK固有の設計は継承せず、本書のTauri v2 + MSIX構成を優先する。

`uimock.html` は画面構成の参考資料であり、要件または実装コードの正本ではない。モックが埋め込むサンプルMarkdown本文は旧構成（`marked.js` / `pulldown-cmark`）を記述しており、現行の設計判断と一致しない。モックのCDN読込とHTML実装のメニューバーも製品構成ではない。

本書で「暫定」と記した値は、Phase 1のスパイクまたはPhase 3の詳細設計で確定する。「未決」と記した項目は第15章で優先度とともに管理する。技術スタックの選定理由と却下理由は第4章に記録する。

## 2. プロダクト境界

### 2.1 初期版で提供するもの

- 単一ワークスペース内のMarkdown探索
- GFM、Mermaid、コードハイライト、数式を含む安全なプレビュー
- 複数文書を切り替えるタブ
- ファイル変更の自動検知と再描画
- Windowsのテーマとアクセシビリティ設定への追従
- Microsoft StoreからのMSIX配布と更新

### 2.2 初期版で提供しないもの

- Markdownの編集と保存
- 任意Webページを表示するHTMLブラウザー機能
- Markdown内のRaw HTMLまたはJavaScriptの実行
- PlantUML、Graphviz、Pandocなどの外部プロセス実行
- PDF、スライド、印刷、エクスポート
- 全ドライブを横断するExplorer
- 複数ウィンドウと分割ペイン
- タブセッションの完全復元
- アプリ独自Updaterと `.appinstaller`
- クラッシュレポートの外部送信と、アプリ独自のエンドポイントへの通信
- 上記を除く使用状況テレメトリ。Microsoft Store版では、イベント名だけを送る5種類のカスタムイベントに限って例外とする（11.4）

Read-onlyはユーザーのMarkdownと関連リソースを書き換えないことを意味する。テーマなどのアプリ設定は、アプリ専用データ領域へ保存できる。

## 3. プラットフォームとRuntime

| 項目 | 決定 |
| --- | --- |
| OS | Windows 11 |
| 最小OSビルド | 22000 |
| CPU | x64、ARM64 |
| WebView | Evergreen WebView2 Runtime |
| 非対応 | x86、Windows 10、EOL済みWindows |

- Fixed Version WebView2 Runtimeは同梱しない。
- WebView2の初期化に失敗した場合、原因と公式修復先をネイティブ側から表示する。
- アプリ自身がWebView2 Runtimeをダウンロードまたはインストールしない。
- Tauri/Rustを採用するため、.NET Desktop RuntimeとWindows App SDK Framework Packageには依存しない。

## 4. 技術選定

各軸について候補を比較して決定した。将来の再検討時に前提へ立ち返れるよう、選定理由だけでなく却下理由と引き受けるリスクを残す。

### 4.1 決定一覧

| 軸 | 決定 | 主な代替候補 |
| --- | --- | --- |
| デスクトップシェル | Tauri v2（Rust + WebView2） | WinUI 3 + WebView2、Electron、Wails v3 |
| Frontendフレームワーク | React + Vite | Svelte 5、SolidJS、素のTypeScript |
| JSツールチェーン | Bun | pnpm、npm |
| パッケージングと配布 | MSIX + Microsoft Store（winapp CLI） | makeappxの自前スクリプト化、MSIXとMSIの併用、MSI/NSIS + 自前Updater |
| Markdown解析とsanitize | unified（remark + rehype） | markdown-it + DOMPurify、Rust側 comrak + ammonia |
| シンタックスハイライト | highlight.js/core（lowlight経由） | Shiki、Rust側 syntect |
| Frontend test runner | `bun:test` | Vitest |
| 数式 | KaTeX（遅延ロード） | 非対応、MathJax |

### 4.2 デスクトップシェル: Tauri v2

- 選定理由: 配布サイズと常駐メモリが最小で、軽量・低負荷というコアバリューへ直結する。capabilityによる細粒度の権限制御が、Read-only境界とワークスペース境界の設計と噛み合う。.NET Desktop RuntimeとWindows App SDKに依存しない。
- 却下理由: WinUI 3は起動とサイズが重く、Mermaidのため結局WebView2を抱える二重構成になる。ElectronはChromium同梱でコアバリューと正面衝突する。Wails v3はWindowsパッケージングとStore配布の事例が不足している。
- 引き受けるリスク: Rustの実装コスト。MSIX生成がTauri CLIの標準機能ではない。
- 緩和策: ファイル操作を限定されたTauri commandへ集約し、Rust側の実装面積を絞る。MSIX生成を独立工程として扱い、Phase 1で先に検証する。

### 4.3 Frontendフレームワーク: React + Vite

- 選定理由: unified、Mermaid、DOMPurifyとの連携実例が最も多く、保守情報の入手性が高い。`rehype-react` によるReact要素への直接変換という選択肢を取れる。UI規模（ツリー、タブ、プレビューの3領域）に対し、ランタイム分の負荷は許容範囲と判断する。
- 却下理由: Svelte 5とSolidJSはバンドルサイズで優位だが、エコシステムと参考情報が薄い。素のTypeScriptはツリーとタブの差分描画を自前保守することになり、保守コストが後で効く。
- 引き受けるリスク: Reactランタイム分のバンドルとメモリ。
- 緩和策: 状態管理ライブラリを持ち込まず、アクティブタブだけ本文DOMを保持する方針で総量を抑える。[spec.md](./spec.md)のメモリ目標で検証する。

### 4.4 JSツールチェーン: Bun

- 選定理由: install、test、runを単一ツールで完結でき、ローカルとCIの工程が短い。
- 却下理由: pnpmはユーザー標準で整合コストが低いが、test runnerを別途要する。npmは速度面で劣る。
- 引き受けるリスク: ユーザー標準（pnpm）からの逸脱。共有Renovateプリセットがpnpm前提のルールを含む場合の不整合。Windows ARM64サポートの確認が必要。
- 緩和策: Bun向けの調整を共有Renovateプリセット側へ集約し、リポジトリローカルの `renovate.json` を最小限に保つ。Bun本体の更新を通常のJavaScript依存更新から分離する（下記）。Phase 1でARM64上の動作を確認する。

Bunのバージョンは `.bun-version` で固定する。Renovateの `bun-version` マネージャが対象とするのは `.bun-version` であり、`package.json` の `packageManager` はBunの更新元にならない（CorepackがBunを扱わないため、共有プリセット `presets/languages/nodejs` も同じ理由で `.bun-version` の使用を求めている）。CIの `setup-bun` も `bun-version-file: .bun-version` で同じ値を読む。

そのうえで、リポジトリローカルの `renovate.json` で `bun-version` を `Bun runtime` グループへ切り出し、`automerge` を無効化する。共有プリセットにも同名のグループ定義があるが、`presets/options/schedule` のグループ化が後勝ちするため、ローカルで再指定しないとBun本体が他の依存と同じ更新Pull Requestへ混ざる（`renovate --platform=local --dry-run` で確認した）。理由は、Bunの更新が `bun install`、テスト、ビルド、MSIX生成のすべてに影響する一方、required status check（`Frontend` / `Rust` / `Coverage`）にはMSIX生成とWACKが含まれず、自動マージのゲートでは破壊を検出できないためである。この打ち消しはmd-peruse固有の事情（MSIXの同梱）に基づくため共有プリセットへは入れず、MSIX生成とWACKをCIへ載せた時点（Phase 5）で削除を判断する。

### 4.5 パッケージングと配布: MSIX + Microsoft Store（winapp CLI）

- 選定理由: 署名と更新をStoreへ一本化でき、自前Updaterとコード署名証明書の調達を持たない。Tauri向けの公式ガイドが存在する。
- 却下理由: makeappxの自前スクリプト化はPreviewツール依存を避けられるが、パッケージング一式を自前保守することになる。MSI/NSIS + 自前Updaterは証明書コスト、更新機構の保守、SmartScreen警告を抱える。MSIXとMSIの併用は検証系統が二重化する。
- 引き受けるリスク: winapp CLIがPublic Previewであり、破壊的変更がありうる。
- 緩和策: CIで使用バージョンを固定する。`Package.appxmanifest` とパッケージ用アセットをツールから独立して管理し、makeappxへ切り替え可能な状態を保つ。Phase 1で切替コストを評価する。

### 4.6 Markdown解析とsanitize: unified（remark + rehype）

- 選定理由: sanitizeをhastの段階で行い、`rehype-react` でReact要素へ直接変換できるため、本文描画から `dangerouslySetInnerHTML` を排除できる。HTML文字列を経由しないため、sanitizeを迂回する余地が構造的に小さい。`remark-gfm` と `remark-math` でGFMと数式の入口が揃う。
- 却下理由: markdown-it + DOMPurifyはパースが速く実績も厚いが、HTML文字列と `dangerouslySetInnerHTML` を前提とする。Rust側 comrak + ammoniaはWebView負荷を下げられるが、ハイライトとMermaidがJS側に残って責務が分散し、sanitizeのallowlistも自前設計することになる。
- 引き受けるリスク: 依存パッケージ数とバンドルの増加。markdown-itより遅いパース。Mermaid生成SVGには別途DOMPurifyが必要で、sanitizeの道具が二本立てになる。
- 緩和策: Markdown 10 MiB上限とバンドルサイズの計測で負荷を管理する。DOMPurifyの利用箇所をMermaid生成SVGだけに限定し、そこを `dangerouslySetInnerHTML` の唯一の例外として明示する。

### 4.7 シンタックスハイライト: highlight.js/core

- 選定理由: 言語単位で遅延ロードでき、初期バンドルを小さく保てる。着色をCSSテーマとして持つため、テーマ切替と `forced-colors` 時の代替表現へ対応しやすい。`lowlight` を介してhastを得られるため、unifiedおよびReact要素への変換方針と一貫する。
- 却下理由: Shikiは発色が正確だが、文法データが重く、インラインstyle出力がテーマ切替、`forced-colors`、CSPの各方針と衝突する。syntectはJS依存を消せるが、テーマ切替のたびに再生成が必要で、インラインstyleの課題は残る。
- 引き受けるリスク: 文法精度がTextMate系に劣る。
- 緩和策: 言語の自動判定を行わず、allowlistで明示された言語だけを対象とする。未対応言語はプレーン表示とする。

### 4.8 Frontend test runner: `bun:test`

- 選定理由: Bun採用と一貫し、追加依存がない。実行が速い。
- 却下理由: VitestはVite設定を共有でき、React Testing Libraryとjsdomの資産が厚いが、Bunで完結する利点を失う。
- 引き受けるリスク: Viteの変換パイプラインを共有しないため、`import.meta.env` やCSS取り込みで挙動差が出る。Reactコンポーネントに対するDOMテスト環境を自前で整える必要がある。
- 緩和策: Phase 2でDOMテスト環境とReact Testing Libraryの組合せを確立した。構成とVitestへの退避条件は14.5に記載する。

### 4.9 数式: KaTeX（遅延ロード）

- 選定理由: 描画が同期的で高速。`remark-math` と `rehype-katex` でunifiedパイプラインへ自然に組み込める。数式を含む文書を開いたときだけロードすれば、アイドル時のコストはゼロになる。
- 却下理由: 非対応はスコープが最小だが、数式を含む設計書で表示が崩れる。MathJaxはカバレッジが最大だが明確に重く、軽量というコアバリューと衝突する。
- 引き受けるリスク: 対応構文がLaTeXの部分集合にとどまる。マクロ展開による処理時間の増大。MathML出力とした場合、描画品質がWebView2のMathML Core実装に依存する。
- 緩和策: 出力を `mathml` に限定する（8.5）。`trust` を無効にして `\href` などを禁止する。マクロ展開と出力サイズに上限を設ける。sanitize schemaをKaTeX出力に合わせて定義する。

### 4.10 初期バージョン

Phase 1のスケルトン配置時点で固定したバージョンを記録する。以降の更新はRenovateが担う。

| 対象 | バージョン | 固定箇所 |
| --- | --- | --- |
| Rust toolchain | 1.98.0 | `rust-toolchain.toml` |
| Rust edition | 2024 | `src-tauri/Cargo.toml` |
| Rust MSRV | 1.85 | `src-tauri/Cargo.toml` の `rust-version` |
| Bun | 1.4.0 | `.bun-version` |
| tauri | 2.11.5 | `src-tauri/Cargo.toml` |
| tauri-build | 2.6.3 | `src-tauri/Cargo.toml` |
| tauri-plugin-opener | 2.5.4 | `src-tauri/Cargo.toml` |
| serde / serde_json | 1.0.229 / 1.0.151 | `src-tauri/Cargo.toml` |
| @tauri-apps/cli | 2.11.4 | `package.json` |
| @tauri-apps/api | 2.11.1 | `package.json` |
| @tauri-apps/plugin-opener | 2.5.4 | `package.json` |
| React / React DOM | 19.2.8 | `package.json` |
| Vite | 8.2.2 | `package.json` |
| @vitejs/plugin-react | 6.1.1 | `package.json` |
| TypeScript | 7.0.2 | `package.json` |
| Biome | 2.5.11 | `package.json` |
| Lefthook | 2.1.12 | `package.json` |
| winapp CLI | 0.6.1 | `scripts/build-msix.ps1` の `$requiredWinappVersion`（WinGet `Microsoft.WinAppCli`） |

Rustのeditionは2024を採用する。新規プロジェクトであり、既存コードとの互換性制約がないため。MSRVは edition 2024 が要求する1.85とする。

### 4.11 CIの構成

| 判断 | 内容 | 理由 |
| --- | --- | --- |
| ジョブ分割 | `Frontend`、`Rust`、`Coverage`、`Licenses` の4ジョブ | 失敗箇所を切り分けやすく、required status checkとして個別に指定できる |
| Frontendのランナー | `ubuntu-latest` | Biome、`tsc`、Viteのビルドはプラットフォームに依存せず、Windowsランナーより高速で安価 |
| Rustのランナー | `windows-latest` | 対象プラットフォームがWindowsのみであり、Tauriのビルドが実際に成立することを検証する必要がある |
| Rustツールチェーンの導入 | rustupによる `rust-toolchain.toml` の自動解決 | Actionでチャネルを別途指定すると、`rust-toolchain.toml` の固定と二重管理になる |
| Frontendビルドの先行実行 | Rustジョブでも `bun run build` を実行する | `tauri::generate_context!` が `frontendDist`（`dist/`）を埋め込むため、存在しないとコンパイルできない |
| 依存関係の導入 | `bun install --frozen-lockfile` | `bun.lock` との不整合を検出し、CIとローカルの依存を一致させる |
| テストの扱い | Frontendは `bun test`、Rustは `cargo llvm-cov` を実行する | 両者をPull Requestごとに実行する。`cargo llvm-cov` はテスト実行とカバレッジ計測を兼ねるため `cargo test` を置き換える（4.8、14.5） |
| カバレッジのアップロード | `codecov/codecov-action` をOIDC（`use_oidc`）で認証し、flagsを `frontend` と `rust` に分ける | 長期のupload tokenをリポジトリのsecretへ置かずに済む。flagsを分けることで、片方のカバレッジ変動がもう一方の判定へ混ざらない |
| Rustカバレッジのアップロード経路 | Rustジョブはlcovをartifactへ保存し、`Coverage` ジョブ（`ubuntu-latest`）がダウンロードしてアップロードする | Codecov CLIは設定ファイルをシステムのANSIコードページで読むため、Windows上では非ASCIIを含む `codecov.yml` でデコードに失敗する。`PYTHONUTF8` はPyInstaller製バイナリでは効かず、`chcp` が変えるのはコンソールのコードページで `GetACP()` には影響しない。CLIをWindowsで実行しない構成にすることで、設定ファイルの文字種に制約を持ち込まずに済む |
| Codecovのステータス | `informational` | Rustのテストは Phase 4 のコア実装と併せて追加するため、それまでの低いカバレッジでPull Requestをブロックさせない |
| Rustビルドキャッシュ | `Swatinem/rust-cache` を `save-if: main` で使用 | GitHub Actionsのキャッシュはブランチスコープで、PRブランチが保存したものは他ブランチから復元できない。`main` でのみ保存し、全PRがそれを復元する |

`main` へのpushでも実行する。squash mergeの結果に対して検査を通し、`main` が常に検査済みの状態であることを保証する。

### 4.12 ブランチ保護と自動マージ

`main` に以下の保護を設定する。

| 設定 | 値 | 理由 |
| --- | --- | --- |
| required status check | `Frontend`、`Rust`、`Coverage`、`Licenses` | CIを通過していない変更を `main` へ入れない。カバレッジのアップロード失敗と、ライセンス条文を取得できない依存の混入も検出する |
| `strict`（マージ前に最新化を要求） | 無効 | Renovateが複数のPull Requestを同時に開くため、有効にすると相互に古くなり続けてマージが進まない。CIは `main` へのpushでも実行するため、結合後の検証は担保される |
| 必須の承認レビュー | 設定しない | GitHubでは自分のPull Requestを自分でapproveできず、thread-owlはformal reviewではなくVerdictコメントでレビュー結果を返すため、要求すると恒久的にマージ不能になる。レビューの担保は運用規約（thread-owlのVerdictコメントとreviewed-side cycle）で行う。適用範囲は下記「レビューの適用範囲」を参照する |
| 会話の解決を必須 | 有効 | 未解決のレビュースレッドを残したままマージできないようにする |
| 直線的な履歴を必須 | 有効 | マージ方式をsquashのみに限定している方針と整合させる |
| force pushとブランチ削除 | 禁止 | 履歴の破壊を防ぐ |
| 管理者への適用 | 有効 | 単独開発であっても `main` への直接pushを禁止し、すべての変更をPull Request経由にする |

マージ方式はsquashのみ許可する。merge commitとrebase mergeはリポジトリ設定で無効化する。

required status checkが揃ったため、Renovateの `presets/options/automerge` を `extends` へ戻し、`renovate.json` に置いていたautomergeの打ち消し（`vulnerabilityAlerts.automerge` と `packageRules`）を削除する。presetは `platformAutomerge` と `automergeStrategy: squash` を使うため、リポジトリの「Allow auto-merge」を有効にする。

#### レビューの適用範囲

ブランチ保護が強制するのは `Frontend` / `Rust` / `Coverage` / `Licenses` の通過と会話の解決のみで、thread-owlのVerdictは required status check ではない。したがってRenovateの更新Pull Requestは、Verdictを待たずにCI通過だけで自動マージされる。これは意図した動作であり、レビューの必須範囲を次のとおり分ける。

| 対象 | ゲート |
| --- | --- |
| 人が作成する変更（機能、修正、設計文書、CI設定） | CI通過に加えて、thread-owlのレビューとVerdictコメント（`READY_TO_MERGE`）を必須とする。マージは明示的な指示を受けてから行う |
| Renovateによる定型依存更新 | CI通過をもってゲートとし、独立レビューは求めない |
| Renovateによる Bun本体（`bun-version`）の更新 | 自動マージせず、MSIX生成とWACKの確認を経て手動でマージする（4.4） |

Renovateの更新を対象外とする根拠は次のとおり。

- 変更内容がバージョン番号の差し替えとlockfileの更新に限られ、レビューで検出すべき設計上の判断を含まない。
- 回帰の検出はCIが担う。Frontend（Biome、型検査、ビルド）とRust（`cargo fmt`、`clippy`、`cargo test`）の全検査を通過しなければマージされない。
- automergeの範囲がpresetで限定されている。majorは対象外、patchとminorは0.x系を対象外とし、minorには `minimumReleaseAge: 3 days` を置く。
- 自動マージの方針は共有プリセット `github>scottlz0310/renovate-config` が定める組織横断の規約であり、本リポジトリだけで上書きしない。

ただしdevDependenciesのminorとpatch、および `@types/**` は0.x系を含めて自動マージ対象となる。いずれも開発時のみ依存し配布物には含まれないため、この範囲は許容する。

この区別は運用規約であり、ブランチ保護では強制されない。人が作成する変更を自動マージしてはならない。

## 5. アーキテクチャ

### 5.1 レイヤー構成

```text
Tauri v2 / Rust
  ├─ native file/folder dialog
  ├─ workspace and path policy
  ├─ directory traversal and file decoding
  ├─ file watcher lifecycle
  ├─ validated image resource protocol
  ├─ single-instance and file activation
  └─ typed commands and events

WebView2
  └─ React + TypeScript + Vite
       ├─ workspace/tree/tab state
       ├─ Markdown parsing and sanitization
       ├─ preview rendering
       ├─ navigation and selection
       └─ theme and accessibility UI
```

### 5.2 Frontend

- React + TypeScript + Viteを使用する。
- JavaScript依存関係とスクリプト実行にはBunを使用する。
- React Router、Redux、Zustand、SSRは初期導入しない。
- Reactのlocal state、`useReducer`、Contextを基本とする。
- Biome、`tsc --noEmit`、Lefthookを品質ツールとして使用する。
- テストは `bun:test` を使用する。

Bunはユーザー標準のパッケージマネージャー（pnpm）と異なるため、次の影響を設計として引き受ける。選定理由は4.4に記録する。

- 共有Renovateプリセットがpnpm前提のルールを含む場合、Bun向けの調整をプリセット側へ集約する。
- CIキャッシュとlockfile（`bun.lock`）の扱いをpnpm前提のワークフローから分離する。

### 5.3 Tauri IPC

- 要求と応答にはTauri commandを使用する。
- ファイル変更、テーマ変更、言語変更（10.5）、ドラッグ状態（10.4）などの通知にはTauri eventまたはchannelを使用する。
- Frontendへ汎用ファイルシステムAPIを公開しない。
- commandごとに必要なcapabilityだけを許可する。
- Frontendから受け取ったパス、URL、resource IDはRust側で再検証する。
- Markdown由来の文字列をJavaScriptとして連結または評価しない。

型はRust側を正本とし、TypeScriptの定義は `ts-rs` で生成する。生成物は `src/types/generated/` へコミットし、CIの `Rust` ジョブが再生成して差分を検査する。`tsc --noEmit` と `cargo check` は各言語内の整合性しか見ないため、両者のwire契約の一致はこの生成と差分検査で担保する。

`ts-rs` を選んだ理由は次のとおり。

- 安定版（12.x）が提供されている。`specta` / `tauri-specta` はTauri commandのシグネチャごと型付きクライアントを生成できるが、2.0.0-rc系のまま安定版がなく、Tauriの更新追従がrcのリリースへ依存する。
- 手書きの二重定義は、乖離を検出できても防止できない。型を追加するたびに人が両方を書く必要があり、維持コストが最も高い。
- Rustのdocコメントが生成物のTSDocへ引き継がれるため、契約の意味が両言語で失われない。

生成物はBiomeの整形対象から除外する。整形すると再生成で差し戻り、CIとローカルで振動するためである。同じ理由で、生成物に対して末尾空白などの整形検査（`git diff --check` 等）も行わない。除外によってローカルの検査が手薄になるため、Rustを変更したときは pre-commit で再生成と差分検査を実行する。

プロトコルバージョン、request ID、キャンセルは、いずれもwire契約へ導入しない。判断の根拠は次のとおり。

| 項目 | 判断 | 根拠 |
| --- | --- | --- |
| プロトコルバージョン | 載せない | `tauri::generate_context!` が `frontendDist` をバイナリへ埋め込み、MSIXは単一パッケージとして配布されるため、FrontendとRustは常に同一ビルドになる。実行時にバージョンがずれる経路がなく、versionを見る分岐は到達しない |
| request ID | 載せない | 要求と応答の対応付けは `invoke` が返すPromiseが行う。陳腐化した応答の破棄はFrontendの世代カウンタで行う（下記）。診断ログはcommand名とワークスペース相対パスで追跡する（11.2） |
| キャンセル | 導入しない | 走査は1階層に限り、ファイル読込は10 MiB上限であるため、処理単位が短く完了を待てる。中断を入れると進行中要求のテーブル、各ループの中断チェック、中断時の応答契約が必要になり、現在の処理量に見合わない |

陳腐化した応答は、Frontendが保持する2層の世代で破棄する。`await invoke()` は呼び出しと応答を対応付けるため、世代をFrontend側だけで保持すれば判定できる。

| 世代 | 進めるとき | 判定 |
| --- | --- | --- |
| ワークスペース世代 | ワークスペースを切り替えたとき | 応答受信時の値が、要求時に控えた値と一致すること |
| パス世代 | 同じパスの走査を開始したとき | 応答受信時のそのパスの最新値が、要求時に採番した値と一致すること |

両方を満たした応答だけを反映する。この2層は走査の応答が対象である。文書の読込は対象が単一のファイルであり、同じタブに対する複数の読込が競合するため、タブごとの読込世代で判定する（6.5）。

応答に含まれる `path` は「どのディレクトリの結果か」を示す情報であり、陳腐化の判定には使えない。次の2つを識別できないためである。

- 同一パスへの再走査。`DirectoryChanged` による再取得と手動の再展開が重なると、新旧の要求の `path` が一致する。
- ワークスペースの切り替え。切替直後は旧ワークスペースと新ワークスペースのルートがともに相対パス `""` になり、同名のサブパスも衝突する。

世代を2層に分けるのは、別パスの走査を相互に無効化しないためである。サブフォルダーは展開時に遅延取得し、`DirectoryChanged` でも影響を受けた階層だけを再取得するため、`a/` の走査中に `b/` の走査を始めても両方が有効でなければならない。単一のカウンタで「最新の要求だけを採用」すると、後から始めた `b/` が `a/` を無効化し、展開済みの `a/` が読み込まれないまま残る。

ワークスペースを切り替えるときは、ワークスペース世代を進め、パス世代の記録を破棄する。これにより旧ワークスペースの応答は、パスが一致していてもワークスペース世代の不一致で破棄される。この振る舞いはPhase 4で、同一パスの再走査、別パスの同時走査、ワークスペース切替の3つの競合をテストで固定する。

この判断は、Frontendが単一のWebViewとして同梱される構成に依存する。sidecarや外部プロセスを追加する場合、またはlong-runningな処理（全文検索など）を導入する場合は、その時点で再検討する。

数値型はJSONの範囲で表現できるものに限る。`u64` は `ts-rs` が `bigint` へ写像するが、TauriのJSON IPCは `serde_json` を通るためFrontendが受け取るのは `number` であり、生成した型と実値が乖離する。バイト数や件数には `u32` を使う。

エラーは `IpcError` として次の構造を持ち、Frontendでの分岐に文字列比較を使わない。

- `code`: 安定した機械可読の識別子。原因ごとに列挙し、`ts-rs` がTypeScriptのunion型として生成する
- `message`: 表示用のメッセージ。Rust側が現在のUI言語（10.5）で組み立てる
- `detail`: 任意の補足情報

再試行可否は `code` から導出し、応答には含めない。`src/types/error.ts` の `RETRYABLE` を正本とし、`Record<ErrorCode, boolean>` として定義することで、Rust側で `code` を増やしたときに表の漏れを `tsc --noEmit` が検出する。応答に `retryable` を持たせると、`code` と矛盾する値をRust側が返し得るが、型では防げないため採らない。

表示場所（ネイティブダイアログ、プレビュー領域、ツリー項目、文書内要素）はFrontendが呼び出しの文脈から決める。同じ `code` でも、タブを開く操作で起きたか、ツリーの走査で起きたかによって表示先が変わるためである。Rustは呼び出し元のUI文脈を知らないため、応答へ表示場所を含めない。

`code` はディレクトリとファイルを分けて定義する。走査の失敗はツリー全体の失敗とせず該当項目へ表示する（6.2）一方、ファイル読込の失敗はタブの表示に影響するため、原因が同じ「アクセス拒否」でも対象と扱いが異なる。

第12章が挙げる失敗のうち、`IpcError` が担うのはRust側の処理で生じるものに限る。

| 失敗 | 表現 |
| --- | --- |
| WebView2 Runtimeの欠落、MSIXのPackage Identity | IPCが成立しないため対象外。ネイティブダイアログで表示する |
| 画像の境界違反、サイズ超過、ピクセル寸法超過、読込失敗 | resource IDの発行時（IPC command）は画像用の `code` を持つ `IpcError`、配信時はcustom image protocolの応答で表す。区分は両者で一致させる（5.4） |
| Mermaid、lowlight、KaTeXの描画失敗、Mermaidと数式の上限超過、lazy import失敗 | Frontend内で完結するため対象外 |
| 上記以外（ワークスペース、パス検証、ファイル読込、監視、設定） | `IpcError` |

ネイティブ絶対パスを `message` と `detail` へ含めない。表示にはワークスペースルートからの相対パスを用いる。

### 5.4 WebViewへの資産提供

- Vite成果物はTauriの組み込みアプリプロトコルから提供する。
- 製品版で `file://`、`NavigateToString`、ローカルHTTPサーバー、CDNを使用しない。
- ユーザーが選択したワークスペース全体をTauri asset protocolへ公開しない。
- `assetProtocol.scope` をホームディレクトリ全体へ広げない。
- ユーザー画像は、Rust側で検証したresource IDをキーとする専用の非同期custom URI scheme protocolから提供する。
- custom protocolは読込完了後にファイルハンドルを閉じ、正しいContent-Type、CSP、`X-Content-Type-Options: nosniff` を返す。
- 静的アセットは組み込みアプリプロトコルから提供し、外部取得を行わない。KaTeXは `output: "mathml"` としフォントを同梱しないため、フォントの提供経路は持たない（8.5）。CSPの `font-src` も `'none'` とする（5.5）。

Tauri v2には非同期custom URI scheme protocolがあるため、画像I/OでUIスレッドをブロックせず、ワークスペース全体をWebViewへ公開しない構成を採れる。

WebView2ではcustom protocolがWindows特有のオリジン形式で提供される場合がある。URL形式を推測で確定せず、Phase 1のスパイクで実際に配信されるオリジンとURL形式を実測し、次の3か所を同じ前提で揃える。

- CSPの `img-src`
- `rehype-sanitize` のschemaが許可するプロトコル
- Frontendが生成する画像URLの組み立て

resource IDはワークスペースごとに生成し、推測不可能な値とする。loose tabでは、そのファイルの所在フォルダーを暗黙のルートとして同じ単位で発行する（9.1）。ワークスペースを切り替えたら旧IDを無効化し、旧IDでの要求を拒否する。具体は次のとおり。

| 項目 | 方針 |
| --- | --- |
| 生成 | ワークスペースを開くときに乱数のソルトを生成し、相対パスとそのパスの変更世代を入力とするHMACをIDとする |
| 発行の単位 | 文書の描画時に、その文書が参照する画像をまとめて発行する |
| 対応の保持 | ID から絶対パスを引くマップをワークスペース単位で保持する。マップに無いIDの要求は拒否する |
| 無効化 | ワークスペースを切り替えるとき、および監視のバッファがあふれたときにソルトとマップを破棄する。旧IDは対応を失い、拒否される |
| キャッシュ | 監視が変更を検知すれば変更世代が進みIDが変わるため、長期キャッシュを返してよい |

判断の理由は次のとおり。

- ソルトを乱数にするのは、相対パスを知っているだけではIDを算出できないようにするためである。ハッシュの入力が相対パスだけだと、パスを推測できる攻撃者がIDを再現できる。
- 変更世代をIDへ混ぜるのは、内容が変わったときにIDを変えるためである。IDが変わればWebViewは別のリソースとして取得するため、長期キャッシュを返しても更新が反映される。逆にこれを含めないと、キャッシュを無効化する別の仕組み（毎回の再読込、または条件付き取得）が必要になる。
- 変更世代はパスごとの整数とし、ファイル監視がそのパスの変更を検知したときにRust側で加算する。更新時刻とバイト数を使わないのは、同じサイズで更新時刻を据え置いた書き換えや、ファイルシステムの時刻精度内での置換を識別できないためである。変更世代であれば、監視が変更を検知して再描画が起きる場合に必ずIDが変わり、「再描画されるのに古い画像が表示される」状態が生じない。監視が捕捉できない書き換えではIDも変わらないが、その場合は再描画も起きないため表示は一貫する。
- 内容ハッシュを使わないのは、ID発行時に画像全体（1画像最大32 MiB）を読む必要があり、描画前の待ち時間とメモリを大きく使うためである。同時読込2件という上限（7.3）とも衝突する。
- 監視のバッファがあふれたときはソルトを再生成し、マップを破棄する。overflowでは個別のイベントを取りこぼすため、変更された画像の世代が進まないまま再描画が起きる（6.4）。ソルトを変えれば全IDが変わり、再描画時に必ず取得し直される。overflowは稀であり、全画像を取得し直すコストは許容する。
- 発行を文書単位でまとめるのは、画像が多い文書でIPCの往復が画像数に比例しないようにするためである。応答は要素ごとに成功と失敗を持ち、一部の画像が失敗しても他は表示する（7.3）。
- 画像を走査時に事前登録しないのは、画像をツリーへ表示せず、ルート全体を再帰列挙しない方針（6.2）と整合させるためである。

IDの発行時に境界とファイル形式を検証し、配信時にも同じ検証を行う。検証と配信の間に対象が置換される競合があるため、配信時はhandleベースで最終確認する（7.1）。

発行時の失敗は `IpcError` で表し、画像固有の `code`（`imageUnsupportedFormat`、`imageTooLarge`、`imagePixelLimitExceeded`、`imageDecodeFailed`）を用いる。Markdown用の `fileTooLarge`（10 MiB）や文字コード用の `decodeFailed` は上限も対象も異なるため流用しない。配信時の失敗も同じ区分で表し、HTTPのステータスコードへ対応付ける。

Phase 1のスパイクで実測した結果は次のとおり（13.4）。

| 項目 | 実測値 |
| --- | --- |
| WebViewのオリジン | `http://tauri.localhost` |
| custom protocolのオリジン | `http://mdperuse-img.localhost` |
| URL形式 | `http://<scheme>.localhost/<path>` |
| スキーム名 | ハイフンを含む名前（`mdperuse-img`）を使用できる |
| CSPの配信方法 | meta要素ではなくHTTPヘッダ |

`img` 要素からの読込みは成功し、`fetch` は同じURLでも失敗する。custom protocolのオリジンはWebView本体と別オリジンであり、`fetch` にはCORSの許可が要る。画像は `img` 要素で読み込むため、レスポンスへ `Access-Control-Allow-Origin` を付けない。付けないことで、Frontendのスクリプトが画像バイト列そのものを読み取る経路を与えない。

### 5.5 CSPとcapability

正本は `src-tauri/tauri.conf.json` と `src-tauri/capabilities/default.json` とし、本節は値と理由を記録する。

```text
default-src 'none';
script-src 'self';
style-src-elem 'self' 'unsafe-inline';
style-src-attr 'none';
img-src 'self' http://mdperuse-img.localhost;
font-src 'none';
connect-src 'self' ipc: http://ipc.localhost;
frame-src 'none';
object-src 'none';
base-uri 'none';
form-action 'none';
```

各ディレクティブの理由は次のとおり。

- `img-src` と `connect-src` の値はPhase 1のスパイクの実測に基づく（13.4）。custom protocolのオリジンは `http://mdperuse-img.localhost` である。
- `connect-src` へ画像用オリジンを加えない。画像は `img` 要素で読み込み、`fetch` からは到達させない。`fetch` を許可すると、Frontendのスクリプトが画像バイト列を直接読める経路になる。実測でも `img` からの読込みは成功し、`fetch` はCORSで失敗する（13.4）。
- `style-src` を `style-src-elem` と `style-src-attr` へ分ける。MermaidはテーマCSSを生成SVG内の `style` 要素として埋め込むため要素側には `'unsafe-inline'` が要るが、インラインの `style` 属性は本文でもMermaid出力でも許可しない。sanitize schemaが `style` 属性を許可していないこと（8.2）とCSPが一致し、DOMPurifyの設定漏れをCSPが二重に受け止める。WebView2はChromiumでありCSP Level 3のこの2つを解釈する。
- この分割により、レイアウトの動的な値をReactの `style` prop（インライン `style` 属性）で渡せない。スプリッターの幅（10.2）や文字サイズ（10.3）のように実行時に変わる値は、`style` 要素へCSSカスタムプロパティを書き込む形で反映する。Phase 4のUI実装はこの制約の下で行う。
- `font-src` を `'none'` とする。KaTeXは `output: "mathml"` としフォントを同梱しない（8.5）。アプリのCSSもシステムフォントだけを指定し、`@font-face` と `url()` を持たない。将来Webフォントを同梱する場合はここを `'self'` へ変える。
- `worker-src`、`media-src`、`manifest-src` は指定しない。`default-src 'none'` が適用され、いずれも使わない。
- Mermaidの `securityLevel: 'sandbox'` はiframeを使うため、iframeを遮断する本方針では採用できない。`strict` 相当とsanitizeの二重防御を採る（8.4）。

Mermaidが生成SVGへインラインの `style` 属性を出力するかは、実機のWebView2でなければ確認できない。happy-dom上では `mermaid.render` の戻り値が空文字列となり、出力を測定できなかった。Phase 4の実装時に実機で確認し、`style` 属性に依存していた場合は、DOMPurifyで落としたうえで不足する見た目を自前CSSで補う。CSPを緩める方向では対応しない。

capabilityは `src-tauri/capabilities/default.json` に次の3つだけを置く。

| 権限 | 用途 |
| --- | --- |
| `core:event:allow-listen` | Rustから送るファイル変更イベント、テーマ変更イベント、言語変更イベント、ドラッグ状態（5.3、10.4、10.5）の受信 |
| `core:event:allow-unlisten` | 上記の解除 |
| `opener:allow-open-url`（`http://*`、`https://*` へ限定） | 外部リンクをOS既定ブラウザーで開く（7.2） |

- `core:default` は使用しない。このセットに含まれる `core:image:default` は `allow-from-path` を持ち、Frontendから渡された任意のパスの画像を読み取れる。`core:path:default` はパス解決APIをFrontendへ公開する。いずれも上記方針と衝突する。`core:tray:default` はトレイアイコンを使わないため付与しない。
- `core:window:default`、`core:webview:default`、`core:app:default` も付与しない。参照系が中心とはいえ、`core:webview:default` には `allow-internal-toggle-devtools` が含まれ、`core:app:default` はアプリ識別子やバンドル種別をFrontendへ公開する。現時点で呼ぶ予定がなく、必要になった時点で個別の権限を足す。
- `core:event:allow-emit` は付与しない。FrontendからRustへの通信はcommandで行い、Frontend発のイベントを使わない（5.3）。
- ファイルシステム系プラグインのcapabilityをFrontendへ付与しない。フォルダー選択と読込はRust側のcommandで行う。
- ドラッグ＆ドロップ（10.4）のためにcapabilityを足さない。`tauri://drag-drop` はネイティブ絶対パスを運ぶため、Frontendではlistenせず、Rust側の `on_window_event` で受ける。この方針の下でも、Frontendが `tauri://drag-drop` をlistenできてしまうことは変わらない。`core:event:allow-listen` にイベント名の絞り込みがないためである。付与済みの権限で防げない以上、Frontendがdragイベントをlistenしないことをコードレビューで保つ。

## 6. ワークスペースとファイルツリー

### 6.1 ルートモデル

- `フォルダーを開く`で単一のルートを選択する。フォルダーをドラッグ＆ドロップしたときも同じ経路で開く（10.4）。
- ツリーには選択ルート以下だけを表示する。
- ルートより上、兄弟ドライブ、`This PC`全体をツリーから辿らせない。
- 別フォルダーを開くと、Watcher、探索キャッシュ、通常タブ、loose tabを破棄して完全に切り替える。
- 新しいルートではREADMEなどを自動選択せず、welcomeまたは未選択状態を表示する。
- `ワークスペースを閉じる`は、切り替えと同じ破棄処理を行ったうえでwelcome状態へ戻す。

### 6.2 探索

- ルート直下だけを最初に取得し、サブフォルダーは展開時に遅延取得する。
- 取得済みディレクトリの結果はセッション中だけキャッシュする。
- ルート全体を起動時に再帰列挙しない。
- symlink、junction、その他のreparse pointは探索しない。
- アクセス拒否は該当項目へ表示し、ツリー全体の失敗にしない。

初期除外対象は次のとおりとする。比較は大文字小文字を区別しない。

| 分類 | 名称 |
| --- | --- |
| バージョン管理 | `.git`、`.hg`、`.svn` |
| 依存関係 | `node_modules`、`.venv`、`venv`、`vendor` |
| ビルド成果物とキャッシュ | `target`、`dist`、`build`、`out`、`bin`、`obj`、`.next`、`.turbo`、`__pycache__`、`.mypy_cache`、`.pytest_cache` |
| IDEとツール | `.vs`、`.idea`、`.vscode` |
| 属性による除外 | 隠し属性、システム属性、reparse point |

除外一覧は初期版ではユーザー設定から変更できない。除外されたフォルダーはツリーに表示しない。`.gitignore` の解釈は行わない。

ツリーの表示対象はフォルダーと `.md`、`.markdown` に限る（6.3）。対象ファイルを1つも含まないフォルダーも表示する。存在の把握を優先し、展開して空であることを許容する。

### 6.3 対象ファイルと文字コード

| 項目 | 方針 |
| --- | --- |
| 拡張子 | `.md`、`.markdown`。比較は大文字小文字を区別せず、名前の末尾で判定する。`.md` のように拡張子だけの名前も対象とする |
| 文字コード | UTF-8（BOMあり／なし）、BOMで判定できるUTF-16 LE／BE |
| 推測変換 | CP932などの推測変換は行わない |
| Markdown上限 | 10 MiB |
| 非Markdownファイル | ツリーへ表示しない。走査の時点で除外し、ツリー項目数を最小に保つ |

対象かどうかの判定は、走査、監視の畳み込み（6.5）、起動引数の解釈（9.2）、リンク解決（7.2）のすべてで一致させる。Rust側の正本は `src-tauri/src/file_kind.rs`、Frontendのリンク解決は `src/markdown/link-target.ts` とし、どちらも名前の末尾で判定する。片方が `.md` を拡張子なしと見なすと、リンクからは開けるのにツリーへ出ないファイルが生じる。

未対応または不正な文字コードは置換せず、原因を表示する。上限を超えたMarkdownは解析・描画しない。

改行コードはCRLF、LF、CRを受け入れ、描画前にLFへ正規化する。

### 6.4 ファイル変更監視

- Rustの `notify` crateでルート以下を再帰監視する。監視対象は開いているファイルに限定しない。ツリー表示とタブの両方が変更へ追従する必要があるためである。
- `notify` はディレクトリ単位の除外を行えないため、除外対象配下のイベントは受信後にパスで判定して破棄する。
- イベントをdebounceし、同一ファイルの連続イベントをまとめる。debounce時間は暫定150 msとし、Phase 4で実測して確定する。値の正本は `src-tauri/src/watch.rs` とする。
- アクティブ文書は再読込し、非アクティブタブは `stale` にする。状態遷移としては、変更を受けたタブはアクティブかどうかによらず `stale` になり、アクティブタブが `stale` になった時点で再読込して `loaded` へ戻す。再読込という副作用を状態から切り離すことで、再読込に失敗したタブが `stale` のまま留まる状態も同じ規則で表せる。規則は `src/state/tab-status.ts` の `applyFileChange` を正本とする。
- 再描画後は可能な範囲でスクロール位置を保持する。
- 変更のたびにルート全体を再走査しない。展開済みディレクトリのうち、イベントが届いた階層だけを再取得する。
- ワークスペース切り替え時は旧Watcherを停止してから状態を破棄する。
- ファイルハンドルをタブの寿命まで保持しない。
- Windowsでは読込時に共有読込・書込・削除を許可し、置換を妨げない。
- Watcherのバッファオーバーフローを検知した場合は、展開済みディレクトリの再取得とアクティブ文書の再読込へフォールバックし、その旨を表示する。


Phase 1のスパイクで、MSIX環境の `notify` が返すイベント列を実測した（13.4）。ルート直下とサブディレクトリの双方でイベントを受信でき、再帰監視は成立する。

atomic replace（一時ファイルへ書いてからrename）は次の順で観測された。新しいものが下になる。

```text
Create(Any)        <root>\a.md.tmp
Modify(Any)        <root>\a.md.tmp
Remove(Any)        <root>\a.md
Modify(Name(From)) <root>\a.md.tmp
Modify(Name(To))   <root>\a.md
```

置換先の既存ファイルに対して、rename直前に `Remove` が届く。この `Remove` を素朴に削除と解釈すると、置換のたびにタブを閉じてしまう。6.5の削除判定は、`Remove` を受けた時点では確定させず、debounce期間内に同一パスへの `Modify(Name(To))` または `Create` が続かないことを確認してから削除と判断する。

単一の書込みに対しても `Create` と複数の `Modify` が届く。debounceは実装上の最適化ではなく、正しさのために必要である。

大規模ツリーでのイベント量に上限を設けるか、監視範囲を縮退させるモードを設けるかは未決とする。

#### Watcherのライフサイクル

Watcherは2系統ある。ワークスペースのルート以下を再帰監視するものと、loose tabが開いているファイル1件を監視するものである。

| 系統 | 開始 | 停止 | 単位 |
| --- | --- | --- | --- |
| ワークスペース | ルートを開き、ルート直下の走査を要求する時点 | ワークスペースの切り替え、ワークスペースを閉じる操作、ルート自身の削除・rename、アプリ終了 | ワークスペースに1つ |
| loose tab | loose tabを開いた時点 | そのタブを閉じたとき、ワークスペースを開いてloose tabが破棄されたとき、アプリ終了 | loose tab 1つにつき1つ |

ワークスペース側のWatcherは、走査の完了を待たずに開始する。走査中に起きた変更を取りこぼさないためである。走査の応答が陳腐化する競合は、Frontendが持つ2層の世代で破棄する（5.3）。

切り替え時は旧Watcherを停止してから状態を破棄する。停止前に破棄すると、停止前に届いたイベントが新しいワークスペースの状態へ適用されうる。

#### 監視スコープ

`FileChangeEvent` は、発生元を表す不透明な `scopeId` を持つ。スコープはワークスペース、またはloose tabの暗黙のルートを単位としてRust側が採番する。画像resource IDのソルトと同じ単位である（5.4、9.1）。

イベントの `path` はスコープのルートからの相対パスであり、それだけでは通知先を一意にできない。次の2つが同じ相対パスで衝突する。

- 暗黙のルートが異なる2つのloose tab。`C:\A\README.md` と `C:\B\README.md` はどちらも `README.md` になる。
- ワークスペースの切り替え。停止したWatcherが停止前に送出したイベントが切替後に配送されると、新しいルートの同名ファイルへ適用されうる。Watcherの停止は、送出済みイベントの配送までは止められない。

Frontendは、自分が保持するスコープと一致しないイベントを破棄する。切り替えのたびに新しい `scopeId` を採番するため、この1つの判定で両方の衝突を防げる。絶対パスをFrontendへ渡さずに識別できる点も、7.1の方針と整合する。判定は `src/state/tab-status.ts` の `applyFileChange` を正本とする。

loose tabのファイル単体を監視するのは、関連付けで開いた文書だけが変更に追従しない状態を避けるためである。[spec.md](./spec.md)の主用途では、開いている文書が外部のツールに書き換えられることが常態であり、ワークスペース経由で開いたときと振る舞いが変わると、ユーザーは古い内容を見ていることに気づけない。暗黙のルート配下を再帰監視しないことは9.1のとおりで、関連付けで開いただけのフォルダーを丸ごと監視すると、アイドル時の低負荷というコアバリューに反する。相対画像の差し替えは検知しない。

### 6.5 削除、rename、置換後のタブ状態

タブは `loaded`、`stale`、`deleted` の3状態を持つ。本アプリはRead-onlyであり、編集による未保存状態は存在しない（9.1）。状態遷移の正本は `src/state/tab-status.ts` とする。

| 事象 | 挙動 |
| --- | --- |
| 変更 | タブを `stale` にする。アクティブタブは続けて再読込し、成功すれば `loaded` へ戻す |
| 削除 | タブを自動で閉じない。最後に読めた内容を表示したまま `deleted` にし、以後の再読込を停止する。閉じる操作はユーザーに委ねる |
| rename（追跡できる場合） | タブのパスとタイトルを新しいパスへ追従させる。ツリーの選択状態も追従させる。内容は変わらないため状態は保つ |
| rename（追跡できない場合） | 旧パスの削除と新パスの作成として扱う |
| atomic replace | debounce窓内の create / remove / modify の連続を1回の変更へ畳み込み、同一パスを開き直して読み直す |
| ルートフォルダー自体の削除やrename | Watcherを停止し、ワークスペースを閉じた状態へ遷移して原因を表示する |

`deleted` は終端状態とする。削除はdebounce窓で置換とrenameを除いてから確定するため（6.4）、確定した時点でファイルは実際に失われている。同じパスへ後からファイルが作られても、そのタブは復帰させない。ユーザーが開き直せば新しいタブになる。

renameを追跡するため、`FileChangeEvent` の `change` は種別ごとに必要な情報を持つtagged unionとし、`fileRenamed` だけが旧パスを持つ（5.3）。旧パスを任意フィールドとして持たせないのは、renameでないのに旧パスが入った状態を型として表現させないためである。

#### debounce窓の畳み込み

rename対をそのまま `fileRenamed` として通知することはできない。6.4で実測したatomic replaceの列も `Modify(Name(From)) a.md.tmp` と `Modify(Name(To)) a.md` の対になるためである。そのまま通知すると `fileRenamed { oldPath: "a.md.tmp", path: "a.md" }` となり、開いている `a.md` のタブは `oldPath` と一致せず再読込されない。一方、先行する `Remove a.md` を `fileRemoved` として通すと、置換のたびにタブが `deleted` になる。

両者を分ける基準は、rename元がツリーの対象（`.md` / `.markdown` で、除外対象配下でない。6.2、6.3）かどうかとする。エディタとAIエージェントが使う一時ファイル（`a.md.tmp` など）は対象外であり、対象外からのrenameは「別のファイルの移動」ではなく「その場での置換」だからである。

| 窓内の状況 | 確定する変更 |
| --- | --- |
| `RenamedTo P` があり、rename元が対象外 | `fileModified P`（置換） |
| `RenamedTo P` があり、rename元 `S` が対象で `Removed P` がない | `fileRenamed { oldPath: S, path: P }` |
| `RenamedTo P` に `Removed P` が先行し、元 `S` が対象（上書きrename） | `fileRemoved S` と `fileModified P` |
| 対象のファイルが対象外の名前へ移された | `fileRemoved`（消えたものとして扱う） |
| 対のrename先が届かないrename元 | `fileRemoved` |
| `Removed P` があり、同じ窓で `P` が作り直されない | `fileRemoved P` |
| `Created P` または `Modified P` だけ | `fileModified P` |

削除は窓を閉じるまで確定させない。同じ窓の中で置換やrename先として復活しうるためである。

対のrename先が届かないrename元は、監視範囲外への移動やイベントの取りこぼしである。いずれも旧パスからは失われているため、窓を閉じる時点で削除として確定する。捨ててしまうと、開いているタブが `loaded` のまま残り、ツリーも削除を反映できない。

rename元が同時に2件以上保留になった窓では、どの元がどの先に対応するかをイベントの順序から決められない。誤った対応付けは無関係な2つのタブを互いのパスへ移すため、その窓ではrenameの追跡をやめ、削除と置換へ倒す。rename先が保留中のrename元に現れる入れ替え（`a`→`b` と `b`→`a`）では、パスが失われていないため削除にはせず、両方を変更として扱う。同じ窓に複数のatomic replaceが入る場合も、rename元はいずれも対象外の一時ファイルであるため削除は生じない。

renameを確定するとき、同じ窓で受けた旧パスの変更は新パスへ引き継ぐ。旧パスのまま残すと、Frontendがタブを新パスへ移した後に旧パスの変更を捨て、変更後の内容を再読込しない。

規則は `src-tauri/src/watch.rs` の `coalesce` を正本とし、6.4で実測した列を含めてテストで固定する。`notify` の型をそのまま扱わず自前の生イベントへ写像するのは、規則をプラットフォームと`notify`のバージョンから切り離して検証するためである。

ツリーの更新に必要な `directoryChanged` は、確定した作成・削除・renameの親ディレクトリに対して別途生成する。

#### 置換直後の読込失敗

atomic replaceは、置換の瞬間に読込が共有違反または `NotFound` で失敗しうる。「共有違反時に自動リトライしない」という原則と衝突するため、次の2案を検討した。

- 案A: debounce窓の終端でのみ読込を行い、失敗はそのままエラーとして表示する。原則を維持するが、AIエージェントの連続書込みでエラー表示が出やすい。
- 案B: 同一イベントに対して短い間隔で1回だけ再読込を許可し、それでも失敗した場合にエラーとする。原則の限定的な例外として明文化する。

**案Bを採る。** [spec.md](./spec.md)のユースケースでは置換直後の一時的な失敗が常態であり、これをユーザーへ提示する価値が低いためである。例外の範囲は「同一イベントに対して1回だけ」に限り、回数と待ち時間の正本は `src-tauri/src/watch.rs` とする。待ち時間はdebounceの窓より短くする。窓より長いと、次のdebounceが確定した後に前の再読込を開始することになる。この関係はコンパイル時に固定する。

再読込に失敗したタブは `stale` のまま留め、原因を表示する。失敗を握りつぶして `loaded` へ戻すと、ユーザーは古い内容を最新と誤認する。

#### 文書読込の世代

待ち時間をdebounceの窓より短くしても、保証されるのは読込を開始する順序だけである。読込は非同期であり、完了の順序は開始の順序と一致しない。イベントAの再読込が旧ファイルのhandleを読んでいる間にイベントBの読込が先に完了すると、後から戻ったAの応答が新しい表示を古い内容で上書きする。5.3の2層の世代は走査の応答が対象であり、文書の読込は対象にしていない。

そのため、タブごとに読込世代を持つ。応答を受け取ったときに、開始時の世代がタブの最新と一致する場合だけ反映し、一致しない応答は破棄する。世代は次の2つで進める。

| 進めるとき | 無効化する対象 |
| --- | --- |
| そのタブの読込を開始したとき | 先に始めて未完了の読込 |
| そのタブが変更、削除、renameを受理したとき | 変更より前の内容を読んでいる進行中の読込 |

2つ目がないと、「読込Aを開始 → 次の読込を始める前に変更Bが届く → Aが完了」という順序でAの応答が最新として受理され、Bより前の内容を最新と誤認する。読込の開始だけで世代を進める設計では、この窓を塞げない。

世代だけでは、同じパスのタブを閉じて開き直した場合を区別できない。新しいタブの世代は初期値へ戻るため、閉じたタブで始めた読込の応答が一致してしまう。そのため読込の識別にはタブのインスタンスIDと世代の対（`LoadToken`）を使い、タブを開くたびにインスタンスIDを採番して閉じたタブのIDは再利用しない。

規則は `src/state/tab-status.ts` の `beginLoad`、`applyLoadResult`、`applyFileChange` を正本とし、完了順を反転させた場合、読込中に変更・renameを受理した場合、タブを閉じて開き直した場合をテストで固定する。

読込中に削除が確定したタブへは、届いた内容を反映しない。`deleted` は終端状態であり、最後に読めた内容を保つ。

## 7. パス、リンク、画像の安全方針

### 7.1 パス境界

- ルートと対象を絶対パスへ正規化して比較する。
- `..` によるパストラバーサルを拒否する。
- Markdownリソースとしてabsolute path、UNC、device pathを受け付けない。
- symlink、junction、reparse pointを解決した最終パスでも境界内であることを確認する。
- 検証と読込の間に対象が置換される競合を考慮し、可能な箇所ではhandleベースで最終確認する。
- ネイティブ絶対パスをFrontendのURLまたはDOMへ露出しない。ワークスペースルート自身を指す「最近使ったフォルダー」と「最後のワークスペース」にも例外を設けず、不透明なIDと表示ラベルだけを渡す（11.1）。

Windows固有の条件を次のとおり扱う。

- 境界判定は大文字小文字を区別せずに行う。ただし単純な前方一致は使わず、パスコンポーネント単位で比較する。`C:\root` が `C:\rootx` を含むと誤判定しないためである。
- 8.3形式の短い名前で与えられたパスを長い名前へ解決してから比較する。
- ファイル名のUnicode正規化差（NFC / NFD）を考慮し、比較前に正規化する。正規化してもファイルシステム上の同一性を保証できないため、最終判断はhandleベースの確認へ寄せる。
- 代替データストリーム表記（`file.md:stream`）と末尾のドットや空白を含む名前を拒否する。
- 260文字を超えるパスの扱いを確定する。長いパスを扱う場合はマニフェストでの長パス対応と、Rust側APIの挙動をPhase 1で検証する。

### 7.2 Markdownリンク

- `#anchor` は同一文書内で移動する。
- ルート内の相対Markdownリンクはアプリ内で開く。
- `http` と `https` は明示的なユーザー操作時だけOS既定ブラウザーで開く。
- `javascript:`、`data:`、`file:`、任意の `ms-` schemeを遮断する。
- ルート外の相対Markdownリンクは開かない。文書内のリンクからワークスペースの外へは出ない。

解決規則は `src/markdown/link-target.ts` を正本とし、振る舞いは同ディレクトリのテストで固定する。Frontendが行うのは遷移先の論理的な決定であり、パスの実在とファイルシステム上の境界の検証はRust側が行う（7.1）。Frontendでの拒否は、IPCの往復を待たずに理由を示すためのものである。

sanitizeを通過してFrontendへ届く `href` は次のとおり（実測）。`C:\tmp\a.md` は `C:%5Ctmp%5Ca.md` となり `c` schemeとみなされて除去される。`file:`、`javascript:`、`data:`、`ms-*`、`mailto:`、`tel:` も除去される（8.2）。

| 通過する入力 | 例 |
| --- | --- |
| 同一文書内アンカー | `#section` |
| 相対リンク | `./other.md`、`../up.md` |
| ルート絶対リンク | `/docs/a.md` |
| スキーム相対URL | `//server/share/a.md` |
| 復号でバックスラッシュになる文字列 | `%5Cserver%5Cshare%5Ca.md` |
| 区切りをエンコードした文字列 | `./a%2Fb.md`、`./..%2F..%2Fetc.md` |
| 代替データストリーム表記 | `./a.md:stream` |
| クエリ | `./a.md?x=1` |

この入力に対する解決規則を次のとおり定める。

- 解決基準は、リンクを含むMarkdownファイルの所在フォルダーとする。
- `/` で始まるリンクはワークスペースルートを基準とする。GitHubのリポジトリルート基準の記法をそのまま解釈するためである。loose tabでは所在フォルダーが暗黙のルートとなる（9.1）。
- パーセントエンコードは、パスを `/` で分けたセグメントごとに1回だけ復号する。一括で復号すると `..%2F..%2Fetc.md` が区切りを持つパスへ変わり、トラバーサルが成立する。セグメント単位であれば `%2F` は名前の一部にとどまる。
- 復号したセグメントがWindowsのファイル名に使えない文字（`\`、`/`、`:`、`*`、`?`、`"`、`<`、`>`、`|`、制御文字）を含む場合は拒否する。`%5C` によるUNC表記と代替データストリーム表記はここで落ちる。
- `..` がルートを越えるリンクと、`//` で始まるリンクを拒否する。
- 対象拡張子（`.md`、`.markdown`。大文字小文字を区別しない）でないリンクは拒否する。OS既定アプリへは渡さない。`file:` を遮断する方針（上記）と揃えるためである。
- クエリは捨てる。ファイルシステムにクエリの概念はなく、`?` はWindowsのファイル名に使えないため、`./a.md?x=1` は `./a.md` を指しているとみなせる。
- 相対Markdownリンクにアンカーを含む場合（`./other.md#section`）は、対象文書を開いたうえで描画完了後にアンカーへ移動する。
- 存在しない相対リンクは遷移せず、その場で理由を表示する。
- ルート内の相対Markdownリンクは現在のタブの中で開く。戻る／進む操作をタブごとの履歴として持つ（9.3）。

「復号は1回だけ行い、多重エンコードを拒否する」という当初の方針は、実測に基づき上記へ改めた。remarkは有効なパーセントエスケープだけを温存し、それ以外の `%` を `%25` へ変換する。`./a%b.md` と `./a%25b.md` はどちらも `./a%25b.md` として出力されるため、復号後に `%` が残ることを多重エンコードの証拠として使えない。`./a%252Fb.md` を1回復号した `./a%2Fb.md` は、`%2F` という文字列を名前に含むファイルを指す正当な解釈である。トラバーサルはセグメント単位の復号で断つ。

見出しのIDは `src/markdown/heading-id.ts` の `rehypeHeadingIds` で生成する。`github-slugger` によるGitHub互換のslug規則であり、日本語の文字は保持され、半角空白はハイフンへ、重複は連番で回避される。全角スペースは記号として除去される（実測）。明示的なID指定の記法（`{#id}`）は解釈しない。前置は `user-content-` とし、脚注へ `mdast-util-to-hast` が付けるものと揃える（8.2）。

`rehype-slug` を使わず自前のプラグインとするのは、同プラグインが既存のIDを重複回避の対象へ含めないためである。脚注は `mdast-util-to-hast` が `user-content-fn-1`、`user-content-fnref-1`、`footnote-label` を先に付けており、`# fn-1` という見出しが同じ文書にあると `user-content-fn-1` が2つ生成される。文書順で先にある見出しが `getElementById` に拾われ、脚注参照が脚注へ到達できない（実測）。前置を揃えても分けても、名前空間が1つである限りこの衝突は残る。

`rehypeHeadingIds` は木を2度走査する。1度目で既存のIDをそのまま使用済みとして集め、2度目で見出しへ付与する。これにより `# fn-1` は `user-content-fn-1-1` となり、脚注の `user-content-fn-1` と衝突しない。既存のIDを持つ見出し（脚注セクションの `footnote-label`）は上書きしない。上書きすると `aria-describedby` の参照先が失われる。

既存のIDはslug化せず、生成した候補IDと完全一致で比較する。IDの一部をslug化して比べると、実在しないIDを占有してしまう。`[^a.b]` の脚注は `user-content-fn-a.b` というIDを持つが、`fn-a.b` をslug化すると `fn-ab` になる。これを占有すると `# fn-ab` の見出しが `user-content-fn-ab-1` へずれる一方、`#fn-ab` は `user-content-fn-ab` へ解決されるため、リンクが見出しへ到達しない。完全一致で比べれば、前置のない `footnote-label` も候補ID `user-content-footnote-label` とは一致せず、名前空間の区別が自然に保たれる。見出し同士の重複も同じ集合で回避し、採番を1か所に閉じる。

同じ名前空間で実際に衝突した場合、`#fn-1` は脚注を指し、見出しへは到達しない。名前空間が1つである以上どちらか一方しか指せず、脚注が先にIDを取る。DOMのID重複（脚注参照が文書順で先の見出しへ吸われ、脚注へ到達できなくなる）を防ぐことを優先した結果であり、この非対称は残る。

このプラグインは `rehype-katex` より前に置く。後ろに置くと、KaTeXが生成するMathMLのテキストと `annotation` 要素のLaTeXを二重に拾い、`# 数式 $x^2$ を含む` のIDが `数式-x2x2-を含む` となる（実測）。

`rehype-sanitize` は `href` を書き換えないため、`#section` というリンクの断片は前置を持たない。同一文書内アンカーの遷移先は、断片を復号して `user-content-` を前置して求める。脚注の相互参照リンクだけは前置済みのIDと対応しているため、`data-footnote-ref` と `data-footnote-backref` 属性でこの経路を分け、前置しない。

### 7.3 画像

- ワークスペース内の相対画像だけを表示する。
- リモート画像、`data:`画像、ワークスペース外、UNC、device pathを初期版では遮断する。
- 許可形式はPNG、JPEG、GIF、WebP、AVIF、BMP、SVGとする。
- 1画像32 MiB、同時読込2件を上限とする。
- `<img loading="lazy" decoding="async">` を使用する。
- 読込失敗は本文全体を壊さず、画像位置に原因を表示する。

ファイルサイズの上限だけでは、圧縮率の高い画像による過大なデコード後メモリ（decompression bomb）を防げない。ピクセル寸法の上限を1辺16384 px以下かつ総ピクセル数24 Mpx以下とし、超過時は表示せず理由を示す。値は `src-tauri/src/limits.rs` を正本とする。

総ピクセル数を24 Mpxとしたのは、デコード後のメモリをメモリ目標の内側へ収めるためである。RGBA8では4 byte/pxであり、24 Mpxは96 MB、同時読込2件で192 MBとなる。全プロセス合計300 MBという目標（[spec.md](./spec.md) 5.2）に対して余地が残る。当初の暫定案（40 Mpx）は同時2件で320 MBとなり、目標を単体で超えるため採らない。

長辺の制限を総ピクセル数と別に設けるのは、縦横比が極端な画像を許容するためである。16384×1400の縦長スクリーンショットは23 Mpxで通り、16384×16384の正方形は総ピクセル数で落ちる。2つの上限は独立に効き、どちらか一方では足りない。この関係は `limits.rs` のテストで固定する。

Content-Typeは拡張子ではなく、Rust側で判定した内容に基づいて返す。判定結果が許可形式に一致しない場合は配信しない。

### 7.4 SVG

- ローカルSVGは `img` の画像リソースとしてだけ提供する。
- SVG URLへのトップレベル遷移を遮断する。
- script、外部画像、外部通信を許可しない。
- 独自XML書換えは行わず、レスポンスCSPで動作を制限する。
- Mermaid生成SVGはMarkdown描画パイプラインで別途sanitizeする。

`img` 要素として参照されるSVGはスクリプトを実行しないが、レスポンス側のCSPを省略しない。直接ナビゲートされた場合の保険とする。

## 8. Markdown解析と描画

### 8.1 基本パイプライン

```text
Markdown source
  → remark-parse
  → remark-gfm
  → remark-math
  → remark-frontmatter（先頭の YAML ブロックを本文から除く）
  → remark-rehype（Raw HTML はテキストとして出力）
  → rehypeHeadingIds（見出しへ user-content- 前置のIDを付与。KaTeX より前）
  → rehype-katex
  → rehype-sanitize（拡張した strict schema）
  → rehype-react
  → React 要素

mermaid fence
  → Mermaid で SVG 生成
  → DOMPurify（SVG 用 strict allowlist）
  → dangerouslySetInnerHTML（本文描画における唯一の例外）
```

- CommonMarkを基礎とし、`remark-gfm` で表、タスクリスト、取り消し線、autolinkを有効にする。
- `remark-rehype` は既定でRaw HTMLを破棄する。本方針は「Raw HTMLをソース文字列として表示する」であり、破棄でも実行でもない第三の扱いを要する。mdastの `html` ノードをテキストとして出力するhandlerを定義し、`allowDangerousHtml` と `rehype-raw` を使用しない。
- `remark-frontmatter` で文書先頭のYAML front matterを解析し、本文からは除く。`yaml` ノードは `mdast-util-to-hast` にhandlerがなく破棄されるため、非表示は既定の動作で成立する。
- `rehype-react` により本文をReact要素として構築し、本文描画で `dangerouslySetInnerHTML` を使わない。
- unified、Mermaid、lowlight、KaTeX、DOMPurifyはlocal dependencyとして同梱する。

YAML front matterを非表示とする理由と範囲は次のとおり。振る舞いは `src/markdown/pipeline.test.ts` で固定する。

- 解析しないと誤描画される。`---` が水平線に、続く行がsetext見出しになり、見出しIDまで付いてアウトラインへ入る（実測）。`remark-frontmatter` の導入は表示方針によらず必要である。
- front matterは本文ではなく文書のメタデータであり、隠しても本文の意味は変わらない。Raw HTMLをソース文字列として表示する方針（上記）と異なる扱いにするのはこのためである。Raw HTMLは本文中に書かれた記述であり、隠すと文書の意味が変わる。
- 対象はYAML（`---`）に限る。TOML（`+++`）を対象に加えると、`+++` を含む本文が消える副作用が生じる。TOML front matterを使う文書は本文として表示する。
- front matterとして扱うのは文書先頭のブロックだけである。文書の途中にある `---` で囲まれたブロック、閉じられていないブロック、前に空行があるブロックは本文として残す。対象外のブロックを黙って消すと、本文の記述が失われる。
- front matterの値をタブ名やヘッダーへ表示することは初期版では行わない（15章 P2）。YAMLパーサの追加と、型が不定な値の表示規則を要するためである。

Raw HTMLのhandlerは `src/markdown/raw-html.ts` を正本とし、次の規則で出力する。振る舞いは同ディレクトリのテストで固定する。

- blockとinlineの判別はhandlerの第3引数 `parent` で行う。mdastは双方を同じ `html` ノードで表すため、flow contentを子に持つ `root`、`blockquote`、`listItem`、`footnoteDefinition` の直下だけをblockとし、それ以外はinlineとする（実測に基づく列挙）。`heading`、`strong`、`emphasis`、`delete`、`link`、`tableCell` の直下にも `html` ノードは現れ、そこで `pre` を返すとタグと本文が分断される。未知の親はinline側へ倒し、要素の構造を壊さない。
- blockは `pre > code` で包む。素のテキストを返すと `root` 直下に裸のテキストノードが並び、ブロック要素にならないため前後の段落と行が繋がる。`pre` であれば改行とインデントがそのまま残り、ソースを見せていることが体裁からも分かる。コードブロックと同じ見た目になるが、区別のためのclassは付けない。sanitize schemaが `code` へ許すclassは `language-*` だけであり（8.2）、印のために許可範囲を広げない。
- inlineは素のテキストとする。`code` で包むと開きタグと閉じタグが別々のコードスパンとなり、段落が分断される。
- HTMLコメントも同じ扱いとし、破棄しない。GitHubのプレビューは非表示とするが、本アプリの方針は「書かれた文字列をそのまま見せる」であり、`<!-- prettier-ignore -->` のように文書へ実在する記述を隠さない。handlerへ内容による例外判定を持ち込まないことにもなる。
- handlerを置かない場合の既定動作は実測で確認した。blockの `html` ノードは出力から消え、inlineは前後のタグだけが消えて中身のテキストが残る。いずれもソースの表示にはならない。

### 8.2 sanitize schemaの拡張

`rehype-sanitize` のschemaは、パイプラインが実際に生成する要素だけを全列挙する。既定schema（GitHub相当）を出発点とした差分定義は採らない。定義は `src/markdown/sanitize-schema.ts` を正本とし、許可・拒否の振る舞いは同ディレクトリのテストで固定する。

全列挙とした理由は次のとおり。

- 既定schemaは53タグと66個のグローバル属性を許可し、`action`、`method`、`encType` のようにRaw HTMLを前提とした項目を含む。本アプリはRaw HTMLをテキストとして出力するため（8.1）、これらは到達しない許可として残るだけである。
- 既定schemaの `href` プロトコルには `irc`、`ircs`、`xmpp` が含まれる。7.2で許可すると決めたのは `http` と `https`、および相対リンクとアンカーだけである。
- 差分定義では、既定schemaが将来広がったときに許可範囲が自動的に広がる。全列挙であれば、許可範囲はこのファイルを読めば分かる。

`hast-util-sanitize` はschemaを `{...defaultSchema, ...options}` として浅くマージする。指定しないキーには既定値が入るため、`tagNames`、`attributes`、`protocols`、`ancestors`、`required`、`clobber`、`clobberPrefix`、`strip`、`allowComments`、`allowDoctypes` をすべて明示する。

許可する要素は、remark-gfm、remark-math、rehype-katexを通した実測と、KaTeXが生成しうるMathMLノードの列挙に基づく。

schemaの検証は2段構えで行う。要素と属性を手で組む単体テストに加えて、remark-gfm・remark-math・rehype-katexを通した結果をsanitizeへ流す統合テストを置く。単体テストだけでは、上流のプラグインが実際に何を生成するかを検証できない。許可し忘れた属性やIDの二重前置は統合テストで捕まえる。

| 分類 | 要素 |
| --- | --- |
| 見出しと段落 | `h1`〜`h6`、`p`、`br`、`hr` |
| インライン | `strong`、`em`、`del`、`code`、`span`、`sup` |
| リンクと画像 | `a`、`img` |
| リスト | `ul`、`ol`、`li`、`input` |
| 引用とコード | `blockquote`、`pre` |
| 表 | `table`、`thead`、`tbody`、`tr`、`th`、`td` |
| 脚注 | `section` |
| MathML | `math`、`semantics`、`annotation`、`mrow`、`mi`、`mn`、`mo`、`ms`、`mtext`、`mspace`、`mfrac`、`msqrt`、`mroot`、`msub`、`msup`、`msubsup`、`munder`、`mover`、`munderover`、`mstyle`、`mpadded`、`mphantom`、`menclose`、`mtable`、`mtr`、`mtd` |

属性の要点は次のとおり。

- `img` の `src` は画像用custom protocolのURLに一致する正規表現でのみ許可する。`hast-util-sanitize` は属性値を正規表現で制限できるため、プロトコルではなくオリジンとresource IDの形まで固定する。これによりリモート画像と `data:` 画像を遮断する（7.3）。
- `code` の `className` は `language-*` に一致するものだけを残す。
- `input` は `required` により常に `type="checkbox"` かつ `disabled` へ揃える。任意の入力要素が操作可能な状態で残ることはない。
- `th` と `td` の `align` は `left`、`center`、`right` に限る。
- `on*` 属性、`style` 属性、`srcset`、`ping`、`formaction` は列挙しないため除去される。
- 表の構成要素は `ancestors` で祖先に `table` を要求し、単独で現れた場合に除去する。

`id` への前置（`clobber` と `clobberPrefix`）はsanitizeで行わない。`mdast-util-to-hast` は脚注の `id` と `href` の双方へ既に `user-content-` を付けており、sanitizeで再度前置すると `id` だけが `user-content-user-content-fn-1` となる。sanitizeは `href` を書き換えないため、参照先が存在しなくなる。前置の担当は上流へ一本化し、見出しのIDにも同じ前置を適用する。ただし前置を揃えるだけでは見出しと脚注のIDが衝突しうるため、衝突は既存IDの占有登録で避ける（7.2）。

MathML要素の属性は、KaTeX 0.16 が `setAttribute` で設定しうるものから `style`、`href`、`src`、`d`、`alt`、`title` を除いて列挙する。`style` は上記の方針により許可せず、`href` は `trust` 無効化により生成されず（8.5）、`src` と `alt` は `mglyph` 専用でその要素自体を許可しない。色（`mathcolor`、`mathbackground`）と長さ（`width`、`height` ほか）は値のパターンで制限する。利用者はLaTeXへ任意の文字列を書けるため、属性名の許可だけでは値を絞れない。


`href` の許可プロトコルは `http` と `https` に限定する。相対リンクと同一文書内アンカーはプロトコルを持たないため、列挙せずに通る。`javascript:`、`data:`、`file:`、`ms-*` は列挙にないため除去される。

- `target="_blank"` を出力する場合は `rel="noopener noreferrer"` を強制する。
- unifiedパイプライン内では `rehype-sanitize` を最後に置き、sanitize後にプラグインで要素を追加しない。
- ハイライトだけは例外として、sanitize後にコンポーネント側で適用する。入力がテキストのみであり、lowlightの出力が `span` とclass名に限られるため、信頼できないmarkupは混入しない。この根拠が崩れる変更（言語定義の外部読込など）を行わない。

本文用schemaとMermaid生成SVG用のDOMPurify設定は分け、本文側では `foreignObject` を許可しない。

### 8.3 コードブロック

- コードブロックは常に選択・コピー可能な `pre/code` とする。
- `lowlight`（`highlight.js/core`）を使い、明示された言語だけをallowlistから遅延登録する。
- lowlightが返すhastをReact要素へ変換し、`dangerouslySetInnerHTML` を使わない。
- 自動言語判定は行わない。
- 未対応言語はハイライトせず、そのまま表示する。

初期allowlistの案を次のとおりとし、Phase 4で確定する。エイリアス（`ts`、`sh`、`yml` など）は正規名へ写像する。

`typescript`、`javascript`、`tsx`、`jsx`、`json`、`rust`、`python`、`go`、`c`、`cpp`、`csharp`、`java`、`kotlin`、`swift`、`sql`、`bash`、`powershell`、`yaml`、`toml`、`ini`、`xml`、`html`、`css`、`diff`、`dockerfile`、`makefile`、`markdown`、`plaintext`

`forced-colors` が有効なときは配色によるトークン区別が失われるため、太字と斜体による区別へ切り替える。

ハイライトの上限は1ブロック64 KiB、1文書の合計256 KiBとする。値は `src/markdown/limits.ts` を正本とする。超過したブロックはハイライトせず、プレーンな `pre/code` として表示する。選択とコピーは変わらず行える。

二段で抑えるのは、「1 MiBの文書を500 ms以内に描画する」目標（[spec.md](./spec.md) 5.1）をハイライトだけで使い切らないためである。lowlightの処理時間は入力サイズにほぼ比例し、49 KiBで28 ms、488 KiBで198 msだった（実測）。ブロック単位だけの制限では、64 KiB弱のブロックが16個並ぶ1 MiBの文書が目標を超える。

時間よりhastノード数のほうが効く。488 KiBのTypeScriptは18万ノード、2.4 MiBでは90万ノードを生む（実測）。React要素とDOMノードがこれに比例するため、ノード数を抑えることが描画時間とメモリの両方に効く。上限を超えた側をプレーンテキストへ倒すと、そのブロックは1ノードになる。

文書の予算は数式と同じく「コスト」で数える。コストは入力サイズと最小コスト32 Bの大きいほうとし、極端に短いブロックが固定の処理費用ごと上限を迂回することを防ぐ。1文字のブロックでも2ノードを生み、20000個で25 msかかる（実測）。数式（1個あたり6要素）よりは軽いが、同じ構造の穴であるため揃える。

病的な入力による指数的な悪化は観測されなかった。未閉鎖の文字列、2万段の入れ子JSON、5万項の1行、10万行のコメントのいずれも入力サイズに比例した時間で終わる（実測）。バイト数を基準にすれば、行数では捉えられない「1行が極端に長い入力」（1行282 KiBで168 ms）も同じ規則で抑えられる。

### 8.4 Mermaid

- `mermaid` fenceを検出した場合だけlazy importする。
- security levelはstrict相当とする。`sandbox` はiframeを使うため採用しない。
- HTMLラベル、外部リソース、任意scriptを許可しない。
- Mermaid生成SVGはDOMPurifyでsanitizeする。DOMPurifyの利用箇所はここだけとし、`dangerouslySetInnerHTML` もここだけで使う。
- テーマ変更時は再描画する。
- 描画はオフスクリーンで行い、生成される要素IDが文書内で衝突しないよう一意化する。

処理上限を次のとおり確定する。値は `src/markdown/limits.ts` を正本とする。

| 項目 | 値 | 超過時 |
| --- | --- | --- |
| 1図の入力サイズ | 50 KiB | 描画せず理由を表示 |
| 1図のエッジ数（`maxEdges`） | 500 | Mermaidが `Edge limit exceeded` を返す。理由を表示 |
| 1図の描画タイムアウト | 3秒 | 中断して理由を表示 |
| 文書内の同時描画数 | 2 | 順次描画 |
| 1文書あたりの図の数 | 50 | 超過分はプレースホルダー表示 |

`maxEdges` はMermaidの既定値と同じだが、既定に依存せず明示する。1000ノードのflowchartは描画に入る前に拒否される（実測）。入力サイズの上限より先にこちらが効く場合が多いが、sequenceやganttのようにエッジを持たない図種では入力サイズの側が効くため、両方を残す。

描画時間はDOMのレイアウトとフォント計測に依存するため、実機での測定はPhase 4で行う。3秒は中断の閾値であり、目標値ではない。

`forced-colors` が有効なときは、Mermaidのテーマを高コントラスト向けへ切り替え、色ではなく形状と境界線で区別する。

### 8.5 数式

- `remark-math` と `rehype-katex` でパイプラインへ組み込む。
- 数式を含む文書を開いたときだけKaTeXをlazy importする。MathJaxは採用しない。
- 出力は `output: "mathml"` としてMathMLだけを生成する。既定の `htmlAndMathml` は `span` へインラインの `style` を付け、`\sqrt` などで `svg` と `path` も生成するため、「`style` 属性を許可しない」という8.2の方針と両立しない。MathMLだけであれば追加の許可が要らず、KaTeXのフォント同梱も不要になる。描画品質はWebView2のMathML Core実装に依存する。
- `trust` を無効にし、`\href` や `\includegraphics` を禁止する。
- マクロ展開の上限（`maxExpand`）を1000、ユーザー指定寸法の上限（`maxSize`）を50 emとする。値は `src/markdown/limits.ts` を正本とする。
- 構文エラーは本文全体を壊さず、該当箇所に原因を表示する。`throwOnError` を無効にし、エラー表示を自前の要素で行う。
- `rehype-katex` の出力を `rehype-sanitize` が除去しないよう、8.2のschema拡張と整合させる。

上限の値と、上限で守れない範囲は次のとおり。いずれも実測に基づく。

- `maxExpand` はKaTeXの既定値と同じ1000だが、既定に依存せず明示する。`\def\a{\a}\a` の無限再帰と、4段のマクロ展開爆発はこの値で停止しエラー表示に変わる。3段（出力1万文字規模）は通るが、実害のある規模ではない。
- `maxSize` はユーザーが指定できる寸法の上限（em）であり、出力サイズの上限ではない。`\rule`、`\hspace`、`\kern` の値を50 emへ切り詰める。当初「出力サイズの上限」と記していたのは誤りであり、実測に基づき改めた。
- `\raisebox` の `voffset` は `maxSize` の対象外で、`\raisebox{500em}{x}` は500 emのまま出力される。KaTeX側の制限であり本アプリでは塞げない。sanitize schemaは `voffset` の値を書式（`MATHML_LENGTH`）でしか制限しないため、大きさは通る。この抜けはテストで固定し、KaTeX側で塞げるようになったらテストが失敗して方針を見直せる状態にする。
- 入力サイズの上限を、1つの数式で16 KiB、1文書で描画する数式の合計で64 KiBとする。超過した数式は描画せず、ソースをそのまま表示して理由を示す。判定は `shouldRenderMath` を正本とする。
- 上限をMarkdownの10 MiBとは別に設けるのは、KaTeXの出力が入力の約11倍へ膨張するためである。`x+` の繰り返しで測ると、出力／入力比は1 KiBから977 KiBまで11.0〜11.2倍で一定であり、977 KiBの単一数式は468 ms・出力10.7 MiBとなる（実測）。1 MiBの時点で「1 MiBの文書を500 ms以内に描画する」目標（[spec.md](./spec.md) 5.1）をKaTeX単体で超えるため、Markdownの上限では律速できない。当初「Markdownの10 MiB上限で律速される」と記していたのは誤りであり、5万項（342 KiB、247 ms）までの測定から誤って一般化していた。
- 閾値をコードブロック（64 KiB／256 KiB）より厳しくするのは、この膨張率の差による。16 KiBの数式は16 ms・出力176 KiB、文書合計64 KiBは約35 ms・出力704 KiBに相当する。
- 文書の予算は入力サイズではなく「コスト」で数える。コストは入力サイズと最小コスト32 Bの大きいほうとする。入力サイズだけで積むと、短い数式が固定の処理費用ごと上限を迂回する。`$x$` は本文が1バイトでも6要素を生み、5000個で138 msかかる（実測）。本文の合計だけで数えると65536個が上限内となり、39万要素・数秒に達する。最小コストにより数式は2048個までに収まり、12000要素・約57 msで頭打ちになる。
- 数式の個数そのものに別の上限は設けない。最小コストを含む予算が個数の上限を兼ねる。上限を2つ持つより、消費と判定を1つの予算へ集約するほうが、呼び出し側で数え漏らす余地が少ない。

### 8.6 文書内検索

**初期版へ含め、自前で実装する。** 一致規則と上限の正本は `src/state/find.ts` とする。

WebView2標準の検索バーは採らない。x64・Windows 11 26200・WebView2 Runtime 152.0.4191.53で次を実測した。

- `Ctrl+F` でWebView右上にオーバーレイとして表示される。件数表示（`1/3`）と前後移動を備え、UIはOSの言語に従って日本語化される。オプションは「単語単位で探す」と「発音区別符号を一致させる」の2つで、大文字小文字を区別するトグルはない。
- 検索範囲はWebView全体のDOMである。プレビュー本文の外に置いた表のセルもヒットした。製品ではサイドバーのファイル名、タブ名、パンくずが同じように拾われる。
- 配色はEdgeに従い、アプリのテーマ（Light / Dark）とは独立に決まる。
- `keydown` で `preventDefault()` すると表示されない。`Ctrl+F` を自前のUIへ割り当てられる。

採らない理由は検索範囲である。「文書内検索」と名乗る操作がサイドバーのファイル名にヒットし、本文へは移動しない状態を許せない。Rust側から `ICoreWebView2_28::Find` を呼ぶ経路（バインディングは `webview2-com` 0.38.2 にあり、`tauri` 2.11.5 が依存している）も同じ範囲を対象とするため、この問題を解かない。

自前実装の土台として次を実測した。

- CSS Custom Highlight API（`Highlight`、`CSS.highlights`、`::highlight()`）が動作する。現行のCSP（`style-src-elem 'self' 'unsafe-inline'`、5.5）の下でハイライトが描画される。`Range` を登録するだけでDOMを書き換えないため、sanitize後の木と見出しアンカーのID（7.2）を壊さない。
- `window.find()` も使えるが、選択を動かすだけで一致件数も現在位置も取れないため使わない。

対象と規則を次のとおり定める。

| 項目 | 内容 |
| --- | --- |
| 対象 | プレビュー本文のテキストとコードブロック |
| 対象外 | KaTeXの出力（`.katex`）とMermaidが生成するSVG（`svg`）、およびプレビュー本文の外（サイドバー、タブバー、パンくず） |
| 一致規則 | 大文字小文字のみ吸収する。全角と半角、濁点の合成は吸収しない |
| 一致の数え方 | 重なる一致は数えない。`aaaa` から `aa` を探すと2件 |
| 一致件数の上限 | 1000件。超過分は探索を打ち切る |

KaTeXの出力を外すのは、MathMLのテキストと `annotation` 要素のLaTeXソースを同時に持ち、走査すると同じ数式が二重にヒットするためである。同じ構造が見出しIDの生成でも問題になっている（7.2）。MermaidのSVGを外すのは、`text` 要素の配置が図形のレイアウトに従い、`::highlight()` を掛けたときの見え方を保証できないためである。コードブロックは含める。lowlightが入れるのは `span` の入れ子だけで、テキストノードを文書順につなげば素直に一致を取れる。

一致規則を大文字小文字だけに絞るのは、`Range` のオフセットとの対応を保つためである。畳んだ文字列と元の文字列でUTF-16コードユニット数が変わると、一致位置をDOMへ戻せない。文字列全体へ `toLowerCase()` を掛けると長さが変わりうる。`"İ"` は1コードユニットだが小文字化すると `"i̇"` の2コードユニットになる（実測）。そこでコードポイントごとに小文字化し、長さが変わる文字は元のまま残す。互換正規化（NFKC相当）はコードユニット数を変えるため、正規化後の位置を元のオフセットへ戻す写像を別に持つことになり、ハイライト位置がずれる不具合を招きやすい。

この規則の下では語末シグマ `ς` が `Σ` と一致しない。`Σ` の小文字化は `σ` である一方、`ς` の小文字化は `ς` のままだからである（実測）。長さを保つことを優先した結果として残る非対称であり、テストで固定する。

件数の上限を設けるのは、一致1件につき `Range` を1つ生成するためである。上限がないと10 MiBのMarkdown（8.3）で1文字を検索したときに数万件を抱える。そこまで多い一致を順に見て回る操作には意味がない。

操作は次のとおりとする。いずれもWebView内で処理し、ネイティブメニューへは項目を置かない（10.1）。

| 操作 | キー |
| --- | --- |
| 検索を開く | `Ctrl+F` |
| 次の一致へ | `Enter`、`F3` |
| 前の一致へ | `Shift+Enter`、`Shift+F3` |
| 検索を閉じる | `Esc` |

## 9. タブと起動

### 9.1 タブ

- アプリは原則1インスタンス、1ウィンドウ、1 WebViewとする。
- 複数タブをReact側で管理し、アクティブタブだけ本文DOMを保持する。
- 非アクティブタブはインスタンスID、スコープID、パス、タイトル、スクロール位置、状態（`loaded` / `stale` / `deleted`）、読込世代を保持する。`stale` は外部でファイルが変更され再読込が必要になった状態を指す（6.5）。本アプリはRead-onlyであり、編集による未保存状態は存在しない。
- 同一文書を重複して開かない。
- loose tabは、関連付け起動またはドラッグ＆ドロップ（10.4）でワークスペース外のファイルを開いたときにだけ生じる。文書内のリンクからは生じない（7.2）。利用者がOS経由で明示的に渡したファイルと、文書に書かれた信頼できない入力とを分けるためである。
- loose tabは、そのファイルの所在フォルダーを暗黙のルートとして扱う。配下の相対Markdownリンクと相対画像は解決するが、ツリーへは展開せず、走査も行わない。暗黙のルートを持たせないと、関連付けで開いた文書の画像がすべてエラー表示になる。監視は開いているファイル1件に限り、暗黙のルート配下は再帰監視しない（6.4）。
- 画像resource IDのソルトとマップ（5.4）は、暗黙のルートを単位として発行する。

同時に開けるタブ数の上限は20とし、超過するときは最後にアクティブだった時刻が最も古い非アクティブタブを閉じる。値と規則の正本は `src/state/tabs.ts` とする。

新規オープンを拒否しないのは、関連付け起動がOSから渡される利用者の明示的な操作であり、エクスプローラーからのダブルクリックが無反応に見える経路を作らないためである。本アプリはRead-onlyで編集による未保存状態が存在しないため（9.1）、自動で閉じても失われるのはスクロール位置だけである。

上限をメモリではなくタブバーの可読性で決めたのは、非アクティブタブが本文DOMを持たないためである。閉じる候補は最終アクティブ時刻で選ぶ。タブの並び順で選ぶと、並べ替えたときに最近見たタブが閉じられうる。

`deleted` 状態のタブ（6.5）も候補に含める。上限は十分に大きく、削除済みタブがそこまで溜まるのは異常な状態である。状態で候補を分けると「候補がないときは新規オープンを拒否する」という別の振る舞いが必要になり、同じ「タブを開く」操作が経路ごとに違う結果を返すことになる。

### 9.2 起動と関連付け

- MSIX manifestで `.md` と `.markdown` の関連付けを宣言する。
- 既定アプリにするかはWindowsのユーザー設定に任せる。
- 関連付け起動は既存インスタンスへ渡し、既存ウィンドウを前面化する。
- 関連付けで開かれたファイルがワークスペース外にある場合はloose tabで表示する（9.1）。ワークスペース未選択のまま単一ファイルを表示する状態を許す。
- 起動時は最後のワークスペースだけを開き直す。通常タブ、loose tab、選択中ファイル、スクロール位置は復元しない。
- 復元先が存在しない、またはアクセスできない場合はwelcome状態で起動し、その項目を「最近使ったフォルダー」からも取り除く。起動のたびに開けないフォルダーの失敗を提示しても、ユーザーが取れる行動がないためである。
- 「最近使ったフォルダー」を初期版へ含める。保存件数とFrontendへの渡し方は11.1による。

- 複数のファイルを渡された場合は、対象拡張子（6.3）のものをすべて開き、最後の1つをアクティブにする。抽出の規則は `src-tauri/src/startup.rs` の `files_to_open` を正本とする。

対象拡張子をすべて開くのは、Windowsが「1つのプロセスへ複数の引数」と「ファイル数ぶんのプロセス起動」のどちらで渡すかによらず同じ結果にするためである。後者の場合、2つ目以降はシングルインスタンス化によって既存インスタンスへ渡り、同じ経路へ集約される。先頭だけを開く規則では、渡され方によって振る舞いが変わる。実際の渡され方はPhase 4のE2E回帰で確認する。

同じ文書を重複して開かないため（9.1）、同値の引数は1つにまとめる。上限を超える分は9.1の退避規則で受け入れる。

### 9.3 リンク遷移と戻る／進む

**戻る／進む操作を初期版へ含め、タブごとの履歴として持つ。** 上限と規則の正本は `src/state/doc-history.ts` とする。

ルート内の相対Markdownリンクは現在のタブの中で開き、新しいタブを作らない（7.2）。リンクをたどるたびにタブが増えると、各タブの履歴が常に1件になって戻る／進むが機能しないうえ、数回たどるだけで上限20件（9.1）に達して退避規則が古いタブを黙って閉じることになる。遷移先が別のタブで既に開かれている場合は、そのタブへ切り替える。同一文書を重複して開かない規則（9.1）と揃えるためである。

WebViewのHistory APIには載せない。`history` はWebView単位に1本しかなく、タブごとに分けられないためである。WebView側の履歴を空のまま保てば、`Alt+←` とマウスのサイドボタンはWebViewの履歴を動かさず、`keydown` と `auxclick`（`button` は3と4）としてだけ届く。この2つの入力を自前のスタックへつなぐ。

`pushState` で履歴を積んだ状態では、この2つがWebView側の履歴を動かすことを実測で確認した。`Alt+←` は `popstate` を発火させて `history.state` を1つ前へ戻し、マウスのサイドボタンも同様に動かす。History APIに載せる案を採ると、この既定動作がタブごとの履歴と別に動くため、タブを閉じても履歴エントリが残り、「戻ると閉じた文書へ戻るのか、戻れない理由を出すのか」という判断を別に抱えることになる。

履歴へ積む単位を次のとおり定める。

- 文書の差し替えとアンカーへの移動の両方を1エントリとして積む。入口（本文のリンク、ツリー、パンくず）で区別しない。同じ「タブ内で表示が変わる」操作が入口ごとに違う結果を返さないようにするためである。入口を条件に含めないため、ツリーからの選択を同じタブで開くか別タブで開くかを後から決めても、この規則は変わらない。
- 現在位置と同じ場所（パスとアンカーが一致）は積まない。同じ見出しへのリンクを続けて押しても履歴は伸びない。
- 戻った状態で新しい遷移をしたときは、進む側を捨てる。
- 1タブあたりの上限を50件とし、超えるときは最も古い項目を捨てる。文書とアンカーの両方を積むため、目次の多い文書を行き来すると項目が伸びやすい。50件を超えて遡る操作はツリーから開き直すほうが速い。
- 各エントリはパス、アンカー、その位置を離れた時点のスクロール位置を持つ。
- renameを追跡してエントリのパスを差し替える（6.5）。タブのパスが追従する以上、履歴も同じパスを指し続けなければ、戻ったときに旧パスの読込が失敗する。
- 戻った先の文書を読み込めなかったときは、そのエントリを履歴から取り除く。削除された文書を指すエントリを残すと、戻る／進むのたびに同じ失敗を繰り返す。削除を検知した時点ではなく読込に失敗した時点で取り除くのは、`deleted` の判定がRust側の監視に依存し（6.5）、履歴が独自にファイルの生存を追う必要をなくすためである。

操作は次のとおりとする。検索と同じくWebView内で処理し、ネイティブメニューへは項目を置かない（10.1）。

| 操作 | 入力 |
| --- | --- |
| 戻る | `Alt+←`、マウスのサイドボタン（`auxclick` の `button` が3） |
| 進む | `Alt+→`、マウスのサイドボタン（`auxclick` の `button` が4） |

## 10. UIとアクセシビリティ

- 標準のWindowsタイトルバーを使用する。
- ファイル選択、フォルダー選択、エラー確認にはネイティブダイアログを使用する。
- System、Light、Darkの3テーマを提供する。
- ツリーは矢印、`Enter`、`Home`、`End` で操作できるようにする。左右キーで展開と折りたたみを行う。
- タブは `Ctrl+Tab`、`Ctrl+W`、左右移動に対応する。
- `tree`、`treeitem`、`tablist`、`tab`、`tabpanel` などのARIAを設定する。
- Windowsハイコントラスト、`forced-colors`、`prefers-reduced-motion` に対応する。
- 本文の見出し、リスト、コードブロックの意味構造を保持する。
- 製品UIからsave、print、view source、devtoolsを除外する。

### 10.1 メニューの実装方式と構成

**ネイティブメニューを採る。** 標準タイトルバーを使う方針、OSのアクセシビリティ機構との統合、キーボード操作（`Alt` アクセスキー、矢印、`Esc`、ポップアップのフォーカス管理）の実装コストの点で優位である。`uimock.html` のHTMLメニューバーは視覚上の参考であり、実装方式を決めない。見た目はアプリのテーマ（Light / Dark）ではなくOSの配色に従う。

メニューはRust側が構築し、Frontendからメニューを操作しない。`menu` 系のcapabilityを追加せず、5.5で絞り込んだ集合を保つためである。

コマンドの識別子とアクセラレータの正本は `src-tauri/src/menu.rs` とする。

| メニュー | 項目 | コマンド | アクセラレータ | 処理する側 |
| --- | --- | --- | --- | --- |
| ファイル | フォルダーを開く... | `openFolder` | `Ctrl+O` | Rust（ダイアログ） |
| ファイル | 最近使ったフォルダー | `openRecentFolder` | — | Rust（一覧を実行時に構築。11.1） |
| ファイル | ワークスペースを閉じる | `closeWorkspace` | — | Frontend |
| ファイル | タブを閉じる | `closeTab` | `Ctrl+W` | Frontend |
| ファイル | 終了 | `exit` | — | Rust |
| 表示 | サイドバー | `toggleSidebar` | `Ctrl+B` | Frontend |
| 表示 | 再読み込み | `reloadDocument` | `F5` | Frontend |
| 表示 | テーマ: システム / ライト / ダーク | `useSystemTheme` ほか | — | Frontend（設定はRustが保存） |
| 表示 | 文字を大きく / 小さく / 既定に戻す | `increaseFontSize` ほか | `Ctrl+Equal` / `Ctrl+Minus` / `Ctrl+0` | Frontend |
| 表示 | 言語: システム / 日本語 / English | `useSystemLanguage` ほか | — | Rust（設定を保存し、メニューを組み直す。10.5） |
| ヘルプ | md-peruse について | `about` | — | Rust（バージョンとライセンス一覧。11.3） |

保存、印刷、ソース表示、開発者ツールは置かない（10章）。終了にアクセラレータを割り当てないのは、`Alt+F4` をWindowsが処理するためである。

言語の切り替えをRust側で処理するのは、メニューの項目名そのものを組み直す必要があるためである。テーマの切り替えがFrontendの担当（表示の反映がWebView内で完結する）であるのに対し、言語はネイティブメニューとネイティブダイアログの文言を変える。

「再読み込み」は監視のバッファあふれや監視停止（`WatcherStopped`）からの回復手段として置く。自動追従が効かない状況で、ユーザーが取れる唯一の行動だからである（6.4）。

アクセラレータの表記は、Tauriが内部で使う `muda` の形式に従う。キーはW3Cの `KeyboardEvent.code` に対応する名前であり、`Plus` のような記号名は受け付けない。Tauriはパースに失敗した文字列を無言で捨て、アクセラレータなしの項目として登録する。ビルドもテストも通り、実行するまで「効かないショートカット」に気づけないため、すべての割り当てを実際のパーサーへ通すテスト（`accelerators_are_parsable`）で固定する。パーサーが何でも受け入れるようになった場合に備え、既知の無効な表記で反証も取る。

文字サイズの拡大は `Ctrl+Equal`（`=` キー）とする。`muda` のアクセラレータは修飾キーを厳密に見るため、1つの項目で `Ctrl+=` と `Ctrl+Shift+=`（`Ctrl` + `+`）の両方は表せない。メニューには代表として `Ctrl+Equal` を表示し、`Ctrl+Shift+Equal` とテンキーの `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` / `Ctrl+Numpad0` はWebView内で同じ操作へ割り当てる。

`Ctrl` + `=` / `-` / `0` をアプリへ割り当てるため、WebViewのズームホットキーは無効にする。有効なままだと、WebView全体の拡大とプレビュー本文の拡大が同じキーで二重に起きる。本文だけを拡大する方針（10.3）を保つための措置であり、設定はwebview側で行う。

タブの移動（`Ctrl+Tab`、`Ctrl+Shift+Tab`）とツリーの操作（矢印、`Enter`、`Home`、`End`）はメニュー項目を持たず、WebView内で処理する。メニューに現れない操作のアクセラレータをネイティブ側で登録すると、フォーカスのある要素へキーが届かなくなるためである。

文書内検索（8.6）と戻る／進む（9.3）も同じ扱いとし、メニュー項目を置かない。検索は検索欄が文字入力を受け取り、`Ctrl+F` のほかに `Esc`、`Enter`、`F3` を扱うため、ネイティブ側へ登録するとフォーカス中の入力欄へキーが届かない。戻る／進むはマウスのサイドボタンという非メニュー経路が主であり、キーとマウスの両方をWebView内の1か所で扱うほうが、履歴を動かす経路が1本に収まる。

### 10.1.1 パンくず

- セグメントを選ぶと、サイドバーのツリーでそのフォルダーを展開し、フォーカスを移す。ワークスペースは切り替えない。
- 最終セグメント（表示中の文書）は選択済みであり、操作しても何も起きない。
- サイドバーが非表示のときは、サイドバーを表示してから展開する。ユーザーの意図はその階層を見ることであり、非表示のまま無反応にすると壊れているように見える。
- 深い階層の文書から親フォルダーへ戻る操作を1手で行えるようにするのが目的である。ポップアップで兄弟ファイルを一覧する案は採らない。ポップアップのキーボード操作とARIAを自前で実装することになり、ネイティブメニューを選んだ理由と矛盾する。

### 10.2 ペイン境界の操作

- `role="separator"`、`aria-orientation="vertical"`、`aria-valuenow`、`aria-valuemin`、`aria-valuemax`、`tabindex="0"` を設定する。
- 左右キーで幅を変更し、`Shift` 併用で大きく動かす。`Home` と `End` で最小幅と最大幅へ移動する。
- サイドバーの表示切り替えは幅の値とは独立した状態として保持する。

幅の範囲と刻みを次のとおり確定する。値と規則の正本は `src/state/sidebar-width.ts` とする。既定値の正本は `src-tauri/src/settings.rs` の `DEFAULT_SIDEBAR_WIDTH` であり、範囲と刻みはUIの関心事のためFrontend側へ置く。

| 項目 | 値 |
| --- | --- |
| 最小幅 | 200 px |
| 最大幅 | `min(600 px, ウィンドウ幅の50 %)` |
| 左右キーの刻み | 16 px |
| `Shift` 併用の刻み | 64 px |

最大幅にウィンドウ幅由来の上限を併せるのは、幅の狭いウィンドウで本文が潰れるのを防ぐためである。800 pxのウィンドウで600 pxのサイドバーを許すと、本文は200 pxしか残らない。割合による上限が最小幅を下回る場合は最小幅を採る。極端に狭いウィンドウでサイドバーを操作できない状態にしないためであり、そこまで狭ければ何を選んでも本文は読めない。

ウィンドウを縮めて上限を下回ったときは表示だけを詰め、設定へは書き戻さない。広げ直したときに元の幅へ復帰させるためである。したがって「保存値」と「実効値」の2つを区別して持つ。`aria-valuemax` にはウィンドウ幅に応じた実効値を伝える。

設定ファイルに範囲外の値が入っていた場合（手で編集された場合など）は、読み込み時に範囲へ収める。
- 確定した幅をDOMへ反映する手段は、CSPの `style-src-attr 'none'` に従う（5.5）。インラインの `style` 属性は使えないため、`style` 要素へCSSカスタムプロパティを書き込む。

### 10.3 文字サイズ

- 変更対象はプレビュー本文とし、ツリーとメニューはOSのスケーリングに従う。
- メニューのアクセラレータは `Ctrl+Equal` / `Ctrl+Minus` / `Ctrl+0` とする。`Ctrl+Shift+Equal` とテンキーの `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` / `Ctrl+Numpad0` はWebView内で同じ操作へ割り当てる（10.1）。
- 文字サイズの反映もペイン幅と同じく `style` 要素へのCSSカスタムプロパティで行う（10.2、5.5）。

倍率の段階を `80 / 90 / 100 / 110 / 125 / 150 / 175 / 200 %` の8段階とする。正本は `src/state/font-scale.ts` とする。

等間隔ではなく大きい側ほど粗く刻むのは、人の知覚が相対変化に反応するためである。150 %から160 %への変化はほとんど見分けられない一方、80 %から90 %は明確に違う。ブラウザのズームと同じ感覚で使え、端から端まで7回の操作で移動できる。等間隔10ポイント刻み（13段階）では12回を要し、大きい側では1段階の変化が見分けにくい。

段階のどれにも一致しない値（設定ファイルが手で編集された場合や、段階の並びを変えた後に古い設定を読んだ場合）は、最も近い段階へ丸める。等距離のときは小さいほうを選ぶ。読みやすさを損なう側へ倒さないためである。

### 10.4 ドラッグ＆ドロップ

**単一ファイルと単一フォルダーのドラッグ＆ドロップを初期版へ含める。** 受け入れ規則の正本は `src-tauri/src/drop.rs` の `plan_drop` とする。

| ドロップされたもの | 扱い |
| --- | --- |
| 対象拡張子（6.3）のファイル | タブで開く。複数あればすべて開き、最後の1つをアクティブにする |
| フォルダー | ワークスペースとして開く。複数あれば最初の1つだけを採る |
| 上記の混在 | フォルダーを開いてからファイルを開く |
| 対象外のファイルだけ | 何もしない |

ファイルの扱いは関連付け起動と同じ規則（9.2）とし、`files_to_open` をそのまま使う。対象拡張子だけを渡された順で開き、同値は1つにまとめる。ファイルを開く経路が起動引数とドロップで違う結果を返さないようにするためである。上限を超える分は9.1の退避規則で受け入れる。

フォルダーを開く操作は「フォルダーを開く」（10.1）と同じ扱いとし、Watcher、探索キャッシュ、通常タブ、loose tabを破棄して切り替える（6.1）。混在したドロップでフォルダーを先に開くのは、順序が逆だと同じドロップで開いたファイルが切り替えで破棄されるためである。

フォルダーを2つ以上ドロップされたときに最初の1つだけを採るのは、ウィンドウとワークスペースがそれぞれ1つ（6.1、9.1）であり、2つ目を開いても1つ目を捨てることにしかならないためである。「最初の1つ」はドロップに含まれる並び順であり、これはCF_HDROPの並びで決まる。エクスプローラーの表示順とも選択順とも一致しない（実測。表示順が `sub` / `a.md` / `c.markdown` / `note.txt` のフォルダーで全選択したとき、届いた並びは `a.md` / `c.markdown` / `note.txt` / `sub` だった）。利用者が並びを予測できないため、複数フォルダーのドロップは意図の定まった操作として扱わない。

ワークスペース外のMarkdownファイルをドロップされたときはloose tab（9.1）で開く。ドロップも関連付け起動も、利用者が明示的に渡したファイルである点で同質だからである。文書内のリンク（信頼できない入力）との境界は変えない（7.2）。

ドロップ先の領域（サイドバー、プレビュー、タブバー）によって処理を変えない。同じ「アプリへファイルを渡す」操作が、落とした場所によって違う結果を返さないようにするためである。履歴へ積む単位を入口で区別しない判断（9.3）と同じ理由による。

#### 受け取りと表示

ドロップされたパスはRust側が受け取り、Frontendへ渡さない。`tauri://drag-drop` はネイティブ絶対パスを運ぶため、Frontendでlistenすると「ネイティブ絶対パスをFrontendのURLまたはDOMへ露出しない」（7.1）を破る。Frontendへ渡すのは `DragState`（5.3）だけとし、パスも座標も渡さない。

ドラッグ中はオーバーレイを表示し、受け入れるかどうかをその場で示す。`tauri://drag-enter` の時点でパスが届くため、手を離す前に可否が決まる。表示が必要なのは、対象外のファイルでもドラッグ中のカーソルが常に「コピー可」になるためである。wryのWindows実装はCF_HDROPを取得できた時点で `DROPEFFECT_COPY` を返し、通知先の判断を待たない（wry 0.55.1の実装、および実測）。カーソルで拒否を示せない分をアプリのUIで補わなければ、受け入れられるように見えて何も起きない操作が残る。

`DragState` の遷移は次のとおりとする。`enter` で種別を判定し、`over` では判定し直さない。`over` はマウス移動のたびに届き（実測。1回のドラッグで70件以上）、パスを含まないためである。

| イベント | `DragState` |
| --- | --- |
| `tauri://drag-enter` | `plan_drop` が空でなければ `Acceptable`、空なら `Rejected` |
| `tauri://drag-over` | 変えない |
| `tauri://drag-leave` | `Idle` |
| `tauri://drag-drop` | `Idle`。`plan_drop` の結果を実行する |

種別の判定にはファイルシステムへの問い合わせ（`is_dir`）が要る。`docs.md` という名前のフォルダーは拡張子の判定では対象ファイルに見えるためである（6.3の判定はディレクトリ名を見ない）。問い合わせは `enter` で1回だけ行う。

#### 実測（Tauri 2.11.5、wry 0.55.1、WebView2 Runtime 152.0.4191.53）

- `tauri://drag-enter` / `drag-over` / `drag-drop` は、5.5で確定したcapabilityのまま受け取れる。ドラッグ＆ドロップのために追加する権限はない。
- ファイルもフォルダーも同じ形式（絶対パスの配列）で届き、種別の区別は付かない。
- 複数選択のドロップは、1つのイベントに全パスが入って届く。
- 対象外の拡張子もそのまま届く。受け取ってから捨てる以外の方法がない。
- ブラウザーからテキストをドラッグしてもイベントは発火しなかった。wryがCF_HDROPだけを扱い、それ以外の形式を `DV_E_FORMATETC` として無視するためである（wry 0.55.1の実装）。同じ理由で、仮想ファイル（Outlookの添付、zip内のファイル）も届かないと考えられる。これらは実測していない。ファイルシステム上に実体を持つものだけが届く前提で設計する。
- HTML5の `dragenter` / `dragover` / `drop` はWebViewへ届かない。Tauriの `dragDropEnabled` が既定で有効なためである。無効化するとHTML5側は使えるようになるが、WebView2の `File` からはフルパスを取得できず、この機能の目的を満たさない。
- MSIX（packaged classic app、`mediumIL`）でも同じように動作する。エクスプローラーからファイルとフォルダーをドロップし、いずれもパスが届くことを確認した（13.4）。

### 10.5 UI言語

**日本語と英語を初期版へ含める。** 言語の型と解決規則の正本は `src-tauri/src/i18n.rs` とする。

`LanguagePreference`（`system` / `ja` / `en`）を設定として保存し、既定は `system` とする。`system` のときはOSの表示言語の一次サブタグで決め、`ja` なら日本語、それ以外は英語とする。対応しない言語で英語へ倒すのは、その言語圏の利用者にとって英語のほうが読める見込みが高いためである。日本語を既定にすると、日本語を読めない利用者へ読めないUIが出る。

選択はメニューから切り替える（10.1）。配色テーマと同じく、設定値（`LanguagePreference`）と実際の値（`Language`）を別の型で表す。起動時の値はFrontendへ `UiSettings`（`language` と `effectiveLanguage`）として渡し、切り替えは `LanguageChangedEvent`（5.3）で通知する。

イベントを設ける理由は、言語の切り替えをRust側で処理する（10.1）ためである。メニューの項目名を組み直す必要からRustが受け口になっており、Frontendはコマンドを受け取らない。起動時の投影だけではWebView内の文言が旧言語のまま残る。切り替えの契機がOSではなくアプリ内の操作である点で、配色の `ThemeChangedEvent`（OSの設定変更の通知）とは通知の向きが異なるが、Frontendから見れば「実効値が外から変わったので描き直す」という同じ扱いになる。

OSの表示言語そのものは監視しない。変更にはサインアウトを要し、アプリの実行中に変わらないためである。したがって `LanguageChangedEvent` が飛ぶのはメニューからの切り替えのときだけであり、`system` を選んでいる間にイベントが飛ぶことはない。

文言はRust側とFrontend側の双方が持つ。

| 文言 | 持つ側 |
| --- | --- |
| ネイティブメニューの項目名（10.1） | Rust |
| ネイティブダイアログのタイトルと本文 | Rust |
| `IpcError.message`（5.3） | Rust |
| WebView内のUI（welcome、検索バー、エラー表示、Aboutの本文） | Frontend |

`IpcError.message` をRust側が現在の言語で組み立てるのは、ネイティブメニューとネイティブダイアログの文言をどのみちRust側が持つためである。IPCが成立しない場面（WebView2 Runtimeの欠落。12章）の表示もRust側で行う以上、辞書を両側へ分けると同じ文言が二重になる。言語を切り替える直前に発行した要求の応答は旧言語のまま届きうるが、これは受け入れる。エラー表示は一時的であり、同じ操作をやり直せば新しい言語になる。応答へ言語を添えてFrontendが捨てる仕組みは、失敗の表示のために往復を増やす割に得るものがない。

言語ごとの文言表は `Record<Language, …>` の形で持ち、言語を増やしたときの不足を `tsc --noEmit` が検出できるようにする。`src/types/error.ts` の `RETRYABLE` を `Record<ErrorCode, boolean>` として定義したのと同じ理由による（5.3）。Rust側は列挙に対する `match` の網羅性検査で同じ保証を得る。

UI文字列を外部のi18nライブラリへ載せない。対象は2言語であり、複数形や語順の入れ替えを要する文言も持たない。読み込み時に辞書を選ぶだけで足り、ライブラリの導入は依存とCSPの検討を増やすほうが大きい。

MSIXマニフェストの `<Resource Language>` は `ja-JP` と `en-US` の両方を宣言したまま保つ（13.1）。宣言と実体が揃う。

## 11. アプリ設定と診断

### 11.1 設定の保存

- 保存先はTauriが返すアプリ設定ディレクトリとする。MSIX環境ではアプリが取得するパスは `%APPDATA%\com.scottlz0310.md-peruse` のままだが、実際の読み書きはWindowsがパッケージごとの領域へリダイレクトする。アンインストール時に設定も併せて削除される。WinRTの `ApplicationData` APIを使う必要はない（13.4）。
- 形式はJSONとし、`schemaVersion` を持つ。
- 未知のキーは読み捨てる。破損時は既定値で起動し、破損ファイルを退避したうえで通知する。
- 書込みはdebounceし、終了時にflushする。アイドル時に周期的な書込みを行わない。
- 書込みは一時ファイルへ書いてからrenameし、途中終了で設定を失わないようにする。

スキーマの正本は `src-tauri/src/settings.rs` とする。読み書きはRust側が担い、TypeScriptの定義は `ts-rs` で生成する（5.3）。Frontendに設定ファイルを直接読み書きさせないのは、`fs` 系のcapabilityを追加せずに済ませるため（5.5）と、一時ファイルへ書いてrenameする書込みと破損時の退避をOSのAPIで素直に書けるためである。

保存対象と非保存対象を次のとおりとする。

| 状態 | 扱い |
| --- | --- |
| テーマ | 保存する。`system` / `light` / `dark` の3値 |
| UI言語 | 保存する。`system` / `ja` / `en` の3値（10.5） |
| サイドバー幅 | 保存する |
| サイドバー表示状態 | 保存する。幅とは独立に保持する（10.2） |
| 文字サイズ | 保存する |
| ウィンドウ位置とサイズ | 保存する。最大化状態も含める |
| 最近使ったフォルダー | 保存する。最大10件 |
| 最後のワークスペース | 保存する |
| 開いているタブ、選択中ファイル、スクロール位置 | 保存しない |

テーマの設定値は `ThemePreference` とし、IPCの `Theme`（5.3）と同じ型で表さない。前者はユーザーの選択（`system` を含む3値）、後者はOSから得た実際の配色（2値）であり、`system` を選んだときの実際の配色は `ThemeChangedEvent` で受け取るためである。

`schemaVersion` は現在 1 とする。読み込んだ値が現在より小さいときはマイグレーションし、大きいとき（新しい版が書いたファイルを古い版が読んだとき）は既定値で起動し、破損時と同じ手順で退避する。未知のキーを落としたまま起動すると、次の書込みで新しい版の設定を破壊するためである。

#### Frontendへ渡す投影

`Settings` をそのままFrontendへ渡さない。「最近使ったフォルダー」と「最後のワークスペース」はワークスペースルート自身であり、ツリーの `FileNode` のように相対パスへ落とせないためである。7.1の「ネイティブ絶対パスをFrontendのURLまたはDOMへ露出しない」に例外を設けず、Frontendへは `UiSettings` を渡す。

| 状態 | Frontendへの渡し方 |
| --- | --- |
| テーマ、UI言語、サイドバー幅、サイドバー表示状態、文字サイズ | 値をそのまま渡す。UI言語は選択（`LanguagePreference`）と実際の言語（`Language`）の両方を渡す。切り替え後の値は `LanguageChangedEvent` で通知する（10.5） |
| 最近使ったフォルダー | 不透明なIDと表示ラベル（`RecentFolderView`）を渡す。絶対パスは渡さない |
| 最後のワークスペース | 渡さない。起動時にRust側が開き直す |
| ウィンドウ位置とサイズ | 渡さない。Rust側がウィンドウへ適用する |

IDはプロセス内でのみ有効な不透明値とし、対応表はRust側が保持する。設定ファイルへは保存しない。Frontendから受け取ったIDは5.3の原則どおり再検証し、未知のIDは `RecentFolderNotFound` で拒否する。値に意味を持たせず、Rust側の再検証を前提とする点は画像resource ID（5.4）と同じ考え方である。フォルダーそのものが移動または削除されている場合は `WorkspaceNotFound` とし、一覧を取り直せば解消する前者と区別する。

表示ラベルは絶対パスの末尾2コンポーネント（親フォルダー名とフォルダー名）に限る。フォルダー名だけでは同名のフォルダーを区別できず、絶対パス全体は渡せないためである。規則は `recent_folder_label` を正本とする。

一覧は新しいものが先頭で最大10件とし、同じフォルダーを開き直したときは既存の項目を先頭へ移す。件数の上限は、これ以上並べても一覧から選ぶより開き直すほうが速いという判断による。規則は `push_recent_folder` を正本とし、比較は7.1の境界判定と同じ正規化を済ませた絶対パスで行う。

サイドバー幅と文字サイズの既定値は280 pxと100 %とする。前者は10.2で確定した範囲（200 px以上、`min(600 px, ウィンドウ幅の50 %)` 以下）の内側にあり、後者は10.3で確定した段階の1つである。既定値の正本は `src-tauri/src/settings.rs`、範囲と段階の正本は `src/state/sidebar-width.ts` と `src/state/font-scale.ts` である。正本が言語をまたぐため相互に参照できないので、既定値が範囲と段階に収まることを `settings.rs` でコンパイル時に固定する。範囲や段階を変えるときは、ここが既定値の見直しを促す。

### 11.2 診断

- 既定ではファイルログを出力しない。アイドル時のディスクI/Oを行わない方針と整合させるためである。
- 明示的な診断モードで起動したときだけ、ローカルデータ領域へログを出力する。
- ログを外部へ送信しない。Microsoft Store版のカスタムイベント（11.4）はイベント名だけを送るものであり、ログの内容を含まない。
- ログにはワークスペースルートからの相対パスを記録し、ユーザー名を含む絶対パスを既定で記録しない。

### 11.3 ライセンス表記

- 同梱するJavaScript依存関係とRust crateのライセンス一覧を生成し、アプリから参照できる形で同梱する。
- 再配布するアセットのライセンス表記を漏らさない。KaTeXはMathML出力としフォントを同梱しないため、フォントは対象に含まれない（8.5）。

生成手段はPhase 2で次のとおり確定した。

| 対象 | 手段 |
| --- | --- |
| JavaScript | `scripts/generate-licenses.ts`（Bunで実行）が `package.json` の `dependencies` から推移閉包を辿り、`node_modules` のメタデータとライセンスファイルを収集する |
| 条文を同梱しないパッケージ | `licenses/overrides/<パッケージ名>/` へ上流の条文を配置し、それも無ければ生成を失敗させる |
| Rust | `cargo-about` が `src-tauri/about.toml` の設定で依存crateのライセンス本文を収集する |
| 出力 | `src/generated/third-party-licenses.json`。リポジトリへコミットせず、lockfileから都度生成する |
| 検査 | CIの `Licenses` ジョブが生成を実行し、条文を取得できないパッケージがあれば失敗する |

判断の理由は次のとおり。

- ライセンス本文まで収集する。MITやBSDは著作権表示とライセンス文の同梱を条件とするため、SPDX識別子の一覧では要件を満たさない。`cargo-license` を採らなかったのはこのため。
- SPDXのtag-valueファイル（`LICENSE.spdx` 等）は本文として扱わない。`PackageLicenseDeclared` などのメタデータだけで条文を含まないため、本文として数えると条文の欠落を見逃す。実際に `@tauri-apps/plugin-opener` は `LICENSE.spdx` しか同梱していない。
- 条文を取得できないパッケージは生成を失敗させる。配布物へ含める条件を満たせないまま出荷しないため。上流が同梱しない場合は `licenses/overrides/` へ本文を配置して解消する。
- 対象を配布物に含まれる依存へ限る。JavaScript側は `dependencies` とその推移閉包のみを辿り、Rust側は `about.toml` でbuild依存とdev依存を除外する。
- 許容ライセンスを `about.toml` の `accepted` へ列挙する。未列挙のライセンスを持つcrateが増えると生成が失敗するため、依存追加時にライセンスを確認する強制力を持つ。
- 生成物をリポジトリへコミットしない。バージョンの正本を `bun.lock` と `Cargo.lock` の1か所へ寄せ、生成物はそこから都度導出する。当初は生成物をコミットし `git diff --exit-code` で最新かを検査していたが、Renovateが依存を更新してもlockfileしか書き換えないため、依存更新のPull Requestが例外なく `Licenses` ジョブで失敗した（[#32](https://github.com/scottlz0310/md-peruse/pull/32) で顕在化）。バージョンを2か所で持つ限り、生成物を手で追随させるか自動マージを諦めるかの二択になる。導出へ変えれば不整合が構造として生じない。
- 差分でライセンスの増減が見えなくなる点は、生成の失敗で代替する。条文を取得できないパッケージがあれば生成自体が失敗するため、未知の依存が黙って入ることはない。Rust側は `about.toml` の `accepted` が未列挙のライセンスも検出する。JavaScript側に同等のライセンス種別allowlistがないことは残る穴であり、`tasks.md` の「検討待ち」へ記録する。
- 生成をビルド工程へ組み込むかはPhase 4で決める。現時点で生成物を参照するコードはなく、`bun run build` へ組み込むと `Frontend` と `Rust` の両ジョブにもcargo-aboutの導入が要る。アプリ内でライセンス一覧を表示する実装（下記）と同時に、生成のタイミングとジョブ構成を決める。
- JavaScript側に既製ツールを使わない。主要なツールはnpmのnode_modulesレイアウトとCLIに依存し、Bunでの動作保証がない。走査するのは `package.json` とライセンスファイルだけで、実装は小さい。
- ライセンス本文を `licenseTexts` へ集約し、各パッケージはインデックスで参照する。同じ本文を多数のcrateが共有するため、パッケージごとに本文を持たせると生成物が数MBに達し、バンドルサイズと依存更新時の差分の両方を悪化させる。

アプリ内での表示はPhase 4のUI実装で行う。

### 11.4 Store向けカスタムイベント

Microsoft Store版の初回リリースから、利用状況の基準値を取るカスタムイベントを送る（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）。送信経路の成立は13.5で確認済みであり、本節はイベント名、発火条件、データ最小化、失敗時の挙動、Store版限定条件を定める。イベントの集合と送信単位の規則の正本は `src-tauri/src/telemetry.rs` とする。

これは11.2の診断方針および `spec.md` 5.5「アプリからのネットワーク通信を行わない」に対する明示的な例外であり、Microsoft Store版に限る。例外の範囲を次のとおり限定する。

- 送るのはイベント名だけで、パラメータを持たせない。
- 送信先はMicrosoft Storeの計測基盤に限る。アプリが独自のエンドポイントへ通信しない。
- 送信経路はWinRTのin-process activationであり、WebViewからのHTTPS通信を伴わない。CSPとcapabilityは5.5の値のままである（13.5）。

#### イベントと発火条件

| イベント名 | 発火条件 | 分かること |
| --- | --- | --- |
| `session_start` | プロセスの起動時 | すべての率の分母 |
| `open_md_ok` | Markdownの描画が完了したとき | 目的の達成 |
| `open_md_fail` | 描画できずに失敗を表示したとき | 目的の未達 |
| `open_folder` | ワークスペースを開いたとき | フォルダー中心の利用 |
| `launch_by_association` | 関連付け起動でファイルを受け取ったとき | 関連付けの定着 |

**5つすべてをセッション単位とし、1セッションにつき1回だけ送る。** どの率も `session_start` を分母としてそのまま読めるようにするためである。発生ごとに送るイベントが1つでも混ざると、その系列だけが100 %を超えうる。Partner Center側には件数しか残らないため、後から分母を推定し直すこともできない。

この統一により、次の読み方が成立する。

- 起動して何もせず閉じた割合 = 1 − `open_md_ok` / `session_start`
- 失敗を経験したセッションの割合 = `open_md_fail` / `session_start`
- 関連付けから始まったセッションの割合 = `launch_by_association` / `session_start`

代償として、1セッションでタブを何枚開いたかという利用量は測れない。イベントを5種類から増やさない制約の下では達成率と利用量は両立しないため、「Markdownを実際に開けたか」の達成率を採る（[#21](https://github.com/scottlz0310/md-peruse/issues/21) の決定事項）。

シングルインスタンス（9.2）のため、2つ目以降のファイルは既存ウィンドウのタブとして開く。この経路では新しいセッションが始まらないので、`session_start` と `launch_by_association` を送らない。タブ追加でも送る設計にすると、1回の起動で複数のファイルを関連付けから開いたときに `launch_by_association / session_start` が100 %を超える。タブ起動では常用パターンとなるため必ず起きる。

`open_md_ok` は、ファイルを選んだ時点ではなく描画の完了時に送る。読込に成功しても描画で失敗する経路（Mermaid、KaTeX、sanitizeの失敗）があり、選択時に送ると達成数を過大に数える。描画の完了はFrontendが知るため、Frontendからcommandで伝える。Frontend発のeventは使わない（5.5）。

キャンセルと失敗では成功イベントを送らない。フォルダー選択ダイアログを閉じただけのときに `open_folder` を送らず、読込や描画に失敗したときに `open_md_ok` を送らない。

#### データ最小化

イベント名以外を送らない。`StoreServicesCustomEventLogger.Log()` は文字列1つを受け取るため、この形が要件をそのまま満たす。ファイルパス、ファイル名、本文、ワークスペース情報、ユーザー名、端末識別子のいずれも含めない。

`open_md_fail` に失敗の原因（`ErrorCode`）を添えない。原因の内訳は診断（11.2）の関心であり、送信するとイベント名が原因の数だけ増えて「5種類から増やさない」制約と衝突する。

#### 失敗時の挙動

送信の失敗を無視する。ログにも残さない（11.2）。`StoreServicesCustomEventLogger` の取得と `Log()` の失敗はHRESULTとして返り、例外やプロセス終了にはならない（13.5）。再送しない。エラーを上位へ伝播させる原則（12章）はユーザーの操作に対する失敗を対象とし、テレメトリはユーザーが要求した操作ではないため、この原則の対象外とする。

ファイル・フォルダー操作の成否を、テレメトリの成否へ依存させない。送信は操作の完了後に行い、送信の結果を操作の結果へ反映しない。

#### Store版限定条件

パッケージIDを持たない実行では送信経路そのものが成立しない。`bun run tauri dev` を含む非パッケージ実行では `GetDefault()` が `0x80040154` で失敗する（13.5）。「開発版・テスト環境で本番イベントを送信しない」という要件は、失敗を無視するだけで自然に満たされる。判定のための分岐や環境変数を持たない。

将来のSDK更新で経路が失われた場合は、イベントなしで提出する。この機能がStore提出をブロックしない（13.5）。

#### 計測定義

Partner CenterのUsage reportとの照合、反映遅延、パッケージバージョン別フィルター、および診断データをオプトインした端末に限られる母集団の偏りは、実データを確認できるPhase 5で確定する（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）。母集団が偏るため、率は読めてもインストール数へは接続できない。

## 12. エラー方針

次の失敗では原因と対象を表示し、握りつぶさない。

- WebView2 Runtimeの欠落または初期化失敗
- フォルダー選択失敗、アクセス拒否
- Markdownのデコード失敗、サイズ上限超過
- 画像の境界違反、サイズ超過、ピクセル寸法超過、読込失敗
- Mermaid、lowlight、KaTeXの描画失敗とlazy importの失敗
- Mermaidの図と数式が処理上限を超え、描画しなかったこと（8.4、8.5）
- ファイルの削除、移動、置換、共有違反
- Watcherのバッファオーバーフローまたは監視停止
- 設定ファイルの破損
- MSIXのPackage IdentityまたはRuntime初期化失敗

コードブロックのハイライト上限の超過はここへ含めない。8.3の定めにより、超過したブロックはハイライトせずプレーンな `pre/code` として表示し、選択とコピーも変わらず行える。本文の内容は失われず、利用者が対処する余地もないため、理由を示す対象としない。Mermaidと数式は描画そのものを行わないため、何が起きたかを示す必要がある。

自動的な無限リトライや暗黙の代替処理は行わない。再試行可能な操作では、ユーザーが明示的に再実行できるようにする。6.5で選択した場合のatomic replace再読込だけを、明文化された限定的な例外とする。

Store向けカスタムイベント（11.4）の送信失敗は、本章の対象としない。ユーザーが要求した操作ではないため、原因を示しても取れる行動がなく、通知は操作の妨げにしかならない。失敗は無視し、再送もしない。

エラー表示の場所を次のとおり使い分ける。

| 範囲 | 表示場所 |
| --- | --- |
| アプリ全体の起動失敗 | ネイティブダイアログ |
| ワークスペース単位の失敗 | プレビュー領域全体 |
| ツリー項目単位の失敗 | 該当項目のインライン表示 |
| 文書内の要素単位の失敗 | 該当要素の位置へのインライン表示 |

## 13. パッケージングとStore

- Tauri CLIのRelease出力をx64とARM64で生成する。
- winapp CLIでアーキテクチャ別MSIXを生成する。
- `Package.appxmanifest`、Identity、Publisher、Version、Assetsをリポジトリで管理する。
- Tauri実行ファイルをpackaged classic app、`mediumIL` として登録し、必要な `runFullTrust` を宣言する。
- `broadFileSystemAccess` は宣言せず、ユーザー権限と明示的に選択されたワークスペース境界でアクセスする。
- ローカルとWACK用に自己署名し、製品配布ではStore署名を利用する。
- Tauri Updaterを組み込まない。
- Storeへ提出したartifactと、CIで検証したartifactを一致させる。
- Store Submission APIの実行前に手動承認ゲートを設ける。
- Storeへの提出、認証、公開を別々の状態として記録する。

補足として次を定める。

- Package Versionは `MAJOR.MINOR.PATCH.0` とし、第4要素はStoreの予約により常に0とする。バージョン規約は[spec.md](./spec.md)を正本とする。
- 必要なvisual asset（各サイズのタイル、ストアロゴ、スプラッシュ）の一覧と生成方法をリポジトリで管理し、手作業での差し替えを避ける。
- Partner Centerの予約名、Identity、Publisher、Publisher Display Nameがマニフェストと一致することを提出前に検証する。
- データ収集を行わない旨の申告とプライバシーポリシーの提示先を、初回提出前に確定する。
- Store Submission APIについては、利用するAPIのバージョン、認証方式、MSIXパッケージフローへの対応状況をPhase 5の着手時点で確認する。API仕様の変更を前提に、手動提出の手順書も維持する。
- winapp CLIへの依存はCIで固定バージョンとする。4.5に記録したとおり、makeappxへ切り替え可能な状態を保つ。

MSIX技術スパイクでは、BunとWinGet版winapp CLIだけで完結できるか、Node.jsがビルド時依存として必要かを確認する。

### 13.1 スパイクで確定した構成

Phase 1のスパイクで次を確定した。

| 項目 | 確定値 |
| --- | --- |
| Identity Name | `scottlz0310.md-peruse` |
| Publisher | `CN=39FB3D39-1F1A-4B82-B081-47469FD12CA6` |
| PublisherDisplayName | `scottlz0310` |
| Package Family Name | `scottlz0310.md-peruse_r99jq8jxntmym` |
| Microsoft Store ID | `9P35BW61FN4W` |
| Package Version | `MAJOR.MINOR.PATCH.0`（`tauri.conf.json` の `version` に `.0` を付与して生成） |
| TargetDeviceFamily | `Windows.Desktop`、MinVersion `10.0.22000.0`、MaxVersionTested `10.0.26100.0` |
| Application | `EntryPoint="Windows.FullTrustApplication"`、`uap10:RuntimeBehavior="packagedClassicApp"`、`uap10:TrustLevel="mediumIL"` |
| Capability | `rescap:Capability Name="runFullTrust"` のみ。`broadFileSystemAccess` は宣言しない |
| 関連付け | `windows.fileTypeAssociation` で `.md` と `.markdown` |
| winapp CLI | 0.6.1（WinGet `Microsoft.WinAppCli`） |

マニフェストは `packaging/Package.appxmanifest.template` を正本とし、`scripts/build-msix.ps1` が `ProcessorArchitecture` と `Version` を置換して生成する。アーキテクチャごとに別のマニフェストを保守しない。

visual assetの原本は2点とし、いずれも手作業でのリサイズは行わない。

| 原本 | 寸法 | 生成対象 | 生成手段 | 生成物の扱い |
| --- | --- | --- | --- | --- |
| `assets/app-icon.png` | 1024x1024 | 正方形アイコン一式、`icon.ico`、各Squareロゴ、StoreLogo | `bun run tauri icon assets/app-icon.png` | `src-tauri/icons` へコミットする |
| `assets/wide-logo.png` | 3100x1500（比率2.0667） | `Wide310x150Logo.png` | `scripts/generate-wide-logo.ps1` | コミットせず、パッケージレイアウトへ直接生成する |

`tauri icon` は正方形しか生成しないため、横長タイルは専用スクリプトで生成する。スクリプトは原本の比率が2.0667から外れていれば失敗し、引き伸ばされた画像がパッケージへ入ることを防ぐ。

横長タイルの生成物はリポジトリへ置かず、`scripts/build-msix.ps1` がパッケージレイアウトへ直接出力する。生成物をコミットすると、原本を更新したあとに生成を忘れた場合に古いロゴを梱包し得る。生成を毎回パッケージ工程で行えば、この乖離は原理的に起きない。

正方形アイコンは `tauri icon` の生成物を `src-tauri/icons` へコミットする。Tauriのビルドと開発時の実行が同じディレクトリを参照するためである。この系統は原本と生成物が乖離し得るため、`scripts/check-icons.ts` が一時ディレクトリへ再生成してコミット済みのファイルとバイト比較し、CIの `Frontend` ジョブとpre-commitで検査する。

検査の設計は次の実測に基づく。

- `tauri icon` の出力のうち、PNG各種と `icon.ico` は同一入力に対して決定的である。一方 `icon.icns`（macOS向け）は同一入力でも実行ごとに内容が変わるため、バイト比較には使えない。
- 比較対象はコミット済みのファイルに限る。`icon.icns`、`android`、`ios` は対象プラットフォームがWindowsのみのため元からコミットしておらず、非決定性の問題も同時に避けられる。
- 検査はRustのビルドを伴わず `@tauri-apps/cli` だけで完結するため、`Frontend` ジョブで実行する。所要は6秒程度。

`uap:DefaultTile` に `Square310x310Logo` を指定する場合、`Wide310x150Logo` の同時指定がMSIXのマニフェスト検証で必須となる。両方を指定している。

ただしWindows 11のスタートメニューはアイコン表示のみで、Windows 10のライブタイルは廃止されている。そのため `Wide310x150Logo` と `Square310x310Logo` は現行OSの画面上では使われない。マニフェスト検証の要件を満たすことと、Store掲載時の資産としての完全性のために保持する。

`BackgroundColor` はアイコンの角丸の外側と、透過部分の背景として使われる。値はアイコンとワイドロゴから実測した濃紺 `#111958`（アイコン左下の実測値。ワイドロゴ背景の `#132148` と近い）とする。

### 13.2 ビルド時依存の境界

ARM64はx64ホストからのクロスコンパイル（`aarch64-pc-windows-msvc`）で生成する。ネイティブARM64ランナーは使用しない。x64とARM64の両方で `tauri build` が成功し、生成したMSIXのサイズはそれぞれ約1.4MBである。

MSIXの生成にNode.jsは不要である。Bun、Rustツールチェーン、winapp CLI、Windows SDKだけで完結する。winapp CLIは内部でWindows SDKの `makeappx` と `signtool` を呼び出す。

### 13.3 スパイクの実測結果（x64、Windows 11 26200）

MSIXをインストールして測定した。測定時点のアプリはスケルトンであり、Markdown描画、Mermaid、KaTeXを含まない。

| 項目 | 実測値 | [spec.md](./spec.md) の目標 |
| --- | --- | --- |
| private working set（全プロセス合計、7プロセス） | 79.4 MB | 300 MB以内 |
| private working set（Rust側プロセス単体） | 3.9 MB | 50 MB以内 |
| ウォームスタート（ウィンドウ表示まで、5回平均） | 342 ms（最小302 ms、最大440 ms） | 操作受付まで1秒以内 |

目標値は据え置く。上記は描画機能を積む前の値であり、実装が進んだ時点で再測定する。現時点で目標に対して十分な余裕があり、目標を緩める根拠はない。

ウィンドウを閉じると、WebView2の子プロセス6個を含めてすべて終了することを確認した。常駐プロセスは残らない。

PackageFamilyNameは `scottlz0310.md-peruse_r99jq8jxntmym` として解決され、Partner Centerの登録値と一致した。

#### WACKの結果

`appcert.exe` でx64版MSIXをテストした。OVERALL_RESULTは `PASS`（24テスト中23 PASS、1 FAIL）。

FAILした「ブロック済みの実行可能ファイル」は `OPTIONAL="TRUE"` のテストであり、総合結果には影響しない。指摘内容と原因は次のとおり。

| 指摘 | 原因 |
| --- | --- |
| `kernel32.dll!CreateProcessW` への参照 | Rust標準ライブラリの `std::process` |
| `shell32.dll!ShellExecuteW`、`ShellExecuteExW` への参照 | `tauri-plugin-opener` が外部URLを既定ブラウザで開くために使用する |
| `cmd`、`cmd.exe`、`\cmd.exe` への参照 | Rust標準ライブラリに含まれる文字列（`library/std` のパス、およびbatch file実行用の `cmd.exe /e:ON /v:OFF /d /c` テンプレート）。アプリからcmdを起動する経路はない |
| `basH`、`DNX`、`CdB` への参照 | 大文字小文字が混在しており、バイナリ中のバイト列への誤検出 |

いずれもアプリのコードが外部プロセスを起動するものではない。Store提出を妨げる失敗はないと判断するが、審査で指摘された場合に備えて上記の内訳を記録する。ARM64版のWACKは、パッケージをインストールして実行する都合上ホストと同じアーキテクチャを要するため、Phase 5の提出前検証で実施する。

### 13.4 MSIX環境での動作検証（x64）

最小の検証コードをMSIXへ含め、インストールした状態で確認した。検証コードはdev-flow 1章の方針により製品コードへ持ち込まず、確定値のみを本書へ記録する。

| 検証項目 | 結果 |
| --- | --- |
| フォルダー選択 | ネイティブダイアログが開き、選択したパスをRust側で受け取れる。`broadFileSystemAccess` を宣言せずに成立する |
| ファイル読込 | 選択したフォルダー配下の読込みに成功する |
| ファイル監視 | `notify` の再帰監視が成立する。イベントの詳細は6.4 |
| 設定ディレクトリ | Tauriは `%APPDATA%\com.scottlz0310.md-peruse` を返すが、実体はパッケージ領域へリダイレクトされる。書込みと読み戻しに成功し、アンインストールで併せて削除される |
| custom protocol | `http://mdperuse-img.localhost/<path>` として配信される。詳細は5.4 |
| 関連付け起動 | `.md` と `.markdown` がProgIdとして登録され、起動時にファイルの絶対パスが `argv[1]` として渡る |
| ドラッグ＆ドロップ | エクスプローラーからのファイルとフォルダーのドロップが `tauri://drag-drop` として届く。詳細は10.4 |

#### 設定ディレクトリのリダイレクト

Tauriが返すパスと、実際にファイルが格納される位置は異なる。

| 観点 | 値 |
| --- | --- |
| `app_config_dir` / `app_data_dir` が返すパス | `C:\Users\<user>\AppData\Roaming\com.scottlz0310.md-peruse` |
| `app_local_data_dir` / `app_cache_dir` が返すパス | `C:\Users\<user>\AppData\Local\com.scottlz0310.md-peruse` |
| 実際の格納先 | `%LOCALAPPDATA%\Packages\scottlz0310.md-peruse_r99jq8jxntmym\LocalCache\Roaming\com.scottlz0310.md-peruse` |

アプリから見えるパスはリダイレクトされていないように見えるが、読み書きはWindowsがパッケージごとの領域へリダイレクトする。パッケージ外のプロセスから `%APPDATA%\com.scottlz0310.md-peruse` を参照しても存在しない。

アンインストールするとパッケージ領域ごと削除され、設定ファイルも残らない。実測で次を確認した。

- アプリが `%APPDATA%\com.scottlz0310.md-peruse\spike-probe.json` へ書込み、同じパスから読み戻せる
- 実体は `...\Packages\<PFN>\LocalCache\Roaming\com.scottlz0310.md-peruse\spike-probe.json` にある
- `Remove-AppxPackage` 後、`...\Packages\<PFN>` ごと削除される

したがってWinRTの `ApplicationData.Current.LocalFolder` を呼ぶ必要はない。Tauriが返すパスをそのまま使えば、MSIXでは自動的にパッケージ領域へ隔離され、非パッケージ実行（`tauri dev`）では通常のAppDataを使う。分岐も `windows` crateへの依存も持ち込まない。

11.1の「MSIXではパッケージのLocalStateへリダイレクトされる」という当初の想定は、リダイレクトが起きる点で正しく、リダイレクト先が `LocalState` ではなく `LocalCache\Roaming` である点で不正確だった。

#### 開発時の再インストール

同一バージョンで内容の異なるMSIXは `Add-AppxPackage` が `0x80073CFB` で拒否する。検証を繰り返す際は、既存パッケージを削除してから導入する。

```powershell
Get-AppxPackage -Name scottlz0310.md-peruse | Remove-AppxPackage
Add-AppxPackage .\build\msix\md-peruse_0.1.0.0_x64.msix
```

#### 関連付け起動

マニフェストの `windows.fileTypeAssociation` により、ProgIdと `AppUserModelID`、`ContractId="Windows.File"` がレジストリへ登録される。

エクスプローラーの「プログラムから開く」から起動し、引数の渡り方を実測した。ファイルパスは通常のコマンドライン引数として渡る。

```text
argv[0] = C:\Program Files\WindowsApps\scottlz0310.md-peruse_0.1.0.0_x64__r99jq8jxntmym\md-peruse.exe
argv[1] = <選択したファイルの絶対パス>
```

したがって関連付け起動の受け口は `std::env::args()` でよく、WinRTのアクティベーションハンドラを実装する必要はない。`ContractId="Windows.File"` はレジストリへ登録されるが、`EntryPoint="Windows.FullTrustApplication"` のpackaged classic appに対してはWindowsがコマンドライン起動へ変換する。

COMの `IApplicationActivationManager::ActivateForFile` を直接呼ぶと `0x80270254`（コントラクト未サポート）で失敗する。これは同じ理由によるものであり、関連付けの登録が不正なわけではない。検証にこのAPIを使わない。

#### ドラッグ＆ドロップ

Phase 3-4で確定したドラッグ＆ドロップ（10.4）が、パッケージ環境でも成立することを確認した。プロセスの整合性レベルは `Medium Mandatory Level` であり、エクスプローラーと同じである。ドロップ元とドロップ先の整合性レベルが等しいため、UIPIによる遮断は起きない。

- Markdownファイルのドロップで `Drop { paths: [<絶対パス>], position }` が届く
- フォルダーのドロップでも同じ形式で届く
- 非パッケージ実行（`tauri dev`）との差は観測されなかった

### 13.5 Store向けカスタムイベントの送信経路（x64、Windows 11 26200）

Microsoft Store版の初回リリースから送るカスタムイベント（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）について、送信経路が成立するかを実測した。ここで扱うのは経路の可否と制約だけであり、イベント名・発火条件・データ最小化の要件は段階2で定義する。[spec.md](./spec.md) 5.5「使用状況テレメトリとクラッシュレポートの外部送信を行わない」の更新も段階2で行う。

Partner CenterのUsage reportが集計するカスタムイベントは、Microsoft Store Services SDKの `Microsoft.Services.Store.Engagement.StoreServicesCustomEventLogger` を経由したものに限られる。このSDKは公式にはUWP向けであり（`SDKManifest.xml` の `AppliesTo` は `WindowsAppContainer`）、packaged classic appでの利用を明記した文書はない。実体はWinRTのframework packageであるため、packaged classic appから呼べるかを実機で確認した。

検証は最小のRust実行ファイル（`windows-bindgen` でwinmdからバインディングを生成し、`GetDefault()` と `Log()` を呼ぶだけのもの）を、md-peruse本体と同じ構成のMSIX（`EntryPoint="Windows.FullTrustApplication"`、`uap10:RuntimeBehavior="packagedClassicApp"`、`uap10:TrustLevel="mediumIL"`、`runFullTrust`）へ入れて行った。

| 実行条件 | `GetDefault()` の結果 |
| --- | --- |
| パッケージ外（素の実行ファイル） | `0x80040154` クラスが登録されていない |
| MSIX、`PackageDependency` なし | `0x80040154` クラスが登録されていない |
| MSIX、`Microsoft.Services.Store.Engagement` のみ宣言 | `0x8007007E` モジュールが見つからない |
| MSIX、Engagement と `Microsoft.VCLibs.140.00` の両方を宣言 | 成功。`Log()` も成功 |

確定した事項は次のとおり。

- packaged classic appからカスタムイベントを送信できる。追加のcapabilityは不要で、`runFullTrust` だけで成立した。
- マニフェストの `<Dependencies>` へ2つの `<PackageDependency>` が必要である。`Microsoft.Services.Store.Engagement`（MinVersion 10.0.23012.0、Publisher `CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`）と `Microsoft.VCLibs.140.00`（MinVersion 14.0）である。後者は `Microsoft.Services.Store.Engagement.dll` が `vccorlib140_app.dll`、`MSVCP140_APP.dll`、`CONCRT140_APP.dll`、`VCRUNTIME140_APP.dll` を必要とするためで、宣言を欠くとクラスは解決されてもDLLのロードで失敗する。
- **CSPとTauri capabilityの最終値には影響しない。** 送信はWinRTのin-process activationであり、WebViewからのHTTPS通信を伴わない。`connect-src` を広げる必要がなく、capabilityの追加も不要である。
- パッケージIDを持たない実行（`bun run tauri dev` を含む）では `0x80040154` で失敗する。「開発版・テスト環境で本番イベントを送信しない」という要件は、呼び出し側が失敗を無視するだけで自然に満たされる。
- 失敗はHRESULTとして返るだけで、例外やプロセス終了にはならない。「テレメトリの送信失敗でファイル・フォルダー操作を失敗させない」という要件は呼び出し側で担保できる。

未確認の事項は次のとおり。

- ARM64での成立。framework packageはARM64版も配布されているが、ARM64実機がないためPhase 5の提出前検証で確認する（[#8](https://github.com/scottlz0310/md-peruse/issues/8)と同じ扱い）。
- Store提出時にframework packageの依存をStoreが解決するか。ローカル検証では `Add-AppxPackage` で事前に導入した。
- Partner CenterのUsage reportへイベントが実際に反映されること。Store公開後にしか確認できないため、段階4で行う。
- SDKがpackaged classic appを公式サポートすると明記した文書はない。動作は実測できたが、将来のSDK更新で崩れうる前提として扱い、段階2では送信経路が失われても機能へ影響しない設計とする。

[#21](https://github.com/scottlz0310/md-peruse/issues/21) の追加要件1は、公式API経路が使えなかった場合の分岐（イベントなしで初回提出する、提出を遅らせて実装する、別経路を採る）を確認作業の前に決めることを求めていた。実測で経路が成立したため、この分岐を選ぶ必要はなくなった。将来SDK側の変更で経路が失われた場合は「イベントなしで提出する」を既定とし、このIssueがStore提出をブロックしない。


## 14. テスト方針

### 14.1 Frontend

- remarkとrehypeのプラグイン構成、Raw HTMLがテキストとして出力されること、`rehype-sanitize` のschemaをテストする。
- schemaが全列挙で許可する範囲（見出し `id`、`language-*`、タスクリスト、画像プロトコル、KaTeX出力）と、列挙外が除去されることをテストする（8.2）。
- 見出しIDの生成規則と、脚注のIDと衝突しないことをテストする（7.2）。
- YAML front matterが本文から除かれること、対象外のブロックが本文に残ることをテストする（8.1）。
- 処理上限の判定と境界（1単位の上限、文書のコスト予算、最小コスト）をテストする（8.3、8.5）。
- URL scheme、相対リンク、画像resource IDの変換をテストする。
- ツリー、タブ、`stale` と `deleted` の状態遷移、キーボード操作をテストする。
- 文書内検索の一致規則（大文字小文字の吸収、畳んでもコードユニット数が変わらないこと、重なる一致を数えないこと、件数の上限）と、対象から外す要素をテストする（8.6）。
- タブごとの履歴の積み方（進む側の破棄、同じ場所を積まないこと、上限、renameの追従、読み込めない項目の除去）をテストする（9.3）。
- Mermaid、lowlight、KaTeXのlazy import失敗をテストする。
- KaTeXの `trust` 無効化と、`maxExpand`・`maxSize` が効くことをテストする。
- Tauri commandとeventはadapter経由で注入し、テストではモックへ置き換える。
- 同じ振る舞いの入力差分は `test.each` などのパラメーター化テストで表現する。

### 14.2 Rust

- パス正規化、境界判定、reparse point、URL schemeをテストする。
- 大文字小文字差、Unicode正規化差、コンポーネント境界の誤判定（`C:\root` と `C:\rootx`）をテストする。
- UTF-8、UTF-16、デコードエラー、サイズ上限をテストする。
- Watcherのdebounce、削除、rename、atomic replaceをテストする。
- custom image protocolのresource ID、Content-Type、上限、エラー応答をテストする。
- ファイルシステムとWatcherをtraitで注入し、単体テストから実ファイルとOSイベントを分離する。
- 同じ振る舞いの入力差分はテーブル駆動テストで表現する。

### 14.3 セキュリティ回帰

悪意ある入力を模した固定のMarkdown一式をリポジトリへ置き、描画結果を検証する回帰テストを設ける。

- Raw HTML、`javascript:` リンク、`data:` 画像、`ms-` scheme
- `..` を含む相対パス、UNC、device path、絶対パス
- 巨大画像、巨大Mermaid、巨大な数式、多数の短い数式、深いネスト
- SVG内のscriptと外部参照
- KaTeXのマクロ展開を悪用した入力

### 14.4 パッケージと実機

- x64とARM64のReleaseビルドを検証する。
- MSIX manifest、Identity、Publisher、Version、Capabilitiesを静的検査する。
- 自己署名MSIXをインストールし、起動、関連付け、Package Identityを確認する。
- WACKをStore提出前に実行する。
- Storeへ提出するMSIXがCIで検証したartifactと一致することを確認する。
- x64実機を必須とし、ARM64実機または同等環境でスモークテストする。
- [spec.md](./spec.md)の性能目標をインストール済みパッケージに対して測定する。

### 14.5 FrontendのDOMテスト構成と退避条件

Phase 2で `bun:test` によるReactコンポーネントのDOMテストが成立することを確認した。構成は次のとおり。

| 要素 | 採用 |
| --- | --- |
| test runner | `bun:test` |
| DOM実装 | `@happy-dom/global-registrator` |
| コンポーネント操作 | `@testing-library/react` |
| プリロード | `bunfig.toml` の `[test] preload` で `test/setup.ts` を読み込む |

`test/setup.ts` はhappy-domをグローバルへ登録し、`IS_REACT_ACT_ENVIRONMENT` を有効にしたうえで、`afterEach` に Testing Library の `cleanup` を登録する。Testing Libraryは読み込み時に `document` を参照するため、登録後に動的importする。

確認した範囲は次のとおり。

- `render` と `screen` によるクエリ
- `fireEvent` による操作とstate更新の反映
- テスト間のDOM cleanup
- `tsc --noEmit` によるテストコードの型検査（`types: ["bun"]` と `include` への `test` 追加）

Vitestへ退避する条件は次のとおり。いずれかに該当した時点で、その回避策を本番コードへ持ち込む前に切り替えを判断する。

1. Viteの変換に依存する記法（`import.meta.env`、CSS Modules、`?raw` や `?url` のimport、worker import）を含むモジュールのテストが書けず、回避策として本番コードの構造を変える必要が生じたとき。
2. happy-domが実装しないブラウザAPIについて、テスト用のモックが本番コードへ影響する形でしか用意できないとき。
3. `bun:test` 側の制約でReactの非同期更新やタイマー制御が安定せず、フレークが継続的に発生するとき。
4. 上記の回避に要するコストが、Vitestの導入と維持のコストを上回ると判断できるとき。

退避する場合は、`bunfig.toml` のpreloadをVitestのsetupファイルへ移し、`package.json` の `test` スクリプトとCIの実行コマンドを差し替え、本節と4.8を改訂する。happy-domとTesting Libraryの資産はそのまま引き継げるため、退避コストはrunnerの差し替えに限定される。

## 15. 未決事項

技術スタックの選定は第4章で確定済みであり、本章では扱わない。

### P0: 実装着手前

Phase 1のスパイク、Phase 2の基盤整備、Phase 3の詳細設計で解決した項目は次のとおり。

| 項目 | 結論 | 参照 |
| --- | --- | --- |
| Tauri、Rust、Bun、React、Vite、winapp CLIの初期バージョン | winapp CLI 0.6.1 を含め確定 | 4.10 |
| ARM64のビルド方式 | x64ホストからのクロスコンパイル | 13.2 |
| BunのみでMSIXビルドを完結できるか | Node.jsは不要 | 13.2 |
| `runFullTrust` だけを使用するMSIXでフォルダー選択、監視、関連付け起動が動作すること | いずれも動作する。関連付け起動の引数は `argv[1]` | 13.4 |
| MSIXでのアプリ設定保存先が期待どおりに解決されること | パッケージ領域へリダイレクトされ、アンインストールで併せて削除される | 11.1、13.4 |
| custom image protocolのURL形式 | `http://mdperuse-img.localhost/<resource-id>` | 5.4 |
| x64のMSIX生成、インストール、起動、WACK結果 | いずれも成立。WACKはOVERALL PASS | 13.1、13.3、13.4 |
| `bun:test` でのDOMテスト成立可否とVitestへの退避条件 | happy-domとTesting Libraryの組合せで成立。退避条件を明文化 | 4.8、14.5 |
| Tauri command/eventの型、version、request ID、cancel、error契約 | 型はRust側を正本に `ts-rs` で生成。version・request ID・cancelは導入せず、エラーは `IpcError` と `ErrorCode` で表す | 5.3 |
| custom image protocolのresource ID生成、無効化、キャッシュ方針 | ワークスペース単位のソルトと変更世代のHMAC。文書単位で発行し、ワークスペース切替で無効化 | 5.4 |
| CSPの最終値とTauri capabilityの最小集合 | `style-src` を elem と attr へ分け、`font-src` は `'none'`。capabilityは `core:event` の listen / unlisten と `opener:allow-open-url` の3つだけ | 5.5 |
| 永続化する状態と設定ファイルのスキーマ | `src-tauri/src/settings.rs` を正本とし、`schemaVersion` は1。読み書きはRust側が担い、Frontendへは絶対パスを含まない `UiSettings` を投影する | 11.1 |
| 最近使ったフォルダーと最後のワークスペース復元 | いずれも初期版へ含める。復元は最後のワークスペースだけを対象とし、タブは復元しない | 9.2、11.1 |
| ファイル削除、rename、atomic replace後のタブ状態と、置換時の再読込例外の可否 | タブは `loaded` / `stale` / `deleted` の3状態。renameは追跡してパスを追従させ、置換直後の読込失敗は同一イベントにつき1回だけ再読込を許す（案B） | 6.4、6.5 |
| ファイル監視のライフサイクル | ワークスペース単位の再帰監視と、loose tab 1件ごとのファイル単体監視の2系統。切り替え時は旧Watcherを停止してから状態を破棄する | 6.4 |
| 同時に開けるタブ数の上限 | 20。超過するときは最終アクティブ時刻が最も古い非アクティブタブを閉じる | 9.1 |
| メニューの実装方式と、メニュー・ショートカット・パンくずの操作仕様 | ネイティブメニュー。コマンドとアクセラレータの正本は `src-tauri/src/menu.rs`。パンくずはツリーを展開して選択する | 10.1 |
| スプリッターの幅範囲、刻み、設定保存 | 最小200 px、最大 `min(600 px, ウィンドウ幅の50 %)`、刻み16 px（`Shift` 併用64 px）。保存値と実効値を区別する | 10.2 |
| 文字サイズの範囲と刻み | `80 / 90 / 100 / 110 / 125 / 150 / 175 / 200 %` の8段階。大きい側ほど粗く刻む | 10.3 |
| 関連付け起動で複数のファイルが渡されたときの扱い | 対象拡張子をすべて開き、最後の1つをアクティブにする | 9.2 |
| 文書内検索を初期版へ含めるか | 含める。WebView2標準の検索バーは検索範囲がWebView全体になるため採らず、CSS Custom Highlight APIで自前実装する | 8.6 |
| リンク遷移の戻る／進む操作を初期版へ含めるか | 含める。リンクは同じタブで開き、History APIに載せずタブごとの独自スタックで持つ | 7.2、9.3 |
| 単一ファイルまたは単一フォルダーのドラッグ＆ドロップ | 含める。ファイルは関連付け起動と同じ規則で開き、フォルダーはワークスペースとして開く。パスはRust側が受け取り、Frontendへは受け入れ可否だけを渡す | 10.4 |
| 英語UIを初期版へ含めるか | 含める。日本語と英語の2言語とし、OSの表示言語へ従うのを既定として設定で切り替える | 10.5 |
| Store向けカスタムイベントの送信経路（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階1） | packaged classic appから `StoreServicesCustomEventLogger` を呼べる。Engagement と VCLibs の `PackageDependency` が必要で、CSPとcapabilityへは影響しない | 13.5 |
| Store向けカスタムイベントの要件（[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階2） | 5種類のイベント名を固定し、いずれも1セッションにつき1回だけ送る。送るのはイベント名だけで、失敗は無視する | 11.4 |

未解決の項目は次のとおり。

- ARM64のMSIXインストール、起動、WACK結果（Phase 5の提出前検証で実施する）

### P1: 初期版仕様確定前

- lowlightへ登録する言語allowlist
- 260文字を超えるパスへの対応方針
- 大規模ツリーでの監視範囲の縮退モードの要否

### P2: 初期版後

- 大容量MarkdownのWorker処理とDOM仮想化
- タブセッションの完全復元
- リモート画像許可UI
- 除外リストのユーザー設定
- 印刷、PDF、エクスポート
- 高度なアウトラインと目次ペイン
- YAML front matterの値（`title` など）をタブ名やヘッダーへ表示すること
- 支援技術別の完全なアクセシビリティE2E

## 16. 参考資料

- [Tauri v2: Asset protocol scope](https://v2.tauri.app/security/asset-protocol/)
- [Tauri Rust API: Builder](https://docs.rs/tauri/latest/tauri/struct.Builder.html)
- [Microsoft Learn: Using winapp CLI with Tauri](https://learn.microsoft.com/windows/apps/dev-tools/winapp-cli/guides/tauri)
- [Microsoft Learn: App capability declarations](https://learn.microsoft.com/windows/apps/package-and-deploy/app-capability-declarations)
