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
| CPU | x64 |
| WebView | Evergreen WebView2 Runtime |
| 非対応 | x86、ARM64、Windows 10、EOL済みWindows |

- ARM64は対応外とし、バイナリも配布しない（2026-09-29に決定）。ARM64実機を用意できず、インストール、起動、WACK（パッケージをインストールして実行するため、ホストと同じアーキテクチャを要する）を実機で確認できない。確認していない成果物は提出も配布もしない。Phase 1ではx64ホストからのクロスコンパイル（`aarch64-pc-windows-msvc`）でARM64版の `tauri build` とMSIX生成が成功したが、これは実機での動作の裏付けにならない。ARM64のWindowsでx64版が動くか（エミュレーション、Storeでの提供可否を含む）は検証しておらず、保証しない。ARM64実機での検証（[#8](https://github.com/scottlz0310/md-peruse/issues/8)）は、対応外とすることに伴い廃案とした。将来ARM64実機を用意できた場合は、対応の追加として改めて判断する。
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

- 選定理由: unified、Mermaid、DOMPurifyとの連携実例が最も多く、保守情報の入手性が高い。`hast-util-to-jsx-runtime` によるReact要素への直接変換という選択肢を取れる。UI規模（ツリー、タブ、プレビューの3領域）に対し、ランタイム分の負荷は許容範囲と判断する。
- 却下理由: Svelte 5とSolidJSはバンドルサイズで優位だが、エコシステムと参考情報が薄い。素のTypeScriptはツリーとタブの差分描画を自前保守することになり、保守コストが後で効く。
- 引き受けるリスク: Reactランタイム分のバンドルとメモリ。
- 緩和策: 状態管理ライブラリを持ち込まず、アクティブタブだけ本文DOMを保持する方針で総量を抑える。[spec.md](./spec.md)のメモリ目標で検証する。

### 4.4 JSツールチェーン: Bun

- 選定理由: install、test、runを単一ツールで完結でき、ローカルとCIの工程が短い。
- 却下理由: pnpmはユーザー標準で整合コストが低いが、test runnerを別途要する。npmは速度面で劣る。
- 引き受けるリスク: ユーザー標準（pnpm）からの逸脱。共有Renovateプリセットがpnpm前提のルールを含む場合の不整合。
- 緩和策: Bun向けの調整を共有Renovateプリセット側へ集約し、リポジトリローカルの `renovate.json` を最小限に保つ。Bun本体の更新を通常のJavaScript依存更新から分離する（下記）。

Bunのバージョンは `.bun-version` で固定する。Renovateの `bun-version` マネージャが対象とするのは `.bun-version` であり、`package.json` の `packageManager` はBunの更新元にならない（CorepackがBunを扱わないため、共有プリセット `presets/languages/nodejs` も同じ理由で `.bun-version` の使用を求めている）。CIの `setup-bun` も `bun-version-file: .bun-version` で同じ値を読む。

そのうえで、リポジトリローカルの `renovate.json` で `bun-version` を `Bun runtime` グループへ切り出し、`automerge` を無効化する。共有プリセットにも同名のグループ定義があるが、`presets/options/schedule` のグループ化が後勝ちするため、ローカルで再指定しないとBun本体が他の依存と同じ更新Pull Requestへ混ざる（`renovate --platform=local --dry-run` で確認した）。理由は、Bunの更新が `bun install`、テスト、ビルド、MSIX生成のすべてに影響する一方、required status check（`Frontend` / `Rust` / `Coverage`）にはMSIX生成とWACKが含まれず、自動マージのゲートでは破壊を検出できないためである。この打ち消しはmd-peruse固有の事情（MSIXの同梱）に基づくため共有プリセットへは入れず、MSIX生成とWACKをCIへ載せた時点（Phase 5）で削除を判断する。

### 4.5 パッケージングと配布: MSIX + Microsoft Store（winapp CLI）

- 選定理由: 署名と更新をStoreへ一本化でき、自前Updaterとコード署名証明書の調達を持たない。Tauri向けの公式ガイドが存在する。
- 却下理由: makeappxの自前スクリプト化はPreviewツール依存を避けられるが、パッケージング一式を自前保守することになる。MSI/NSIS + 自前Updaterは証明書コスト、更新機構の保守、SmartScreen警告を抱える。MSIXとMSIの併用は検証系統が二重化する。
- 引き受けるリスク: winapp CLIがPublic Previewであり、破壊的変更がありうる。
- 緩和策: CIで使用バージョンを固定する。`Package.appxmanifest` とパッケージ用アセットをツールから独立して管理し、makeappxへ切り替え可能な状態を保つ。Phase 1で切替コストを評価する。

### 4.6 Markdown解析とsanitize: unified（remark + rehype）

- 選定理由: sanitizeをhastの段階で行い、`hast-util-to-jsx-runtime` でReact要素へ直接変換できるため、本文描画から `dangerouslySetInnerHTML` を排除できる。HTML文字列を経由しないため、sanitizeを迂回する余地が構造的に小さい。`remark-gfm` と `remark-math` でGFMと数式の入口が揃う。
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

- 選定理由: 描画が同期的で高速。`remark-math` と組み合わせ、unifiedパイプラインへ自然に組み込める。数式を含む文書を開いたときだけロードすれば、アイドル時のコストはゼロになる。
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
| winapp CLI | `package.json` の devDependencies で固定 | npm `@microsoft/winappcli`（下記） |

winapp CLIの導入経路は、当初のWinGet（`Microsoft.WinAppCli`）から、npmの `@microsoft/winappcli` へ変更した（Phase 5、2026-10-02）。依存ツールの更新をRenovateに任せ、壊れたらPull Requestで検出する運用に合わせるためである。WinGet版は、Renovateが追えるデータソースが無く、スクリプト内の版の固定が更新の対象外だった。npmパッケージは同じ版番号（0.6.1、0.7.0など）で公開され、`os` は `win32` に限られる。Linuxの `bun install` は何も導入せず、エラーにもならないため、ubuntuのジョブへ影響しない。パッケージは自己完結の実行ファイル（`bin/win-x64/winapp.exe`）を同梱し、Node.js経由のラッパー（`dist/cli.js`）は、この実行ファイルを呼ぶだけである。`scripts/build-msix.ps1` は実行ファイルを直接呼ぶため、MSIXの生成にNode.jsは不要という判断（13.2）は変わらない。固定は完全一致の版指定とし（現在の版は `package.json` が正本で、Renovateが更新する）、版の正本は `package.json` と `bun.lock` の1か所とする。更新のPull Requestは手動でマージし、`Package` ワークフローが、Renovateの更新Pull Request（作成者が `renovate[bot]`、同じリポジトリのブランチ、`winapp-cli` ラベル付き）に限って、MSIXの生成とWACKを検証する。ブランチ名は条件に使わない。`separateMinorPatch` により、更新の種類で接頭辞が変わる（`renovate/patch-...`、`renovate/minor-...`）ためである。`winapp-cli` ラベルは、Renovateのルール（`addLabels`）が付ける。Renovateは、Pull Requestを作成した後に、別のAPI呼び出しでラベルを付けるため、`opened` のイベントにはラベルがない。そこで `pull_request` の契機に `labeled` を加え（`types` を省くと `opened`、`synchronize`、`reopened` だけが起動する）、`opened` は外す。Renovateは、ラベルを1つずつ付けるため、`winapp-cli` ラベルの `labeled` が更新Pull Requestごとに必ず1回起動し、`opened` は、これと重複するか、条件を満たさないかのどちらかになる。最初の実際の更新Pull Request（#139）では、`opened` と `labeled` の両方が起動し、同じ検証が2回走った。`labeled` は、ほかのラベルの追加でも起動するため、ジョブの条件で `winapp-cli` ラベルの追加だけを対象にして、同じPull Requestの実行が重複しないようにする。`concurrency` の `cancel-in-progress` は、skipになる実行でも、実行中の検証を取り消すため使わない。

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
- ファイル変更、言語変更（10.5）、ドラッグ状態（10.4）などの通知にはTauri eventまたはchannelを使用する。配色テーマの変更は通知しない。WebViewの `prefers-color-scheme` がウィンドウのテーマに従い、Frontendへ直接届くためである（10.1）。
- Frontendへ汎用ファイルシステムAPIを公開しない。
- commandごとに必要なcapabilityだけを許可する。
- Frontendから受け取ったパス、URL、resource IDはRust側で再検証する。
- 読込（`read_file_command`）と画像resource IDの発行（`issue_image_resources_command`）の要求は、スコープID（6.4）を載せる。スコープはワークスペースか、loose tab（9.1）の暗黙のルートである。パスはそのスコープのルートからの相対パスであり、開いていないスコープのIDは `workspaceNotFound` で拒否する。切り替えの前に発行した要求が、切り替え後の別のスコープの同じ相対パスへ当たらないようにするためである。走査（`scan_directory_command`）はワークスペースだけを対象とし、スコープIDを載せない。loose tabは走査しない（9.1）。
- loose tabの監視先の付け替え（`watch_loose_document_command`。6.4）は、Frontendが読込の応答を採用したときに求める。loose tabのスコープを閉じる操作（`close_loose_scope_command`）はタブを閉じたとき、上限で退避されたとき、ワークスペースの切り替えで破棄されたときにFrontendが求める。ワークスペースのスコープIDを渡されても閉じない。
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

ファイルシステムへ触れるcommandは `async fn` として定義し、同期I/Oを `tauri::async_runtime::spawn_blocking` へ渡す。Tauriは `async` を付けないcommandをメインスレッドで実行するため、同期のままではパスの解決・オープン・読み取り・デコードの間、ウィンドウの操作が止まる。上限（10 MiB）はバイト数を縛るだけで待ち時間を縛らず、ネットワークドライブや応答の遅いストレージではI/Oが戻るまで待つことになる。Frontendの `await invoke()` は待ち方の話であって、Rust側の実行スレッドを変えない。ブロッキングスレッドへ渡してもワークスペースのルートは `WorkspaceHandle` のロックを保持したまま参照するため、1回の要求が見るルートは1つに固定される（実装の正本は `src-tauri/src/state.rs`）。上のキャンセルの判断は、処理単位が短いことに加えてこの非同期化を前提とする。

画像の配信（5.4）だけはこの例外とし、ロックを持つのはIDの照合とファイルのオープン（handleによる境界の確認を含む）までとする。読込と形式の検証はロックの外で行う。ロックを持ったまま最大32 MiBを読むと、他の画像も走査もワークスペースの切り替えも待たされ、同時読込2件の上限（7.3）が実質1件になる。検証済みのhandleから読むため、ロックを離しても境界は崩れない。読込中に切り替えが起きた場合は旧ワークスペースの画像を1件配信し切るが、要求の時点では正当なIDであり、Frontendは旧スコープの表示を捨てる。

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

実装の正本は `src/state/file-tree.ts` とする。ワークスペースを開くたびに世代を進めた新しいツリーを作り、パス世代の記録はツリーごと捨てる。

ワークスペースを切り替えるときは、ワークスペース世代を進め、パス世代の記録を破棄する。これにより旧ワークスペースの応答は、パスが一致していてもワークスペース世代の不一致で破棄される。この振る舞いはPhase 4で、同一パスの再走査、別パスの同時走査、ワークスペース切替の3つの競合をテストで固定する。

この判断は、Frontendが単一のWebViewとして同梱される構成に依存する。sidecarや外部プロセスを追加する場合、またはlong-runningな処理（全文検索など）を導入する場合は、その時点で再検討する。

数値型はJSONの範囲で表現できるものに限る。`u64` は `ts-rs` が `bigint` へ写像するが、TauriのJSON IPCは `serde_json` を通るためFrontendが受け取るのは `number` であり、生成した型と実値が乖離する。バイト数や件数には `u32` を使う。

エラーは `IpcError` として次の構造を持ち、Frontendでの分岐に文字列比較を使わない。

- `code`: 安定した機械可読の識別子。原因ごとに列挙し、`ts-rs` がTypeScriptのunion型として生成する
- `message`: 表示用のメッセージ。Rust側が現在のUI言語（10.5）で組み立てる。文言の正本は `src-tauri/src/ipc/message.rs` とし、`match` で全 `code` を列挙して書き漏らしをコンパイラに検出させる
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

発行時はファイル全体を読まず、ヘッダーだけで形式と寸法を判定する。バイト数はメタデータから取り、形式と寸法は `imagesize` のreader APIで取る。`imagesize` は寸法に関係しない区間をシークで読み飛ばすため、APPセグメントで1.3 MiBへ水増ししたJPEGでも読むのは2 KiB未満だった（実測）。発行時に全体を読むと、内容ハッシュを採らない理由（描画前の待ち時間とメモリ）をそのまま抱える。配信時はファイル全体を読むため、同じ判定をバイト列に対して通す。判定の入口は `src-tauri/src/image/format.rs` の `validate_reader` の1つとし、発行時と配信時で規則が食い違わないようにする。

IDの生成と対応表の正本は `src-tauri/src/image/resource.rs`、発行の手順は `src-tauri/src/image/issue.rs` とする。実装で次のとおり具体化した。

- HMACは `hmac` と `sha2` によるHMAC-SHA256とし、出力を小文字の16進（64文字）でIDとする。sanitize schemaが許すIDの形（`[A-Za-z0-9_-]+`。8.2）に収まる。ソルトは `getrandom` でOSの乱数源から32バイト取る。監視スコープID（6.4）のように `RandomState` から作らないのは、スコープIDが衝突しなければよい値であるのに対し、ソルトは推測されないことが要件だからである。
- 変更世代は、発行したことのあるパスだけを持つ。監視はワークスペース内の全イベントを渡すが、発行していないパスの世代は誰のIDにも影響せず、持つと表が際限なく伸びる。
- 世代のキーは、参照を解決した先のファイルシステム上の表記を小文字へ揃えたものとする。参照の表記（`IMG.png`）と監視イベントの表記（`img.png`）が食い違っても、同じファイルとして世代を進めるためである。
- 変更を受けたパスと同じパスに加え、その配下のパスの世代も進める。監視イベントからはファイルとディレクトリを区別できず（6.4）、フォルダーのrenameや削除では配下のファイルごとのイベントが届かない。進めなければ、同じ相対パスへ別のファイルが現れたときに旧IDのキャッシュが表示される。比較は `/` 区切りのコンポーネント単位で行う。
- 世代は窓の確定を待たず、監視スレッドがイベントを受けた時点で進める。同じ窓で文書の変更が確定すると再描画に伴って発行し直されるため、それより前に新しい世代になっている必要がある。除外対象（6.2）配下の画像も文書から参照されうるため、除外の判定より前に進める。
- ルートと対応表は1つのロックの内側に置く（`src-tauri/src/state.rs`）。別々に取ると、切り替えの前後をまたいで旧ルートで解決したパスを新しい対応表へ登録しうる。

**発行済みの画像が書き換わったときは、専用のeventで表示中の文書へ知らせる。** 監視の通知（`FileChange`）はタブ向けの変更をMarkdownに絞っており（6.5）、画像だけを書き換えた場合は `FileChange` が届かない（atomic replaceでも親ディレクトリの `directoryChanged` だけである）。世代が進んでIDが変わっても、表示中の文書が描き直されなければ、DOMには旧いIDの画像が残り、旧IDは対応表から外れているため表示できなくなる。

そこでRustが、世代を進めた結果（`ImageResources::advance` が返す「発行済みのIDを1つでも進めたか」）が真のときだけ、Tauri event `images-changed`（payloadは `scopeId` のみ。`ImagesChangedEvent`）を送る。どの画像かは運ばない。Frontendは、どの文書がどの画像を参照しているかを持たずに済み、表示中の文書の画像を発行し直すだけでよい。非アクティブなタブは本文を持たず、アクティブになったときに読み直すため（9.1）、通知を覚えておく必要がない。

- 通知は、文書の窓（6.4）とは別の `DebounceWindow` で畳み込む（`src-tauri/src/watch_runtime.rs`）。除外対象（6.2）配下の画像は文書の窓へ入れないため、同じ窓では届かない。時間規則は文書の窓と同じ（静穏150 ms、最大600 ms）で、窓が縮退しても1回の通知にする。
- 世代を進めていない画像（発行していない画像）の変更では送らない。参照されていない画像のために、表示中の文書を描き直す理由がない。
- Frontendは `scopeId` が一致するときだけ、表示中の文書へ渡す値（`imageRevision`）を進める。値が進むと、本文が同じでも描き直して発行し直す（`MarkdownDocument`）。
- 監視のバッファがあふれた窓では、画像のIDを作り直す。この経路の再描画は `watcher-error`（6.4）の処理が担う。あふれの通知が届いたときも `imageRevision` を進める。

発行時の失敗は `IpcError` で表し、画像固有の `code`（`imageUnsupportedFormat`、`imageTooLarge`、`imagePixelLimitExceeded`、`imageDecodeFailed`）を用いる。Markdown用の `fileTooLarge`（10 MiB）や文字コード用の `decodeFailed` は上限も対象も異なるため流用しない。配信時の失敗も同じ区分で表し、HTTPのステータスコードへ対応付ける。

パスの失敗は走査・読込と同じ `pathRejected` と `pathOutsideWorkspace` で表す。見つからない場合は `fileNotFound` とする。参照の書き誤りが最も起こりやすい失敗であり、「読み込めない」と区別して示す価値がある。それ以外のI/Oの失敗（アクセス拒否、共有違反、フォルダーを指している）は `imageDecodeFailed` へまとめる。画像の表示位置で利用者が取れる対応は変わらない。失敗の `detail` は載せない。応答の要素は要求の参照文字列を持っており、解決した相対パスを別に返すとFrontendがパスの規則を知る必要が生じる。

配信の正本は `src-tauri/src/image/protocol.rs` とし、次のとおり具体化した。

- IDを対応表で引けない場合（旧ワークスペースのID、世代の古いID、推測したID）とワークスペースを開いていない場合は404とする。GET以外は405とする。
- ファイルは `WorkspaceRoot::open_file` で開き、開いたhandleの最終パス（`GetFinalPathNameByHandleW`）でも境界内であることを確かめる（7.1）。解決とオープンの間に経路上のフォルダーが境界外を指すjunctionへ差し替えられても、境界外のファイルは読まない。
- 読込はメタデータのバイト数で上限を先に判定し、読み取りも上限を1バイト超えるところで打ち切る。読んだバイト列を発行時と同じ規則（`format::validate`）で検証する。
- 同時読込は2件までとし、tokioの非同期セマフォで待たせる。待つ要求がブロッキングスレッドを占有しないためである。
- 成功の応答には、判定した形式の `Content-Type`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`（7.4）、`Cache-Control: private, max-age=31536000, immutable` を付ける。`Access-Control-Allow-Origin` は付けない。
- 失敗の応答は本文を持たず、`Cache-Control: no-store` とする。共有違反のような一時的な失敗が同じIDで固定されないためである。

失敗は発行時と同じ区分（`src-tauri/src/image/error.rs` の `ImageError`）から `ErrorCode` を得て、HTTPのステータスへ写す。`img` 要素はステータスを読めないため、Frontendが画像の位置に示す理由は発行時の応答から取り、ステータスは診断に使う。

| `ErrorCode` | ステータス |
| --- | --- |
| `pathRejected` | 400 |
| `pathOutsideWorkspace` | 403 |
| `fileNotFound` | 404 |
| `imageUnsupportedFormat` | 415 |
| `imageTooLarge` | 413 |
| `imagePixelLimitExceeded` | 422 |
| `imageDecodeFailed` | 500（アクセス拒否や共有違反を含み、内容の誤りとは限らないため） |

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

Mermaid 12はSVGの要素へインラインの `style` 属性を出力する（Phase 4-2でChromiumにより実測）。flowchart、sequence、class、state、ER、gantt、pie、mindmapのいずれでも使われ、プロパティは `fill`、`stroke`、`stroke-width`、`stroke-dasharray`、`stroke-dashoffset`、`text-anchor`、`font-size`、`font-weight` と、svg要素の `max-width` だけだった。CSPは緩めず、DOMPurifyのフックでSVGの表示属性として正当なものだけを属性へ移してから `style` 属性を落とす（8.4）。単に落とすだけでは、円グラフの凡例の色が失われ、図が本来の幅を越えて表示幅いっぱいに引き伸ばされた（実測）。当初の「落としたうえで自前CSSで補う」は、図ごとに動的に決まる色をCSSで補えないため改めた。

capabilityは `src-tauri/capabilities/default.json` に次の4つだけを置く。

| 権限 | 用途 |
| --- | --- |
| `core:event:allow-listen` | Rustから送るファイル変更イベント、言語変更イベント、ドラッグ状態（5.3、10.4、10.5）の受信 |
| `core:event:allow-unlisten` | 上記の解除 |
| `core:window:allow-set-title` | ウィンドウタイトルを表示中の文書へ合わせる（10.1.2） |
| `opener:allow-open-url`（`http://*`、`https://*` へ限定） | 外部リンクをOS既定ブラウザーで開く（7.2） |

- `core:default` は使用しない。このセットに含まれる `core:image:default` は `allow-from-path` を持ち、Frontendから渡された任意のパスの画像を読み取れる。`core:path:default` はパス解決APIをFrontendへ公開する。いずれも上記方針と衝突する。`core:tray:default` はトレイアイコンを使わないため付与しない。
- `core:window:default`、`core:webview:default`、`core:app:default` も付与しない。参照系が中心とはいえ、`core:webview:default` には `allow-internal-toggle-devtools` が含まれ、`core:app:default` はアプリ識別子やバンドル種別をFrontendへ公開する。必要になった時点で個別の権限を足す。ウィンドウタイトルの設定（`core:window:allow-set-title`）はこの方針で足した1つである。
- `core:event:allow-emit` は付与しない。FrontendからRustへの通信はcommandで行い、Frontend発のイベントを使わない（5.3）。
- ファイルシステム系プラグインのcapabilityをFrontendへ付与しない。フォルダー選択はネイティブメニューからRust側のダイアログで行い（10.1）、読込はRust側のcommandで行う。
- アプリ自身のcommand（`generate_handler!` で登録したもの）はcapabilityへ列挙しなくても呼べる。Tauriのpermissionが対象とするのはプラグインとcoreのcommandである。Frontendを結線した実機（`tauri dev`、Windows 11 26200）で、`scan_directory_command` と `read_file_command` を3権限のまま呼べることを確認した。
- ダイアログは `tauri-plugin-dialog` をRust側からだけ使い、`dialog` 系の権限を付与しない。JSのパッケージも入れない。このプラグインは初期化時にWebViewへ `window.alert` / `window.confirm` を `plugin:dialog|message` / `plugin:dialog|confirm` のinvokeへ置き換えるスクリプトを注入し、`tauri-plugin-fs` をコンパイル時の依存に持つ。権限を付与しないためFrontendからの呼び出しは失敗し、fsプラグインは初期化されない。`rfd` を直接使えばどちらも避けられるが、親ウィンドウの指定やメインスレッドへの振り分けを自前で持つことになり、Tauri本体と揃った更新から外れるため採らない。
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

除外一覧は初期版ではユーザー設定から変更できない。除外されたフォルダーはツリーに表示しない。`.gitignore` の解釈は行わない。実装と一覧の正本は `src-tauri/src/scan.rs` とする。

ツリーの表示対象はフォルダーと `.md`、`.markdown` に限る（6.3）。対象ファイルを1つも含まないフォルダーも表示する。存在の把握を優先し、展開して空であることを許容する。

#### 並び順

フォルダーを先、ファイルを後に置き、それぞれを自然順で並べる。名前に含まれる数字列を数値として比較し、`a2.md` を `a10.md` より前に置く。章番号を名前へ付けた文書（`01-intro.md`、`10-api.md`）を扱うMarkdownビューワーでは、辞書順よりも利用者の期待に沿う。エクスプローラーとVS Codeの並びもこれである。規則の正本は `src-tauri/src/natural_order.rs` とする。

規則はWindowsの `StrCmpLogicalW` を実測して定めた（Windows 11 26200）。`a001` < `a01` < `a1` の順（数値が等しいときは先頭のゼロが多いほうが先）、`a` < `a1`（数字を持たない名前が先）を採る。

`StrCmpLogicalW` そのものは呼ばない。ロケールとOSの版で結果が変わる比較をツリーの並びへ持ち込むと、同じフォルダーが環境によって違う順序で表示され、テストでも固定できないためである。数字列の比較だけを取り入れ、それ以外は小文字化したコードポイント順とする。仮名の並びが `StrCmpLogicalW` と異なるのはこのためである（実測では `ア` < `あ`、本実装では逆）。

数字列を数値へ変換しない。`u64` は20桁で溢れる。`StrCmpLogicalW` 自身も20桁を超える数字列で破綻し、`99999999999999999999` を `100000000000000000000` より大きいと返す（実測）。先頭のゼロを除いた桁数で比較することでこれを避ける。

#### 展開矢印の有無

`FileNode.hasChildren` は、対象のサブディレクトリを実際に読んで判定する。子として数えるのは「除外対象でないフォルダー」と「対象の拡張子を持つファイル」であり、走査の表示対象と一致させる。

読めなかったときは `true` を返す。展開を試させ、そのときの失敗としてアクセス拒否を該当項目へ表示するためである。`false` を返すと展開矢印が消え、利用者はアクセスできないフォルダーと空のフォルダーを区別できない。

Frontendは `hasChildren: false` のフォルダーを展開できない項目として扱い、展開矢印も `aria-expanded` も付けず、展開の操作を受けない。

#### ツリーの操作と表示

実装の正本は `src/tree/TreeView.tsx` とする。WAI-ARIAのtreeパターンに従い、`role="tree"` / `treeitem` / `group` と `aria-level`、`aria-expanded`、`aria-selected`（表示中の文書）を付け、フォーカスは1項目だけが持つ（roving tabindex）。

| キー | 動作 |
| --- | --- |
| `↓` / `↑` | 見えている次・前の項目へ |
| `Home` / `End` | 先頭・末尾の項目へ |
| `→` | 畳んだフォルダーは展開する。展開済みのフォルダーは最初の子へ移る。ファイルでは何もしない |
| `←` | 展開済みのフォルダーは畳む。それ以外は親へ移る。ルート直下では何もしない |
| `Enter` | フォルダーは開閉し、ファイルは開く |

クリックはフォーカスを移したうえで `Enter` と同じ操作を行う。畳んだことでフォーカスのある項目が見えなくなったときは、見えている最も近い祖先へフォーカスを移す。

展開したフォルダーの取得状態は、その中に示す。取得中は「読み込み中…」、失敗は `IpcError` の文言をフォルダーの子の位置に出し、ツリーの他の項目はそのまま操作できる。前回失敗したフォルダーは、展開し直したときに取得し直す。取得済みのフォルダーを畳んで展開し直しても取得し直さない（セッション中のキャッシュ）。

1階層につきサブディレクトリの数だけ `read_dir` が増える。1000個のサブフォルダーを持つディレクトリでの走査は、この判定を含めて最悪43 ms（すべて空のフォルダー、ウォームキャッシュ）であり、含めなければ0.4 msである（実測）。ツリー展開の目標300 ms（[spec.md](./spec.md) 5.1）に対して余地があるため、正確さを採る。コールドキャッシュとネットワークドライブではこれより伸びる。目標を割る事例が見つかった場合は、しきい値を超えたディレクトリで `true` へ倒す縮退を検討する。

### 6.3 対象ファイルと文字コード

| 項目 | 方針 |
| --- | --- |
| 拡張子 | `.md`、`.markdown`。比較は大文字小文字を区別せず、名前の末尾で判定する。`.md` のように拡張子だけの名前も対象とする |
| 文字コード | UTF-8（BOMあり／なし）、BOMで判定できるUTF-16 LE／BE |
| 推測変換 | CP932などの推測変換は行わない |
| Markdown上限 | 10 MiB |
| 非Markdownファイル | ツリーへ表示しない。走査の時点で除外し、ツリー項目数を最小に保つ |

対象かどうかの判定は、走査、監視の畳み込み（6.5）、起動引数の解釈（9.2）、リンク解決（7.2）のすべてで一致させる。Rust側の正本は `src-tauri/src/file_kind.rs`、Frontendのリンク解決は `src/markdown/link-target.ts` とし、どちらも名前の末尾で判定する。片方が `.md` を拡張子なしと見なすと、リンクからは開けるのにツリーへ出ないファイルが生じる。

未対応または不正な文字コードは置換せず、原因を表示する。UTF-32は対応しない。UTF-32 LEのBOM（`FF FE 00 00`）はUTF-16 LEのBOM（`FF FE`）を前置しているため、UTF-16 LEより先に判定して失敗させる。後にすると、NUL文字が並んだ本文を「読めた」として表示する。上限を超えたMarkdownは解析・描画しない。

改行コードはCRLF、LF、CRを受け入れ、描画前にLFへ正規化する。

読込の実装の正本は `src-tauri/src/read.rs` とする。ファイルは `WorkspaceRoot::open_file` で開き、開いたhandleの最終パスでも境界内であることを確かめる（7.1）。パスの解決とオープンの間に経路上のフォルダーが差し替えられても、境界の外は読まない。ファイルを開く共有モードは標準ライブラリの既定（`FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE`）とし、こちらからは絞らない。閲覧している間にエディタが保存できなくなる事態を避けるためである。逆に、他のプロセスが共有を許さずに開いているファイルは読めない。この共有違反は `FileLocked` として原因を示し、自動での再試行は行わない（12章。例外は6.5のatomic replace直後の再読込に限る）。

### 6.4 ファイル変更監視

- Rustの `notify` crateでルート以下を再帰監視する。監視対象は開いているファイルに限定しない。ツリー表示とタブの両方が変更へ追従する必要があるためである。
- `notify` はディレクトリ単位の除外を行えないため、除外対象配下のイベントは受信後にパスで判定して破棄する。名前による除外（6.2の除外一覧）だけを適用し、属性による除外（隠し、システム、reparse point）は行わない。削除されたパスの属性は引けず、判定できるものとできないものが混在すると、同じファイルが作成時と削除時で違う扱いになる。
- イベントをdebounceし、同一ファイルの連続イベントをまとめる。debounce時間は実測により150 msで確定した（後述）。値の正本は `src-tauri/src/watch.rs` とする。
- アクティブ文書は再読込し、非アクティブタブは `stale` にする。状態遷移としては、変更を受けたタブはアクティブかどうかによらず `stale` になり、アクティブタブが `stale` になった時点で再読込して `loaded` へ戻す。再読込という副作用を状態から切り離すことで、再読込に失敗したタブが `stale` のまま留まる状態も同じ規則で表せる。規則は `src/state/tab-status.ts` の `applyFileChange` を正本とする。
- 再描画後は可能な範囲でスクロール位置を保持する。
- 変更のたびにルート全体を再走査しない。展開済みディレクトリのうち、イベントが届いた階層だけを再取得する。
- ワークスペース切り替え時は旧Watcherを停止してから状態を破棄する。
- ファイルハンドルをタブの寿命まで保持しない。
- Windowsでは読込時に共有読込・書込・削除を許可し、置換を妨げない。
- イベントが大量に届いた窓は、展開済みディレクトリの再取得とアクティブ文書の再読込へフォールバックし、その旨を表示する。`notify` はバッファあふれを報告しないため、あふれの検知ではなく窓ごとのイベント数で判定する（後述）。


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

窓は最後のイベントから `DEBOUNCE_MS` の静穏で閉じる。最初のイベントからの固定窓にはしない。atomic replaceの列（`Remove` のあとに `Modify(Name(To))` が続く）が窓をまたぐと、先の窓が `fileRemoved` を確定させ、タブが終端状態の `deleted` になるためである（6.5）。一方で静穏だけを条件にすると、書込みが続く間は窓が閉じず表示が更新されない。そのため窓を開いてから `MAX_WINDOW_MS` でも閉じる。

上限で閉じても、未確定の削除は確定させない。通知の期限と削除の確定は別の事柄として扱い、窓を閉じるときに「保留」に関わるイベントは次の窓へ持ち越す。保留とは、その時点で確定させると `fileRemoved` になってしまう状態であり、同じ窓で作り直されていない `Remove` と、対の `Modify(Name(To))` が届いていない `Modify(Name(From))` の2つを指す。atomic replaceは `Remove` から始まるため、rename元がまだ届いていない削除も保留に含める。

保留の猶予は、保留ごとに「その保留が届いた時刻」から `DEBOUNCE_MS` とする。猶予を過ぎた保留はそのまま確定させる。窓全体で1つの猶予を持たせてはならない。古い保留が新しい削除の猶予を食い、上限の直前に届いた `Remove` が置換の途中でも確定するためである。同じ理由で、猶予を静穏の起点（最後のイベント）に載せてもならない。無関係なパスの更新が続く間ずっと窓が延び、対の届かないrename（監視範囲外への移動）と組み合わさると、削除も他ファイルの変更も通知できないままイベントが溜まり続ける。

持ち越すのは、猶予中の保留と同じパスを持つイベントすべてとする。保留を作ったイベントだけを残すと、同じ窓で受けた同じパスの変更が先に確定してしまう。持ち越しは保留ごとの猶予で切れるため、対の届かないrenameが持ち越され続けることはなく、溜まるイベントは直近 `DEBOUNCE_MS` の範囲に収まる。

持ち越した後の窓は、保留が届いた時刻を起点として測り直す。持ち越したイベントのうち最も古いものを起点にしてはならない。同じパスの古い変更（`Modified a.md` のあとに `Removed a.md` が来る列）まで持ち越したときに起点が過去のまま残り、期限が前へ進まないためである。期限が動かないと、窓は同じ時刻で閉じ続けて空の結果を返し、呼び出し側のタイマーが即時再実行を繰り返す。保留は猶予の内側にあるため、保留を起点にすれば静穏も上限も必ず現在時刻より後になる。

値と規則の正本は `src-tauri/src/watch.rs` の `DebounceWindow` とする。期限は `deadline_ms`、持ち越しは `take_due` を正本とする。

`notify` のイベントは、そのまま扱わず自前の生イベントへ写す（6.5）。写像の正本は `src-tauri/src/watch.rs` の `map_event` とする。`Create` を `Created`、`Remove` を `Removed`、`Modify(Name(From))` と `Modify(Name(To))` をそれぞれのrenameへ写し、`Access` は内容もツリーも変えないため捨てる。分類できない種別（`Modify` のその他、`Any`、`Other`）は `Modified` へ倒す。`Removed` へ倒すとタブが終端状態の `deleted` になり、実際にはファイルが残っていても復帰できない。`Modified` なら再読込が走り、本当に失われていれば読込の失敗として原因が出る。

イベントが運ぶ絶対パスは、スコープのルートからの相対パスへ字面で直す（`src-tauri/src/path_guard.rs` の `relativize_literal`）。削除とrename元のパスは確定した時点で実在せず、`canonicalize` を通せないためである。字面の判定は7.1の判定より弱いが、これらのパスはFrontendから届く入力ではなく、`canonicalize` 済みのルートを渡した結果としてOSが返すものである。`..` を含む入力を拒否したうえでコンポーネント単位に境界を判定し、走査（6.2）が落とす名前はここでも落とす。相対化できないパスを運ぶイベントは捨てる。通知してもそのまま走査と読込へ渡せないためである。

#### Windowsバックエンドの実測（Windows 11 26200、notify 8.2.0）

Phase 4-1dの後半へ着手する前に、`notify` のWindowsバックエンド（`ReadDirectoryChangesW`）が何を報告し、何を報告しないかを実測した。設計を推測で進めると、後から覆る範囲が広いためである。

**届く種別は4つだけである。** `Create(Any)`、`Remove(Any)`、`Modify(Any)` と、renameの対（`Modify(Name(From))` / `Modify(Name(To))`）。`CreateKind::File` と `CreateKind::Folder` は出ない。`notify` の `windows.rs` が `FILE_ACTION_*` をこの4種へ直接写しており、`FILE_NOTIFY_INFORMATION` 自体が種別を運ばないためである。**ディレクトリとファイルはイベントからは区別できない。** ディレクトリのrenameもファイルと同形で届き、`remove_dir_all` は子の `Remove(Any)` に続けて自身の `Remove(Any)` を出す。

ただし `Created` については、受信時点で `metadata` を引けば判別できる。ディレクトリ200個とファイル200個を交互に作成した実測では、`Create` 400件すべてで取得に成功した。`Removed` のパスはすでに実在せず、判別できない。

**バッファあふれと監視停止は通知されない。** これが後述の2つの設計判断の前提である。

- あふれは握りつぶされる。完了ルーチンは `ReadDirectoryChangesW` が「バッファに収まらなかった」ことを示す `bytes_written == 0` を判定していない。あふれるとイベントが黙って欠落するだけで、`Err` は届かない。
- 監視対象のディレクトリが消えると、`ERROR_ACCESS_DENIED` を受けて黙って `unwatch` される。通知はない。実測でも、監視ルートを削除したときに届いたのは子ファイルの `Remove(Any)` だけで、ルート自身のイベントはなく、以後そのWatcherは死んでいた（削除後に同じパスへ `watch` し直すと失敗する）。ルートのrenameでもイベントはゼロだった。

**定数の実測は次のとおりで、3つとも据え置きで確定した。**

| 定数 | 値 | 実測 |
| --- | --- | --- |
| `DEBOUNCE_MS` | 150 | 連続書込み中のイベント間隔は最大17 ms、50 ms間隔のatomic replaceでも最大52 ms。置換の列を1つの窓へ収める余裕がある |
| `MAX_WINDOW_MS` | 600 | 200回の連続書込みではイベントの配送が904 ms続き、1回のバーストが窓をまたぐ。それでも伸ばさない（後述） |
| `REPLACE_RETRY_DELAY_MS` | 100 | 2000回のatomic replaceと並行して読み続けても読込は1件も失敗せず、値を実測から導けなかった |

`MAX_WINDOW_MS` を伸ばさないのは、上限が「書込みが続く間も表示を更新する」ための保険だからである。窓が分かれること自体は持ち越しの規則が許容しており、削除の誤判定は起きない。伸ばすと最悪の更新遅延がそのまま伸び、[spec.md](./spec.md) 5.1の変更反映の目標から遠ざかる。

`REPLACE_RETRY_DELAY_MS` については、再現しなかったことを理由に6.5の再読込そのものを落とすことはしない。実測したのはRust同士の書き手と読み手であり、置換直後にファイルを掴む第三者（ウイルス対策ソフトなど）を含む経路は再現できていない。

#### `DirectoryChanged` の生成

ツリーの更新に必要な `DirectoryChanged` は、子要素を増減させる生イベント（`Created`、`Removed`、`RenamedFrom`、`RenamedTo`）の親ディレクトリに対して生成する。**タブ向けの `FileChange` と違い、`is_tracked`（`.md` / `.markdown`）では絞らない。** 走査が落とす名前（除外一覧、隠し属性）は `relativize_literal` の時点で落ちているため、ここでも落ちる。

絞れないのは、上の実測のとおり `Removed` のパスがディレクトリかファイルか判別できないためである。拡張子で推定するとフォルダー `sub.tmp` の削除を取りこぼし、ツリーが黙って古くなる。Watcher側にディレクトリの集合を持たせて突き合わせる案は、走査結果と同期する状態を増やし、ワークスペース切替とあふれ後の再構築で整合を取る経路が増えるため採らない。

絞らない代償は、一時ファイル（`a.md.tmp`）の作成と削除でも親の再取得が走ることである。atomic replaceの列はすべて同じ親を指すため、1つの窓につき `DirectoryChanged` は1件にまとまる。

`Modified` は親を出さない。内容が変わっても、その階層の子要素は増減しないためである。監視ルートの直下で書込みが続くと、親ディレクトリのタイムスタンプ更新が `Modify(Any)` として大量に届く（実測）。これを子要素の増減として扱うと、書込みのたびに再走査が走る。

規則は `src-tauri/src/watch.rs` の `coalesce` を正本とする。

#### `WatcherStopped` の検知

ルート自身の削除とrenameは、そのルートを監視しているWatcherには届かない（上の実測）。**ルートの親ディレクトリを非再帰で監視し、ルート名に一致する `Remove(Any)` と `Modify(Name(From))` だけを拾う。**

ポーリングでルートの存在を確かめる案は採らない。[spec.md](./spec.md) 5.2の「ファイル変更検知以外の定期的なディスクI/Oを行わない」と衝突するためである。親の監視はイベント駆動であり、アイドル時のI/Oはゼロになる。実測でルートのrename（`Modify(Name(From)) ws` → `Modify(Name(To)) ws-renamed`）と削除（`Remove(Any) ws`）の双方を親から受け取れることを確認した。

親は非再帰で監視する。再帰にするとルート配下のイベントを二重に受ける。非再帰でも、ルート配下で書込みが続く間は親ディレクトリのタイムスタンプ更新が `Modify(Any)` として届く（20回のatomic replaceで41件）。種別で落とせるため、判定には影響しない。

ドライブ直下（`C:\`）をワークスペースにした場合だけ、親がないため検知経路がない。`canonicalize` した結果の `parent` は `None` になる。この場合は `WatcherStopped` を通知できない。ドライブそのものが消える状況（取り外し可能メディアの取り外し）では、走査と読込がそれぞれの `ErrorCode` で失敗するため、利用者が原因に到達できない状態にはならない。

#### `WatcherOverflow` とイベント量の上限

あふれは検知しない。上の実測のとおり `notify` が報告せず、検知する手立てがないためである。

代わりに、**1つのdebounce窓に入るイベント数へ上限（`MAX_EVENTS_PER_WINDOW`、1024）を設けて縮退させる。** 上限を超えた窓は個別の変更を確定させず、`ErrorCode::WatcherOverflow` として「展開済みディレクトリの再取得とアクティブ文書の再読込」へ倒す。実際にあふれたかどうかによらず結果が同じになるため、検知の正確さに依存しない。

1024とするのは実測に基づく。600 msの窓あたり、連続書込みでは約265件、5000ファイルの一括作成では約2300件が届く。前者は通常の書込みであり縮退させたくない。後者の規模になると、個別の変更を1件ずつ通知するより展開済みの階層を取り直すほうが安い。

縮退した窓は保留も持ち越さない。縮退の結果は再取得と再読込であり、次の窓へ引き継いでも確定させる相手がいない。引き継ぐと、上限を超えた直後に届いた削除が無関係な次の窓で `FileRemoved` として確定してしまう。

これにより「大規模ツリーでのイベント量に上限を設けるか、監視範囲を縮退させるモードを設けるか」の未決を閉じる。監視範囲そのものを縮退させるモード（ルート以下の一部だけを監視する）は設けない。どの階層を落とすかを利用者が指示する手段がなく、落とした範囲の変更に追従しないことを表示でも説明できないためである。窓単位の縮退なら、追従しない範囲も期間も生じない。

値と規則の正本は `src-tauri/src/watch.rs` の `MAX_EVENTS_PER_WINDOW` と `DebounceWindow::take_due` とする。

#### Watcherのライフサイクル

Watcherは2系統ある。ワークスペースのルート以下を再帰監視するものと、loose tabが開いているファイル1件を監視するものである。

| 系統 | 開始 | 停止 | 単位 |
| --- | --- | --- | --- |
| ワークスペース | ルートを開き、ルート直下の走査を要求する時点 | ワークスペースの切り替え、ワークスペースを閉じる操作、ルート自身の削除・rename、アプリ終了 | ワークスペースに1つ |
| loose tab | loose tabを開いた時点 | そのタブを閉じたとき、ワークスペースを開いてloose tabが破棄されたとき、アプリ終了 | loose tab 1つにつき1つ |

ワークスペース側のWatcherは、走査の完了を待たずに開始する。走査中に起きた変更を取りこぼさないためである。走査の応答が陳腐化する競合は、Frontendが持つ2層の世代で破棄する（5.3）。

ワークスペース側の実体は、ルートの再帰監視、ルートの親の非再帰監視、窓の期限を待つスレッドの3つである。実装の正本は `src-tauri/src/watch_runtime.rs` の `WorkspaceWatcher`、ライフサイクルの結び付けは `src-tauri/src/state.rs` の `AppState` とする。

切り替え時は旧Watcherを停止してから状態を破棄する。停止前に破棄すると、停止前に届いたイベントが新しいワークスペースの状態へ適用されうる。停止は監視スレッドの終了まで待つ。待たずに戻ると、停止を指示した後にまだ生きている旧スレッドが送出しうる。監視の開始に失敗した場合はワークスペースを開かない。監視のないワークスペースは、ツリーもタブも変更に追従しないまま「開けている」ように見え、利用者から区別できないためである（12章）。

確定した変更の送出先は、Rust側では `ChangeSink` として抽象する。`tauri::AppHandle` を監視スレッドが直接持つと、Watcherのライフサイクルと送出の内容をTauriのアプリインスタンスなしに検証できなくなる（14.2）。`ErrorCode` から表示用の文言を組み立てるのは送出の実装側とする。Watcherはワークスペースを開いている間ずっと生きるため、開始時の言語で文言を作ると、言語を切り替えた後もずっと旧言語で届く（10.5）。

Tauri eventの名前は `file-change`（`FileChangeEvent`）と `watcher-error`（`WatcherErrorEvent`）とする。追従の断念を `FileChange` のvariantにしないのは、対象のパスを持たないためである。`FileChange` の各variantはいずれも対象の相対パスを持ち、ツリーとタブのどこを更新するかを示す。追従の断念はスコープ全体に及び、示すべきパスがない。

#### 監視スコープ

`FileChangeEvent` は、発生元を表す不透明な `scopeId` を持つ。スコープはワークスペース、またはloose tabの暗黙のルートを単位としてRust側が採番する。画像resource IDのソルトと同じ単位である（5.4、9.1）。

イベントの `path` はスコープのルートからの相対パスであり、それだけでは通知先を一意にできない。次の2つが同じ相対パスで衝突する。

- 暗黙のルートが異なる2つのloose tab。`C:\A\README.md` と `C:\B\README.md` はどちらも `README.md` になる。
- ワークスペースの切り替え。停止したWatcherが停止前に送出したイベントが切替後に配送されると、新しいルートの同名ファイルへ適用されうる。Watcherの停止は、送出済みイベントの配送までは止められない。

Frontendは、自分が保持するスコープと一致しないイベントを破棄する。切り替えのたびに新しい `scopeId` を採番するため、この1つの判定で両方の衝突を防げる。絶対パスをFrontendへ渡さずに識別できる点も、7.1の方針と整合する。判定は `src/state/tab-status.ts` の `applyFileChange` を正本とする。

採番は連番ではなく乱数で行う。連番だと別のスコープのIDを推測でき、スコープの一致で通知先を絞る意味が弱くなる。`rand` を足さず、標準ライブラリの `RandomState` がOSのエントロピーで初期化する鍵を使う。採番の正本は `src-tauri/src/watch_runtime.rs` とする。

loose tabのWatcherは、ファイルの所在フォルダーを非再帰で監視し、そのファイルに関わる変更だけを送る（`LooseWatcher`）。ファイルを直接監視しないのは、atomic replaceが一時ファイルからのrenameになり、ファイル単体の監視は置換のたびに対象を失うためである。フォルダーの他の項目に関わる通知と、ツリーのための `DirectoryChanged` は捨てる。畳み込みの規則はワークスペースと同じで、監視しているファイルがrenameされたら `FileRenamed` として知らせ、以後は新しい名前を監視する。縮退した窓は、ファイルの変更として送る（ツリーを持たないため、読み直せば済む）。所在フォルダーの親は監視しない。フォルダーの削除は、そのファイルの削除として届く。

相対リンクで同じ暗黙のルートの別の文書へ移ると（7.2）、タブの文書が替わる。監視は開いているファイル1件に限るため、Frontendが読込の応答を採用したとき（世代の判定を通ったとき。6.5）に、Watcherをタブが表示している文書へ付け替えさせる（`watch_loose_document_command`）。文書が替わったときだけ求め、読み直しと最初の読込では求めない。要求の `path` はFrontendから届くため、暗黙のルートに対して再検証する（7.1）。相対パスの形式（`..`、絶対パス、区切りの表記）、Markdownファイルであること、実在すること、junctionなどを経由しても暗黙のルートの中にあることを、状態を変える前に確かめ、逸脱した要求は読込と同じ `ErrorCode` で拒否する。拒否した要求は、監視も確定した世代も変えず、応答へ要求のパスを載せない。検証で確定した場所（`canonicalize` 済みの絶対パス）を、そのままWatcherの開始へ渡す。`path` から組み立て直すと、検証のあとに途中のフォルダーが差し替えられたとき、検証していない場所を監視しうるためである（読込の `open_file` が防ぐ、検証と使用の間の競合と同じ）。さらに、開始の後にそのフォルダーをもう一度解決し、検証したときと同じであることを確かめる。開いた監視は差し替え前のフォルダーを指し続けるため、開始より前の差し替えを検出できる。検出したら、監視を捨てて拒否し、確定した文書の記録を消す（同じ文書の次の要求が、「すでに監視している」として何もしないと、監視が戻らない）。開いたhandleの最終パスで確かめる方法（`open_file`）は、`notify` がフォルダーを自前で開くため取れない。開始の直後に差し替え、再確認の前に戻すような、パスだけの確認では防げない競合は残る。検証しないと、ルート外のフォルダーを監視でき、その成否が通知から観測できる。読込（`read_file_command`）自体は付け替えない。読んだ時点で付け替えると、素早くリンクを辿って応答が逆順に完了したとき、Frontendが世代の判定で捨てた古い応答の文書へ監視が移り、表示中の文書の更新を検知できなくなる。要求はタブのインスタンスIDと読込の世代を持ち、Rust側は同じタブの、確定済みの世代以下の要求を、`invoke` の実行順が入れ替わったものとして捨てる（別のタブは世代が数え直しになるため受ける）。付け替えの間に届いたより新しい要求が別の文書を確定した場合、古い要求は付け替えをやめる。付け替えに失敗したときは、そのスコープへ `watcherStopped` を通知する。

loose tabのファイル単体を監視するのは、関連付けで開いた文書だけが変更に追従しない状態を避けるためである。[spec.md](./spec.md)の主用途では、開いている文書が外部のツールに書き換えられることが常態であり、ワークスペース経由で開いたときと振る舞いが変わると、ユーザーは古い内容を見ていることに気づけない。暗黙のルート配下を再帰監視しないことは9.1のとおりで、関連付けで開いただけのフォルダーを丸ごと監視すると、アイドル時の低負荷というコアバリューに反する。相対画像の差し替えは検知しない。

### 6.5 削除、rename、置換後のタブ状態

タブは `loaded`、`stale`、`deleted` の3状態を持つ。本アプリはRead-onlyであり、編集による未保存状態は存在しない（9.1）。状態遷移の正本は `src/state/tab-status.ts` とする。

| 事象 | 挙動 |
| --- | --- |
| 変更 | タブを `stale` にする。アクティブタブは続けて再読込し、成功すれば `loaded` へ戻す |
| 削除 | タブを自動で閉じない。アクティブなタブは、最後に読めた内容を表示したまま `deleted` にし、以後の再読込を停止する。閉じる操作はユーザーに委ねる。離れている間に削除されたタブは本文を持たないため（9.1）、アクティブにしても読み直さず、削除された旨だけを示す |
| rename（追跡できる場合） | タブのパスとタイトルを新しいパスへ追従させる。ツリーの選択状態も追従させる。内容は変わらないため状態は保つ |
| rename（追跡できない場合） | 旧パスの削除と新パスの作成として扱う |
| atomic replace | debounce窓内の create / remove / modify の連続を1回の変更へ畳み込み、同一パスを開き直して読み直す |
| ルートフォルダー自体の削除やrename | Watcherが止まり、`watcherStopped` を通知する。ワークスペースは閉じず、取得済みのフォルダーとアクティブ文書の再取得を試みて、原因（開き直しの案内）を表示する。復旧の手段はフォルダーを開き直すこと。「再読み込み」でも取り直せる（10.1） |

`deleted` は終端状態とする。削除はdebounce窓で置換とrenameを除いてから確定するため（6.4）、確定した時点でファイルは実際に失われている。同じパスへ後からファイルが作られても、そのタブは復帰させない。ユーザーが開き直せば新しいタブになる。

#### Frontendでの適用

`file-change` の適用は次のとおりとする。規則の正本は `src/state/tab-changes.ts`（タブ）と `src/state/file-tree.ts` の `refreshDirectory`（ツリー）。

- **スコープ。** `scopeId` が現在のワークスペースと一致しない通知は破棄する。ワークスペースを開く前に届くものも、一致しないため破棄される。
- **タブ。** 通知はすべてのタブへ適用する。アクティブなタブが `stale` になった時点で再読込する。すでに `stale` のタブが新しい変更を受けたら世代が進むため、再読込をやり直す。再読込に失敗したタブは `stale` のまま留め、原因を表示する。読込中に変更を受けた場合、先に始めた読込の応答は世代で捨てる。捨てた読込の代わりに再読込を始めるのは、`stale` になった場合に限らない。renameは状態を `loaded` のまま保つため、最初の読込中にrenameを受けると、旧パスの応答が捨てられて何も読み込まれないタブが残る。アクティブタブの進行中の読込を無効にした通知は、すべて新しいパスからの再読込を起こす。非アクティブなタブの最初の読込が無効になったときは再読込を起こさず、アクティブになったときに、履歴が空のタブとしてタブのパスから読み込み直す（renameを受けていれば新しいパス）。最初の読込が変更で無効になった読み直しは、完了したときに履歴の1件目を積む（積まないと、別のタブへ切り替えて戻ったときに読み込む項目がない）。その読み直しが失敗したときは、最初の読込の失敗と同じくタブを閉じる。
- **rename。** タブのパスと履歴の旧パスを新しいパスへ追従させる。現在のパスが違うタブでも、履歴に旧パスの項目があれば差し替える（戻ったときに旧パスの読込が失敗しないように）。アクティブな本文の基点（相対リンクと画像の解決に使う）も新しいパスへ移す。`deleted` のタブは追従しない。
- **`deleted` のタブ。** 終端状態のため、再読込（メニューの「再読み込み」を含む）、戻る／進む、別の文書への遷移を止める。同じパスにファイルが作り直されても復帰させず、同じ文書を探す対象（重複の判定）から外す。ツリーから開き直すと、新しいタブになる（プレビューで開いていたタブは差し替える）。本文中のリンクは、そのタブを差し替えず新しいタブで開く。同じ文書の中の見出しへの移動は、本文を保っている間は行える。タブバーには文字（「削除済み」）で印を付ける。色だけに頼らない。
- **ツリー。** `directoryChanged` を受けたフォルダーのうち、展開しているものだけを取り直す（6.4）。取得済みで畳んでいるものは取得結果を捨てて、次に展開したときに取り直させる。取得していない、または走査に失敗したフォルダーは何もしない。ただし、`hasChildren: false` と表示していた未取得のフォルダーに子ができたときは、親を取り直す。展開矢印は親の走査で決まるため（6.2）、取り直さないと、初めてファイルができたフォルダーが展開できないまま残る。
- **`watcher-error`。** `watcherOverflow` と `watcherStopped` のどちらも、取得済みのすべてのフォルダーへツリーの規則を当て、アクティブ文書を読み直し、画像を発行し直し、原因を表示する。読み直しの成功では通知を消さない。

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

ツリーの更新に必要な `directoryChanged` は、子要素を増減させる生イベントの親ディレクトリに対して別途生成する。上の表と違い `is_tracked` では絞らない。規則と理由は6.4の「`DirectoryChanged` の生成」を正本とする。

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
- ファイル名のUnicode正規化（NFC / NFD）は行わない。
- 代替データストリーム表記（`file.md:stream`）と末尾のドットや空白を含む名前を拒否する。
- 260文字を超えるパスは特別扱いしない。標準ライブラリが絶対パスをverbatimパス（`\\?\`）へ変換してからWin32 APIを呼ぶため、`MAX_PATH` の制限を受けない。

正規化の実装は `std::fs::canonicalize` へ寄せる。実装の正本は `src-tauri/src/path_guard.rs` とする。上記のうち絶対パス化、`..` の解決、8.3形式の短い名前の解決、大文字小文字の吸収、symlinkとjunctionの解決をこの1つのAPIがすべて行うことを実測した（Windows 11 26200、Rust 1.98.1）。境界外を指すjunctionは境界外の絶対パスを返すため、解決後にコンポーネント単位で境界を判定すれば逸脱を断てる。

Unicode正規化を行わないのは、NTFSが名前を正規化しないためである。`パ`（U+30D1）と `ハ` + 結合濁点（U+30CF U+309A）は同一のフォルダーに別のファイルとして共存し、一方の名前でもう一方を開くことはできない（実測）。ルートも対象も `canonicalize` を通した結果どうしで比較する以上、比較する2つの表記はいずれもファイルシステムが返したものであり、正規化の差はそもそも生じない。ここで正規化を挟むと、実在する別々のファイルを同一視する誤りを新たに作ることになる。当初の「比較前に正規化する」という方針は、この実測に基づき改めた。

Markdown本文のリンクがNFDで書かれ、実ファイルがNFCである場合（macOS由来のリポジトリで起こりうる）は解決に失敗し、リンクは遷移せずに理由を表示する。リンク解決の側でNFCとNFDの両方を試すことは、行わない（Phase 4で決定）。両方を試すには、Rust側のパス解決へ `unicode-normalization` の依存を足し、NFCとNFDの同名ファイルが共存するときにどちらを開くかの規則を決める必要がある。画像の参照（7.3）と境界判定にも波及し、上で述べた、実在する別々のファイルを同一視する誤りを作りうる。失敗しても、開けないだけで理由が表示され、リンクの表記を直せば回避できる。利用者から報告があれば、再検討する。

予約デバイス名（`CON`、`NUL`、`COM1` など）は拒否しない。Rustの標準ライブラリはverbatimパス（`\\?\`）でファイルを開くため、`CON.md` は通常のファイルとして作成でき、`read_dir` にも `canonicalize` にもそのまま現れる（実測）。拒否すると、ツリーに表示されるのに開けないファイルが生じる。末尾のドットと空白を拒否するのは逆の理由による。Win32のパス正規化がこれらを落とすため、`a.md.` を許すと `a.md` を別名で指す経路になる（実測）。

260文字（`MAX_PATH`）を超えるパスを特別扱いしないのは、Rustの標準ライブラリが絶対パスをverbatimパス（`\\?\`）へ変換してからWin32 APIを呼ぶためである。`WorkspaceRoot` が保持するルートは `canonicalize` を通したverbatimパスであり、そこから組み立てる対象のパスも同じ形式になる。260文字を超える対象について、作成・解決・読込のいずれも成功することを実測で確認した（Phase 4-1cの読込実装時。`src-tauri/src/read.rs` の `long_paths_are_readable` で固定）。マニフェストの長パス対応（`longPathAware`）も、パス長の事前検査も要らない。

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

既存のIDはslug化せず、生成した候補IDと完全一致で比較する。IDの一部をslug化して比べると、実在しないIDを占有してしまう。`[^a.b]` の脚注は `user-content-fn-a.b` というIDを持つが、`fn-a.b` をslug化すると `fn-ab` になる。これを占有すると `# fn-ab` の見出しが `user-content-fn-ab-1` へずれる一方、`#fn-ab` は `user-content-fn-ab` へ解決されるため、リンクが見出しへ到達しない。完全一致で比べれば、前置のない `footnote-label` も候補ID `user-content-footnote-label` とは一致せず、名前空間の区別が自然に保たれる。見出し同士の重複も同じ集合で回避し、採番を1か所に閉じる。連番の探索は、同じ候補の前回の続きから始める。毎回 `-1` から数え直すと、同じ見出しがn個並ぶ文書の全体がO(n²)になり、2万個（10万文字）で約34秒かかった（実測。病的な入力の測定で発見）。使用済みの集合は増える一方のため、前回見つけた連番より小さい番号は必ず使用済みであり、数え直したときと同じIDになる。

同じ名前空間で実際に衝突した場合、`#fn-1` は脚注を指し、見出しへは到達しない。名前空間が1つである以上どちらか一方しか指せず、脚注が先にIDを取る。DOMのID重複（脚注参照が文書順で先の見出しへ吸われ、脚注へ到達できなくなる）を防ぐことを優先した結果であり、この非対称は残る。

このプラグインは数式の描画（`rehypeMath`、8.5）より前に置く。後ろに置くと、KaTeXが生成するMathMLのテキストと `annotation` 要素のLaTeXを二重に拾い、`# 数式 $x^2$ を含む` のIDが `数式-x2x2-を含む` となる（実測）。

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

Content-Typeは拡張子ではなく、Rust側で判定した内容に基づいて返す。判定結果が許可形式に一致しない場合は配信しない。判定と上限の検証の正本は `src-tauri/src/image/format.rs` とする。

形式の判定と寸法の取得には `imagesize` を使う。デコーダーを持つcrate（`image` など）を使わないのは、上限の判定に必要なのがヘッダーの宣言する寸法だけであり、デコードすると上限で防ごうとしているメモリをその場で確保してしまうためである。許可形式のうちラスタの6種がいずれも内容から判定でき、AVIFは同じHEIFコンテナのHEICと区別して取れる（`ImageType::Heif(Compression::Av1)` がAVIFのブランド `avif` / `avio` / `avis` に対応する）ことを実ファイルで確認した。機能はこの6種へ絞り、列挙にない形式（ICO、TIFFなど）は判定されないまま拒否になる。

SVGはピクセル寸法の上限の対象外とし、バイト数の上限（32 MiB）だけで守る。ベクター形式であり、`width` と `height` は省略も単位付きも割合指定もできるため、宣言された値がラスタライズの大きさを決めるとは限らない。属性を読んでも判定できるのは一部に限られ、抜けのある判定を持つよりバイト数の上限だけで守るほうが規則として一貫する。引き換えに、巨大な intrinsic size を宣言するSVGは寸法の検証なしで通る。

SVGかどうかは、ルート要素が `svg` であることで判定する。「どこかに `<svg` を含む」では判定しない。それでは任意のテキストファイルがSVGとして配信され、`Content-Type: image/svg+xml` が実体と食い違う。XMLの前書き（宣言、コメント、DOCTYPE）を読み飛ばし、次に現れる要素が `svg` である場合だけSVGとみなす。UTF-8以外で符号化されたXMLは扱わず、許可形式ではないものとして拒否する。

ルート要素は先頭64 KiBの範囲で探す。前書きの長さに上限はないが、発行時にファイル全体を読まない（5.4）ためには範囲を切る必要がある。配信時も同じ範囲で判定し、発行時と配信時の結果を食い違わせない。前書きがこれを超えるSVGは許可形式ではないものとして拒否する。

Markdownに書かれた画像参照からワークスペース相対パスへの解決は、リンクの解決（[`src/markdown/link-target.ts`](../src/markdown/link-target.ts)）と同じ規則で行う。セグメント単位のパーセント復号、ルート基準表記、`.` と `..` の扱い、クエリと断片の切り落としまで同じである。同じ文書に書かれた `[a](b.md)` と `![a](b.png)` が違う規則で解決されると、書き手から見た振る舞いを説明できない。異なるのは対象の拡張子を見ない点だけであり、画像の形式は内容で判定する。解決はRust側（`src-tauri/src/image/reference.rs`）で行う。ネイティブ絶対パスをFrontendへ渡さない方針（7.1）の下では、相対参照の基点も境界の判定もRust側にしか置けない。

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
  → rehypeMath（KaTeX を数式がある文書でだけ読み込み、MathML を生成。8.5）
  → rehype-sanitize（拡張した strict schema）
  → hast-util-to-jsx-runtime（コードブロックのハイライトはここでコンポーネントが適用する。8.2、8.3）
  → React 要素

mermaid fence
  → Mermaid で SVG 生成
  → DOMPurify（SVG 用 strict allowlist）
  → dangerouslySetInnerHTML（本文描画における唯一の例外）
```

- CommonMarkを基礎とし、`remark-gfm` で表、タスクリスト、取り消し線、autolinkを有効にする。
- `remark-rehype` は既定でRaw HTMLを破棄する。本方針は「Raw HTMLをソース文字列として表示する」であり、破棄でも実行でもない第三の扱いを要する。mdastの `html` ノードをテキストとして出力するhandlerを定義し、`allowDangerousHtml` と `rehype-raw` を使用しない。
- `remark-frontmatter` で文書先頭のYAML front matterを解析し、本文からは除く。`yaml` ノードは `mdast-util-to-hast` にhandlerがなく破棄されるため、非表示は既定の動作で成立する。
- `hast-util-to-jsx-runtime` により本文をReact要素として構築し、本文描画で `dangerouslySetInnerHTML` を使わない。パイプラインの正本は `src/markdown/render.ts` とする。当初はこれを包むunifiedのプラグイン `rehype-react` を使っていたが、コードハイライトの単位で直接呼ぶ形へ改めた。ハイライトの対象と文書の予算はsanitize済みの木を読んで決める必要があり（8.3）、sanitizeの結果を受け取ってから変換する流れのほうが素直で、依存も1つ減るためである。
- `hast-util-to-jsx-runtime` へ `tableCellAlignToStyle: false` を渡し、表の桁揃えを `align` 属性のまま出す。既定では `align` が `style="text-align: ..."` へ変換される（実測）。sanitizeを通った後に `style` 属性を生む経路になり、CSPの `style-src-attr 'none'`（5.5）で桁揃えも無効になる。`align` はsanitize schemaが値まで絞って許可している（8.2）。
- 本文中のリンクのクリック（中クリックと `Ctrl` + クリックを含む）は、描画する要素でまとめて既定動作を止める（`src/preview/MarkdownDocument.tsx`）。止めないと相対リンクでWebView全体が別のURLへ移り、中クリックと `Ctrl` + クリックは新しいウィンドウを開く。
- 画像は、hastを組み立てた後・sanitizeの前に、文書内の `img` の `src` を重複を除いて集め、`issue_image_resources` commandで1回にまとめてresource IDを発行する（5.4）。発行できた画像は `src` を `http://mdperuse-img.localhost/<resource-id>` へ書き換え、発行できなかった画像はその位置を原因の文言を持つ `span.image-error` へ置き換える（7.3）。発行そのものが失敗した場合（ワークスペースを開いていないなど）は、すべての画像の位置にその原因を示す。書き換えなかった `src` はsanitizeの許可パターンに合わないため落ちる。参照は `remark-rehype` がパーセントエンコードした `src` のまま渡し、Rust側がセグメントごとに復号する（7.3）。正本は `src/markdown/images.ts` と `src/markdown/render.ts` とする。
- `loading="lazy"` と `decoding="async"`（7.3）は、sanitizeの後に `img` コンポーネントで固定の値として付ける。sanitize schemaへ許可すると、値を絞る規則をもう1つ持つことになるためである。
- 既定動作を止めたうえで、修飾キーのない左クリック（キーボードでリンクを開いた場合を含む）だけを `resolveLinkTarget`（7.2）で解決して遷移する。同一文書内のアンカーは描画する要素の中で移動し、別の文書、外部URL、解決できなかったリンクは呼び出し側へ渡す。`Ctrl` + クリック、`Shift` + クリック、中クリックは新しいウィンドウを開く操作であり、同じタブで開く動作へ読み替えずに何もしない。脚注の相互参照リンクは `data-footnote-ref` / `data-footnote-backref` 属性で経路を分け、前置済みのIDへ移動する（`src/preview/link-click.ts`）。別の文書のアンカー（`./other.md#section`）へは、描画が新しい本文に追いついてから移動する。追いつく前に探すと、前の文書の同名の見出しへ移動しうる。
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

許可する要素は、remark-gfm、remark-math、KaTeX（`output: "mathml"`）を通した実測と、KaTeXが生成しうるMathMLノードの列挙に基づく。

schemaの検証は2段構えで行う。要素と属性を手で組む単体テストに加えて、本文描画と同じ組み立て（`markdownToHast`）を通した結果をsanitizeへ流す統合テストを置く。単体テストだけでは、上流のプラグインが実際に何を生成するかを検証できない。許可し忘れた属性やIDの二重前置は統合テストで捕まえる。

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
- 脚注セクションの見出し（remark-gfm が `class="sr-only"` を付けて出す `h2`）は `id` だけを許可し、`class` は落ちる。`className` を許可せず、CSSが構造（`section[data-footnotes] > h2`）で選んで視覚的にだけ隠す（`src/App.css`）。許可の全列挙を広げずに済み、隠す対象も脚注セクションの見出しに限られる。`display: none` にはしない。アクセシビリティツリーから外れ、見出しへの移動ができなくなる。構造と属性が変わると隠れなくなるため、`pipeline.test.ts` が固定する。

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

allowlistを次の28名で確定した（Phase 4-2）。正本は `src/markdown/highlight.ts` とする。

`typescript`、`javascript`、`tsx`、`jsx`、`json`、`rust`、`python`、`go`、`c`、`cpp`、`csharp`、`java`、`kotlin`、`swift`、`sql`、`bash`、`powershell`、`yaml`、`toml`、`ini`、`xml`、`html`、`css`、`diff`、`dockerfile`、`makefile`、`markdown`、`plaintext`

highlight.js 11 は `tsx`、`jsx`、`toml`、`html` を単独の文法として持たない。それぞれ `typescript`、`javascript`、`ini`、`xml` の別名として写像し、登録する文法は24個になる。そのほかの別名（`ts`、`sh`、`yml`、`ps1`、`c++` など）も、各文法が定義する別名のうちfenceの言語名として使われうるものを正規名へ写像する。言語名はsanitize schemaが `language-[a-z0-9+#-]+` に絞るため、大文字を含む指定（`TypeScript` など）はclassごと落ちてプレーン表示になる。

文法は言語ごとの動的importで、その言語が初めて現れたときに登録する。読込を待つ間はプレーンなテキストのまま表示する。読込やハイライトに失敗した場合もプレーンなまま残し、ブロックの直後に言語名と原因を示す（12章）。

ハイライトの対象は、sanitize済みの木で `pre > code` のうちallowlistの言語を持つブロックとする。インラインコードと数式（`language-math`）は対象外である。対象と文書の予算はsanitizeの後に木を読むだけで決め、要素も属性も加えない。変換時に `pre` コンポーネントが、対象のブロックだけlowlightの出力をReact要素へ変換して表示する（8.2）。`code` ではなく `pre` を差し替えるのは、失敗の表示を `pre` の外、ブロックの直後に置くためである。`code` の中に置くと、コードの選択とコピーに文言が混ざる。

`forced-colors` が有効なときは配色によるトークン区別が失われるため、太字と斜体による区別へ切り替える。

ハイライトの上限は1ブロック64 KiB、1文書の合計256 KiBとする。値は `src/markdown/limits.ts` を正本とする。超過したブロックはハイライトせず、プレーンな `pre/code` として表示する。選択とコピーは変わらず行える。

二段で抑えるのは、文書の描画の性能目標（[spec.md](./spec.md) 5.1）をハイライトだけで使い切らないためである。lowlightの処理時間は入力サイズにほぼ比例し、49 KiBで28 ms、488 KiBで198 msだった（実測）。ブロック単位だけの制限では、64 KiB弱のブロックが16個並ぶ1 MiBの文書で、ハイライトだけで約560 msかかり、250 KiBまでの目標（500 ms）に相当する時間を使い切る。

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

実装の正本は `src/markdown/mermaid.ts`（設定、sanitize、描画の順番待ち）と `src/preview/MermaidDiagram.tsx`（表示とテーマ）とする。Phase 4-2で次を実測し、決めた。

- 図の定義（`%%{init}%%` とfront matterの `config`）から上書きさせない設定（`secure`）へ、既定の6項目に `htmlLabels`、`flowchart`、`themeCSS` を加える。加えないと、図の定義から `htmlLabels` を有効にして `foreignObject` を生成でき、`themeCSS` で任意のCSSを `style` 要素へ流し込めた（実測）。
- `suppressErrorRendering` を有効にする。既定では構文エラーの図をMermaidが文書の末尾へ描画した（実測）。理由は自前の要素で示す。
- 生成SVGのsanitizeはDOMPurifyのSVGプロファイル（`svg`、`svgFilters`）に、`foreignObject` の禁止と `href` / `xlink:href` の禁止を加える。テーマの `style` 要素は残す（5.5の `style-src-elem`）。生成された `style` 要素のセレクタはすべて図のIDで始まり、図の外へ効くものはなかった（実測）。
- `style` 属性は、SVGの表示属性として正当なプロパティで、値が色・長さ・数値の列か色の関数表記（`rgb()`、`hsl()` など）のものだけを属性へ移す（5.5）。`url(` を含む値は移さない。svg要素の `max-width`（px）は `width` 属性へ移し、表示幅への収まりはCSSの `max-width: 100%` で行う。
- テーマは `prefers-color-scheme` から `default` / `dark` を選び、`forced-colors` が有効なときは `neutral` にする。どちらのメディアクエリが変わっても描画し直す。`neutral` は明るい背景向けのため、`forced-colors` の図は白い下地に載せる（10.6）。
- `prefers-reduced-motion: reduce` のときは、エッジのアニメーションを `App.css` の規則（`.markdown-body .mermaid-diagram svg *` の `animation: none !important`）で止める。図の定義の `animate: true` や `animation: fast` / `slow` は、Mermaidが図の `style` 要素へ `animation: dash ... infinite`（`@keyframes dash`）として出力する。この `style` 要素はsanitizeもCSP（5.5の `style-src-elem`）も通すため、何もしなければOSの設定によらず動き続ける（Chromiumで実測。WebView2でも同じ）。Mermaid 12.0.0のCSSが `animation` を使うのはこの `slow` と `fast` の2つだけで、SMILのアニメーション要素は出さない。止めても `stroke-dasharray` は残るので、動く線であることは破線の模様で分かる。メディアクエリは実行中に追従するため、`forced-colors` と違って再描画は要らない。
- 描画のタイムアウトは打ち切って理由を示すが、Mermaidの描画そのものは止められない。打ち切った描画が終わるまで同時描画の枠は空けない。空けると、止まらない描画が積み重なる。
- 描画を待つ間と、描画できなかった図、1文書の上限を超えた図は、定義をコードブロックとして残し、描画できなかった図と上限を超えた図はブロックの直後に理由を示す（12章）。
- sanitizeのテストはjsdom上で行う。happy-domではDOMPurifyが要素名を取得できず、SVGプロファイルで `svg` 要素ごと除去される（実測）。本番のDOMPurifyはWebView2上で動く。

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

`forced-colors` が有効なときは、Mermaidのテーマを高コントラスト向けへ切り替え、色ではなく形状と境界線で区別する。黒い背景では `neutral` の線と文字が背景に沈むため、図を白い下地に載せる（10.6）。

### 8.5 数式

- `remark-math` で構文を解析し、自前の `rehypeMath`（`src/markdown/math.ts`）でKaTeXを呼んで描画する。`rehype-katex` は数式ごとの上限の判定と、構文エラーを自前の要素で示す口を持たないため採らない（Phase 4-2で判断）。対象の選び方（`language-math`、`math-display`、`math-inline`）は `rehype-katex` と同じにする。
- 数式を含む文書を開いたときだけKaTeXをlazy importする。MathJaxは採用しない。読み込めなかった場合は、すべての数式の位置にソースと理由を示す（12章）。
- 出力は `output: "mathml"` としてMathMLだけを生成する。既定の `htmlAndMathml` は `span` へインラインの `style` を付け、`\sqrt` などで `svg` と `path` も生成するため、「`style` 属性を許可しない」という8.2の方針と両立しない。MathMLだけであれば追加の許可が要らず、KaTeXのフォント同梱も不要になる。描画品質はWebView2のMathML Core実装に依存する。
- `trust` を無効にし、`\href` や `\includegraphics` を禁止する。
- マクロ展開の上限（`maxExpand`）を1000、ユーザー指定寸法の上限（`maxSize`）を50 emとする。値は `src/markdown/limits.ts` を正本とする。
- 構文エラーは本文全体を壊さず、該当箇所に原因を表示する。KaTeXのエラー表示（`style` 付きの `span.katex-error`）は使わず、`throwOnError` を有効にして例外を受け、ソースと理由を持つ `span.math-error` を自前で置く。上限を超えた数式も同じ要素で示す。
- KaTeXの出力を `rehype-sanitize` が除去しないよう、8.2のschema拡張と整合させる。

上限の値と、上限で守れない範囲は次のとおり。いずれも実測に基づく。

- `maxExpand` はKaTeXの既定値と同じ1000だが、既定に依存せず明示する。`\def\a{\a}\a` の無限再帰と、4段のマクロ展開爆発はこの値で停止しエラー表示に変わる。3段（出力1万文字規模）は通るが、実害のある規模ではない。
- `maxSize` はユーザーが指定できる寸法の上限（em）であり、出力サイズの上限ではない。`\rule`、`\hspace`、`\kern` の値を50 emへ切り詰める。当初「出力サイズの上限」と記していたのは誤りであり、実測に基づき改めた。
- `\raisebox` の `voffset` は `maxSize` の対象外で、`\raisebox{500em}{x}` は500 emのまま出力される。KaTeX側の制限であり本アプリでは塞げない。sanitize schemaは `voffset` の値を書式（`MATHML_LENGTH`）でしか制限しないため、大きさは通る。この抜けはテストで固定し、KaTeX側で塞げるようになったらテストが失敗して方針を見直せる状態にする。
- 入力サイズの上限を、1つの数式で16 KiB、1文書で描画する数式の合計で64 KiBとする。超過した数式は描画せず、ソースをそのまま表示して理由を示す。判定は `shouldRenderMath` を正本とする。
- 上限をMarkdownの10 MiBとは別に設けるのは、KaTeXの出力が入力の約11倍へ膨張するためである。`x+` の繰り返しで測ると、出力／入力比は1 KiBから977 KiBまで11.0〜11.2倍で一定であり、977 KiBの単一数式は468 ms・出力10.7 MiBとなる（実測）。1 MiBの単一数式だけで、文書の描画の性能目標（[spec.md](./spec.md) 5.1）を使い切りうる（出力10.7 MiBがDOMへ流れ、その後の描画も重い）ため、Markdownの上限では律速できない。当初「Markdownの10 MiB上限で律速される」と記していたのは誤りであり、5万項（342 KiB、247 ms）までの測定から誤って一般化していた。
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
| 対象外 | KaTeXの出力（`.katex`）とMermaidが生成するSVG（`svg`）、脚注セクションの見出し（`section[data-footnotes] > h2`）、およびプレビュー本文の外（サイドバー、タブバー、パンくず） |
| 一致規則 | 大文字小文字のみ吸収する。全角と半角、濁点の合成は吸収しない |
| 一致の数え方 | 重なる一致は数えない。`aaaa` から `aa` を探すと2件 |
| 一致件数の上限 | 1000件。超過分は探索を打ち切る |

KaTeXの出力を外すのは、MathMLのテキストと `annotation` 要素のLaTeXソースを同時に持ち、走査すると同じ数式が二重にヒットするためである。同じ構造が見出しIDの生成でも問題になっている（7.2）。MermaidのSVGを外すのは、`text` 要素の配置が図形のレイアウトに従い、`::highlight()` を掛けたときの見え方を保証できないためである。脚注セクションの見出し（`Footnotes`）を外すのは、スクリーンリーダー向けに視覚的にだけ隠している（8.2）ため、一致しても画面に見えないからである。脚注の本文は含める。コードブロックは含める。lowlightが入れるのは `span` の入れ子だけで、テキストノードを文書順につなげば素直に一致を取れる。

一致規則を大文字小文字だけに絞るのは、`Range` のオフセットとの対応を保つためである。畳んだ文字列と元の文字列でUTF-16コードユニット数が変わると、一致位置をDOMへ戻せない。文字列全体へ `toLowerCase()` を掛けると長さが変わりうる。`"İ"` は1コードユニットだが小文字化すると `"i̇"` の2コードユニットになる（実測）。そこでコードポイントごとに小文字化し、長さが変わる文字は元のまま残す。互換正規化（NFKC相当）はコードユニット数を変えるため、正規化後の位置を元のオフセットへ戻す写像を別に持つことになり、ハイライト位置がずれる不具合を招きやすい。

この規則の下では語末シグマ `ς` が `Σ` と一致しない。`Σ` の小文字化は `σ` である一方、`ς` の小文字化は `ς` のままだからである（実測）。長さを保つことを優先した結果として残る非対称であり、テストで固定する。

件数の上限を設けるのは、一致1件につき `Range` を1つ生成するためである。上限がないと10 MiBのMarkdown（8.3）で1文字を検索したときに数万件を抱える。そこまで多い一致を順に見て回る操作には意味がない。

テキストノードをつなぐとき、ブロック要素（段落、見出し、リスト項目、表のセル、`pre` など）と `br` の境目には改行を挟む。段落の末尾と次の段落の先頭をつないだ一致を出さないためである。検索欄は1行の `input` であり検索語は改行を含まないため、境目をまたぐ一致は生じない。インライン要素（強調、リンク、lowlightの `span`）をまたぐ一致は取る。DOMの走査と `Range` の生成は `src/preview/find-ranges.ts` による。

本文のDOMは描画の後にも入れ替わる。コードハイライトは文法の読込後にテキストを `span` へ差し替え、Mermaidは待機中に表示していた定義を図へ差し替え、テーマの変更でも描き直す（8.3、8.4）。登録済みの `Range` はそのたびに外れたノードを指し、ハイライトが消えて件数も実態とずれる。そこで検索中は本文を `MutationObserver` で監視し、変化を1フレーム分まとめて同じ検索語で探し直す。現在位置は添字を保ち、件数を超えたら末尾へ詰める。探し直しではスクロールしない。描画の完了を子のコンポーネントから通知させる案は、描画の経路を増やすたびに通知を足す必要があり、再読込（6.5）など将来の差し替えにも追従しないため採らない。

`F3` は検索欄を開いていない間も奪い、検索欄を開く。検索欄はプレビュー本文があるときだけ置く。WebView2標準の検索バーはブラウザーアクセラレータキーの無効化（10.1）で開かなくなっており、本文がない状態の `Ctrl+F` / `F3` は何もしない（実測）。

一致と現在位置は別の名前のハイライトとして登録し、現在位置は全体のハイライトから外す。同じ範囲を2つのハイライトへ重ねたときの描画順に依存しないためである。

`forced-colors` が有効な間は、現在位置だけを登録する。Chromiumは `forced-colors` のとき、`::highlight()` の背景と文字色を作者の指定（`Mark` などのシステムカラーを含む）によらず `Highlight` / `HighlightText` へ置き換え、`text-decoration` も描かない。`::highlight()` に `forced-color-adjust: none` を書いても効かない（Chromiumのエミュレーションで実測）。本文の要素へ `forced-color-adjust: none` を付ければ塗り分けられるが、本文全体でシステムカラーへの置き換えが止まり、本文の配色をすべて自前で持ち直すことになるため採らない。現在位置の枠を `Range.getClientRects()` の位置へ重ねる案は、スクロール、リサイズ、文字サイズの変更への追従が要るため採らない。この条件では他の一致の所在は画面に出ず、件数の表示だけで伝わる。

操作は次のとおりとする。いずれもWebView内で処理し、ネイティブメニューへは項目を置かない（10.1）。

| 操作 | キー |
| --- | --- |
| 検索を開く | `Ctrl+F` |
| 次の一致へ | `Enter`、`F3` |
| 前の一致へ | `Shift+Enter`、`Shift+F3` |
| 検索を閉じる | `Esc` |

### 8.7 大きい・複雑な文書の書式なし表示

**書式を付けて描画する文書に上限を設け、超えた文書はパースせず、ソースを `pre` へそのまま示す。** 上限は、文字数60万、空行で区切られた1つのブロックの10万文字、「リスト項目数 × 文字数」の50億の3つである（`src/markdown/limits.ts` の `DOCUMENT_LIMITS`）。どれかを超えると、理由を添えた案内（`role="note"`）を本文の先頭に置く。リンクと画像は表示されない。選択、コピー、文書内検索は、書式ありの本文と同じく使える。

10 MiBの上限（[spec.md](./spec.md) 9章）まで読み込めるのに、描画が数十秒かかり、その間WebViewが応答しなくなることが、性能目標の再測定（Phase 4）で分かった。原因と根拠は次のとおりである。

**実測（Release、WebView2 154、Core i7-12700K。クリックから、DOMへの反映と強制レイアウトが済むまで）**

| 文書 | 文字数 | リスト項目数 | 表示時間 |
| --- | ---: | ---: | ---: |
| コードと数式を含む 250 KiB | 13万 | 936 | 約0.3秒 |
| 同 500 KiB | 26万 | 1856 | 約0.6秒 |
| 同 1 MiB | 54万 | 3792 | 約1.3秒 |
| 同 2 MiB | 109万 | 7568 | 約3.3秒 |
| 同 4 MiB | 218万 | 15056 | 約9.7秒 |
| 同 10 MiB（上限） | 543万 | 37224 | 約40秒 |
| リスト主体 500 KiB | 28万 | 12816 | 約1.05秒 |
| リスト主体 1 MiB | 57万 | 25984 | 約2.3秒 |
| 単一のリスト 500 KiB | 26万 | 13766 | 約1.1秒 |
| 単一のリスト 1 MiB | 55万 | 27886 | 約4.1秒 |
| ネストしたリスト 250 KiB | 21万 | 21400 | 約1.9秒 |
| ネストしたリスト 500 KiB | 43万 | 41092 | 約6.1秒 |
| ネストしたリスト 1 MiB | 88万 | 82366 | 約54秒 |

- 表示時間は、リストの項目が少ない文書では文字数にほぼ比例する（約2.4 µs／文字）。バイト数ではなく文字数で決まるため、上限も文字数で持つ。日本語主体の文書は1文字が3バイトである。
- リストの項目が多いと、時間が「項目数 × 文字数」に比例して加わる。パース時間を構文ごとに測ると、二乗で伸びるのはリストだけで、表・引用・見出し・コード・数式は線形だった。
- 原因は `mdast-util-from-markdown`（2.0.3。導入時点の最新版）の `prepareList` である。リストの項目ごとに、文書全体のイベント配列の途中へ `events.splice(index, 0, ...)` で2件を挿入する。配列が長いほど1回が高くつくため、項目数 × 文字数になる。CPUプロファイルでも、4 MiBの表示で `prepareList` が約3秒を占めた。
- 次いで、Reactのコミットが二乗になる。永続する `article` へ、新しい兄弟要素を大量に1件ずつ挿入すると、挿入のたびに `getHostSibling` が後続の兄弟をなめる。項目の少ない4 MiBの文書で約1.9秒、1 MiBで約0.2秒にとどまるが、兄弟要素が多い文書（水平線11.8万個、短い段落7.4万個など）では、CPUプロファイルの9割を占めた（下の表）。本文の要素を、文書のパスで鍵を付けた `div` で包む（`MarkdownDocument`）。別の文書へ替えるときは、新しい部分木を親へ付ける前に作り、1回で挿入する。同じ文書の再読込は鍵が変わらず、これまでどおり差分で更新するため、Mermaidの図の状態は保たれる。鍵は、本文の描画が済んだときにその文書のパスへ替える。パスだけが先に替わる間に、前の本文を新しい鍵で作り直さないためである。

**上限の決め方。** 上限内の最悪ケースを約2秒に収める。文字数60万は、日本語主体で約1 MiBの文書が約1.4秒で描画できる上限である。「項目数 × 文字数」の50億は、この上限までに実測した最も遅いネストしたリスト（項目数21400、21万文字、積は4.6×10⁹）が約1.9秒であることから決めた。

- 文字数を先に見て、超えていれば項目を数えない。項目の数え上げは、文字数が上限内の文書にだけ行い、積が上限を超えた時点で打ち切る。10 MiBの文書でも一定時間で判定できる。
- 項目は、各行で、行頭の接頭辞（空白、タブ、引用の `>`）を読み飛ばし、続くマーカー（`-`、`*`、`+`、`1.`、`1)`。番号は9桁まで）とそれに続く空白を、連なる分だけ1つずつ数える。引用の中のリスト（`> - a`）と、同じ行に連なるマーカー（`- - a`、`> 1. - a`）と、引用を挟んで連なるマーカー（`- > - a`。マーカーの後に、引用の `>` と空白を読み飛ばして、続くマーカーを数える）も、パーサーは項目として処理するためである（レビュー指摘。7万項目・42万文字の `> - a` は、数えないとパースだけで約19秒かかった）。コードブロックの中の行も数えるが、多く見積もる側であり、書式なしへ倒れるだけで壊れない。
- 数え上げは、正規表現ではなく文字列の1回の走査で行い、文字数に比例する。接頭辞を後読みで確かめる正規表現は、マーカーが連なる長い行で、候補ごとに行頭まで戻って二乗になり、判定そのものが固まる。
- ブロックの長さは、空行（空白とタブだけの行を含む）で区切られた、連続する行の文字数で数える。段落、表、リストがこれに当たる。行の種類は見分けず、フェンスコードの中も数える。フェンスコードの中は記法の解析にかからないため、数えない案を先に実装したが、レビューで、開始の行（情報文字列にバッククォートを含む行はフェンスではない）と閉じる行（開始より短い連なりでは閉じない）の判定がパーサーとずれ、後続の長い段落を数え落として上限を回避できると続けて指摘された。ある行がフェンスかどうかは、パーサーの状態（front matter、数式ブロック、HTMLブロック、引用やリストの中）に依存し、この判定では再現しきれない。数え落とす側の誤りは上限を回避されるが、数えすぎる側の誤りは、空行のない10万文字を超えるコードブロックを含む文書が書式なしになるだけで壊れないため、フェンスを見分けない。これも1回の走査で、超えた時点で打ち切る。10万文字は、1つのブロックの最悪（強調の入れ子の連続で約2.3秒）から決めた。
- 書式なしの表示は、`white-space: pre-wrap` の `pre` である。`pre` だけのレイアウトは、10 MiB相当（543万文字）でも約1秒だった（Chromiumで実測）。
- 本文は、5,000〜10,000文字ごとの隣り合うテキストノードに分けて `pre` へ入れる（`src/preview/plain-chunks.ts` の `splitPlainText`）。1つの巨大なテキストノードは、アクセシビリティ木が有効な環境（スクリーンリーダーなど）で、更新が長さの二乗に近く伸びる（543万文字で148秒）。1行が極端に長いテキストは、レイアウトも二乗に伸びる（109万文字の1行で約81秒）。分けると、アクセシビリティ木が有効でも、10 MiBが約2.1〜2.3秒で表示できる（13.6）。改行の直後、なければ空白の直後で切り、どちらもなければ上限で切る。切れ目は、文字（書記素）の境界へ寄せる（`Intl.Segmenter`。サロゲートペア、結合文字、ゼロ幅接合子、肌色の修飾子、国旗、タグ文字の並びを途中で切らない）。境界の判定は、文字の境界と分かっている位置（空白、またはその文字列の先頭）から始める。範囲の先頭が文字の途中だと、`Intl.Segmenter` が前の文脈を知らず、ZWJでつながる絵文字の途中に偽の境界を返す（レビュー指摘）。境界を探す範囲は32単位に限り、結合文字が数百万個続く入力でも、1つの文字列は `chunkChars` の2倍に33を足した長さ（既定で10,033文字）を超えない（レビュー指摘。範囲を限らないと、そのような入力で単一の巨大なノードが残る）。走査は本文の長さに比例する。隣り合うテキストノードでも、表示、選択、コピー、文書内検索は、1つのノードのときと変わらない。長さは、1,000〜5,000文字で差が無く、20,000文字からアクセシビリティの費用が増えたため、5,000文字とした。

**変更後の実測（同じ条件。3回の範囲）**

| 文書 | 表示 | 表示時間 |
| --- | --- | ---: |
| コードと数式を含む 250 KiB | 書式あり | 0.30〜0.33秒 |
| 同 1 MiB | 書式あり | 1.4秒（2.15秒の外れ値が1回） |
| 文字数の境界の内側（59万文字） | 書式あり | 1.54〜1.56秒 |
| 文字数の境界の外側（62万文字） | 書式なし | 0.23〜0.26秒 |
| ネストしたリストの境界の内側（2.2万項目、22万文字、積 4.8×10⁹）。ブロックの上限を足す前 | 書式あり | 1.96〜2.28秒 |
| ネストしたリストの境界の外側（2.4万項目、24万文字、積 5.8×10⁹） | 書式なし | 0.10〜0.12秒 |
| ネストしたリスト 1 MiB（8.2万項目） | 書式なし | 0.35〜0.43秒（変更前 約54秒） |
| 単一のリスト 1 MiB / リスト主体 1 MiB | 書式なし | 0.19〜0.23秒（変更前 約4.1秒 / 約2.3秒） |
| コードと数式を含む 2 MiB / 4 MiB | 書式なし | 0.36〜0.41秒 / 0.84〜0.86秒（変更前 約3.3秒 / 約9.7秒） |
| 同 10 MiB（上限） | 書式なし | 1.84〜2.07秒（変更前 約40秒。ファイルの読込とIPCを含む） |

ブロックの上限（下の「病的な入力」）を足す前は、書式ありで残る最悪のケースが、境界の内側のネストしたリストの約2.3秒だった。足した後は、この入力（1つのブロックが22万文字）は書式なしになり、通常の本文で書式ありに残る最悪は、文字数の境界の内側（59万文字）の約1.5秒である。記法が密な入力の最悪は、下に示す。

**病的な入力（59万文字。書式ありの上限の内側）の実測。** 描画パイプラインへ、記法を1種類だけ大量に並べた文書を流した（実機、Release）。ノード数が多い文書は、鍵付きの `div` で大きく改善した。

| 入力 | 鍵付きの `div` の前 | 後 |
| --- | ---: | ---: |
| `---` の連続（11.8万個の水平線） | 117秒 | 9.1秒 |
| 短い段落の連続（7.4万個） | 37.7秒 | 5.8秒 |
| 見出しの連続（4.8万個。すべて別名） | 15.1秒 | 2.7秒 |
| HTMLコメントの連続（4.9万個） | 18.8秒 | 2.5秒 |

一方、巨大な1つの段落や表に、記法が密に並ぶ入力は変わらず遅い。原因は解析ライブラリの二乗である（CPUプロファイルで、`micromark` の `resolveData`（隣り合う `data` イベントの結合）が、ループの中で `splice` を使い、支配的だった）。

| 入力（1つの段落。表は1つの表） | 59万文字 | 10万文字 | 5万文字 |
| --- | ---: | ---: | ---: |
| 強調の入れ子（`**a *b `c` d* e** `） | 73秒 | 2.3秒 | 0.28秒 |
| 短い数式 `$x$` の連続 | 25.8秒 | 1.7秒 | 0.71秒 |
| 参照リンク `[r]` の連続 | 25.0秒 | 1.2秒 | 0.45秒 |
| リンク `[a](/b)` の連続 | 7.8秒 | 0.55秒 | 0.24秒 |
| 表（5.9万行） | 5.8秒 | 0.66秒 | 0.31秒 |

段落や表のサイズを抑えれば、二乗の項は小さくなる。そこで、空行で区切られた1つのブロックを10万文字までに抑える（`richMaxBlockChars`。超えた文書は書式なしで表示する）。1つのブロックの最悪は約2.3秒になる。

**変更後の実測（59万文字の文書。実機、Release）。** 上の表の入力は、1つのブロックが上限を超えるため、すべて書式なしになり、0.04〜0.31秒で表示された。空行で区切った9.9万文字のブロックを6つ並べた、上限の内側で最悪の形は次のとおりである。ブロックの合計は抑えられず、通常の本文の1.3秒に対して、記法が密な入力は数倍から十数倍かかる。

| 入力（9.9万文字のブロック×6） | 表示時間 | 変更前（1ブロック、59万文字） |
| --- | ---: | ---: |
| 強調の入れ子 | 17.5秒 | 73秒 |
| 短い数式 `$x$` の連続 | 10.6秒 | 25.8秒 |
| 参照リンク `[r]` の連続 | 7.2秒 | 25.0秒 |
| 表（各1.0万行） | 3.9秒 | 5.8秒 |
| リンク `[a](/b)` の連続 | 3.1秒 | 7.8秒 |

小さなブロックが大量に並ぶ入力は、ブロック単位の上限に掛からない。鍵付きの `div` の後で、水平線11.8万個が8.0秒、短い段落7.4万個が5.0秒、HTMLコメント4.9万個が2.4秒だった。どれも上限内の文書に対して有限で、画面は固まるが、いずれ描画が終わる。時間切れで書式なしへ落とすには、Web Workerが要る（採らなかった案）。

**採らなかった案。**

- 依存へパッチを当て、`prepareList` の挿入を一括にして線形にする案。根本原因を直せるが、依存のパッチは更新のたびに追従が要る負債であり、パース結果が変わらないことを比較するテストも要る。上流へ修正を提案し、取り込まれたら、この上限のうち項目数の項を外す。
- パースをWeb Workerへ移し、時間切れで書式なしへ落とす案。どんな病的な入力でも画面が固まらず、古い描画を中断できる。一方、バンドル、CSP、数式のDOM依存（`hast-util-from-html-isomorphic`）、hastの受け渡しが要り、大きな変更になる。Reactのコミット（1 MiBで約0.9秒）は結局メインスレッドで行う。

## 9. タブと起動

### 9.1 タブ

- アプリは原則1インスタンス、1ウィンドウ、1 WebViewとする。
- 複数タブをReact側で管理し、アクティブタブだけ本文DOMを保持する。
- 非アクティブタブはインスタンスID、スコープID、パス、タイトル、スクロール位置、状態（`loaded` / `stale` / `deleted`）、読込世代を保持する。`stale` は外部でファイルが変更され再読込が必要になった状態を指す（6.5）。本アプリはRead-onlyであり、編集による未保存状態は存在しない。
- 同一文書を重複して開かない。
- loose tabは、関連付け起動またはドラッグ＆ドロップ（10.4）でワークスペース外のファイルを開いたときにだけ生じる。文書内のリンクからは生じない（7.2）。利用者がOS経由で明示的に渡したファイルと、文書に書かれた信頼できない入力とを分けるためである。
- loose tabは、そのファイルの所在フォルダーを暗黙のルートとして扱う。配下の相対Markdownリンクと相対画像は解決するが、ツリーへは展開せず、走査も行わない。暗黙のルートを持たせないと、関連付けで開いた文書の画像がすべてエラー表示になる。監視は開いているファイル1件に限り、暗黙のルート配下は再帰監視しない（6.4）。
- 画像resource IDのソルトとマップ（5.4）は、暗黙のルートを単位として発行する。
- loose tabのスコープは、loose tab 1つにつき1つ採番する（`AppState::open_loose`）。同じ暗黙のルートで同じ文書を監視しているスコープがあれば、それを返して重複して開かない。文書を開くときにだけ暗黙のルート（所在フォルダー）を決め、Frontendへは絶対パスではなく、スコープIDとスコープ相対パス、所在フォルダーの表示名（末尾2コンポーネント。パンくずのルートに使う）を渡す（`OpenDocumentEvent`）。
- 同じ相対パスが、ワークスペースと複数のloose tabで衝突する（6.4）。タブの重複の判定はスコープIDと相対パスの組で行う。ツリーで選択されるのは、ワークスペースの文書だけである。
- loose tabにはツリーがないため、パンくずのフォルダーは選べない文字として出す。ワークスペースを開いていなくても、loose tabがあれば文書を表示する。サイドバーは出さず、welcome状態はワークスペースもタブもないときだけである（9.2）。
- ワークスペースの切り替えと「ワークスペースを閉じる」は、loose tabも破棄する（6.1）。タブを閉じたときと、上限で退避されたときは、そのスコープと監視を閉じる（`close_loose_scope_command`）。Frontendは、開いているタブの集合の変化から、なくなったスコープを検出して求める。タブを閉じてから閉じる要求が届くまでの間に、同じ文書を開き直すと、閉じる要求が新しいタブのスコープを閉じうる。その場合、次の読込が `workspaceNotFound` で失敗し、最初の読込に失敗したタブは閉じて理由を示す（下記）ため、開き直せば復旧する。

#### プレビュータブ

**ツリーから開いた文書は、まずプレビュータブとして開く。** VS CodeのExplorerとeditor groupの操作に揃え、ツリーを眺めるだけでタブが増えて上限の退避が起きないようにするためである。規則の正本は `src/state/tab-set.ts` とする。

- プレビュータブは常に最大1枚とし、斜体で示す。次のプレビューはそのタブを同じ位置で差し替え、履歴も新しくする（タブのインスタンスIDを替えるため、読込中だった応答は6.5の照合で捨てられる）。
- ツリーのシングルクリックと `Space` はプレビューで、ダブルクリックと `Enter` は固定タブで開く。
- プレビュータブは次の操作で固定タブになる。タブのダブルクリック、ツリーでの固定での開き直し、タブの中での表示の変更（本文のリンク、見出しへの移動）。表示を変えたタブを固定するのは、積んだ履歴を次のプレビューで黙って捨てないためである。スクロールと文書内検索では固定しない。
- 同じ文書が既に開いていれば、そのタブへ切り替える（プレビューで開き直しても固定タブは固定のまま）。読込中の遷移先も同じ文書として扱う（遷移先は読込の世代と組で持ち、文書内の移動やファイルの変更でその読込が無効になったら扱わない）。見出しを指すリンクで切り替えたときは、そのタブで見出しへ移り、履歴に積む。
- 新しいタブはアクティブタブの右に加える。
- アクティブタブを閉じたときは右隣、なければ左隣をアクティブにする。
- 非アクティブタブは本文を持たないため（上記）、アクティブにするたびに読み直し、離れたときのスクロール位置へ戻す。離れたときの位置は、画面に出ていたタブの分だけ記録する（切替直後の画面には前のタブの本文が残っているため、その位置を切替先へ書き込まない）。読込中のタブへ切り替えたときは読み直さず、進行中の読込の完了で表示する（失敗したら元の文書を表示する）。
- 最初の読込に失敗したタブは閉じ、理由を表示する。

タブバーは `src/tabs/TabBar.tsx` とし、WAI-ARIAのtabsパターン（`tablist` / `tab` / `tabpanel`）に従う。`←` / `→` でフォーカスを移しながらアクティブにし（自動アクティブ化）、`Home` / `End` で端へ移る。閉じるボタンと中クリックで閉じる。`Ctrl+Tab` / `Ctrl+Shift+Tab` は並び順で次・前のタブへ移り、端では反対側へ回る（10.1のとおりWebView内で処理する。WebView2のブラウザーアクセラレータキーを無効にした状態でもページへ届くことを実測で確認した）。タブバーは本文と一緒にスクロールしないよう、プレビュー領域の上に置く。

幅に収まらないタブは横にスクロールする。アクティブなタブが変わったときと、タブバーの幅が変わったときに、アクティブなタブを `scrollIntoView({ block: "nearest", inline: "nearest" })` で見える位置へ動かす。`behavior` は指定せず即時に動かすため、Reduced Motion（10章）でも動きを伴わない。矢印キーは `focus()` で動くが、ツリーから開いた新しいタブ、`Ctrl+Tab`、タブを閉じた後の切り替えでは動かず、アクティブなタブが画面外に残った（実測。幅640 pxで6つ目のタブが見えなかった）。ウィンドウを狭めたときも、右端にあったアクティブなタブが隠れた（500 pxで実測）。スクロールバーは `scrollbar-width: thin` で細くする（約15 pxから約9 px。矢印は残る）。実装は `src/tabs/TabBar.tsx` と、幅の観測 `src/layout/use-resize-observer.ts` とする。

次の案は採らない。スクロールバーを非表示にする案は、マウスだけであふれたタブへ届く手段が `Shift` + ホイールとタッチパッドだけになり、ドラッグもできなくなるため。タブを縮める案（Chrome流）は、`document-01-…` のように接頭辞の同じタイトルを見分けにくくするため。あふれたタブの一覧ボタンの案は、メニュー、キー操作、ARIAの部品を足すことになり、上限20枚の現状では過剰なため。

同時に開けるタブ数の上限は20とし、超過するときは最後にアクティブだった時刻が最も古い非アクティブタブを閉じる。値と規則の正本は `src/state/tabs.ts` とする。

新規オープンを拒否しないのは、関連付け起動がOSから渡される利用者の明示的な操作であり、エクスプローラーからのダブルクリックが無反応に見える経路を作らないためである。本アプリはRead-onlyで編集による未保存状態が存在しないため（9.1）、自動で閉じても失われるのはスクロール位置だけである。

上限をメモリではなくタブバーの可読性で決めたのは、非アクティブタブが本文DOMを持たないためである。閉じる候補は最終アクティブ時刻で選ぶ。タブの並び順で選ぶと、並べ替えたときに最近見たタブが閉じられうる。

`deleted` 状態のタブ（6.5）も候補に含める。上限は十分に大きく、削除済みタブがそこまで溜まるのは異常な状態である。状態で候補を分けると「候補がないときは新規オープンを拒否する」という別の振る舞いが必要になり、同じ「タブを開く」操作が経路ごとに違う結果を返すことになる。

### 9.2 起動と関連付け

- MSIX manifestで `.md` と `.markdown` の関連付けを宣言する。
- 既定アプリにするかはWindowsのユーザー設定に任せる。
- 関連付け起動は既存インスタンスへ渡し、既存ウィンドウを前面化する。単一インスタンスは `tauri-plugin-single-instance` で保つ。2つ目のプロセスはコマンドライン全体と作業ディレクトリを渡して終了し、起動中のインスタンスは、ウィンドウを最小化や非表示から戻して前面へ出したうえで、渡されたファイルを開く。開く対象のファイルが引数になくても、前面へ出す。前面へ出す操作の失敗は伝えない（渡されたファイルは開くため、利用者の要求は果たされる）。
- 関連付けで開かれたファイルがワークスペース外にある場合はloose tabで表示する（9.1）。ワークスペース未選択のまま単一ファイルを表示する状態を許す。
- 起動時は最後のワークスペースだけを開き直す。通常タブ、loose tab、選択中ファイル、スクロール位置は復元しない。関連付け起動で始まったときも、最後のワークスペースを復元し、そのあとに渡されたファイルを開く。ファイルが復元先の中なら通常タブ、外ならloose tab（9.1）になり、アプリが起動中にファイルを渡されたときと同じ状態になる。ファイルだけを見るために起動したときも復元を止めないのは、この一貫性のためである。ただし、復元先が応答の遅いストレージのとき、ローカルのファイルの表示まで復元の完了に待たされないよう、待ちには上限を設ける（「起動時のファイルの受け渡し」）。
- 復元先が存在しない、またはアクセスできない場合はwelcome状態で起動し、その項目を「最近使ったフォルダー」からも取り除く。起動のたびに開けないフォルダーの失敗を提示しても、ユーザーが取れる行動がないためである。
- 「最近使ったフォルダー」を初期版へ含める。保存件数とFrontendへの渡し方は11.1による。
- ワークスペースを開いたときに、正規化した絶対パス（`WorkspaceRoot::path`）を、最近使ったフォルダーの先頭と最後のワークスペースへ記録する。ワークスペースを閉じる操作をしたときは、最後のワークスペースを消す。最近使ったフォルダーには残す。閉じたワークスペースを次の起動で開き直すと、利用者が閉じた意図を無視することになるためである。アプリを終了したときは消さず、次の起動で開き直す。
- 起動時の復元は、ウィンドウを作ったあとに別のスレッドで行う（`open_folder::restore_last_workspace`）。応答の遅いストレージで、ウィンドウの表示を待たせないためである。

復元は2段階で行う。遅いのはフォルダーを開く（解決する）段階であり、開閉を直列にするロックの外で行う。開いたフォルダーを据える段階と、据えるかどうかの判断は、ロックの内側で行う。ロックを持ったまま待つと、同じロックを待つ `get_workspace_command` が返らず、Frontendの準備が済まないため、関連付けで渡されたファイルも開けない。判断では、最後のワークスペースを読み直し、「利用者が何も開いていないこと」を確かめる。フォルダーを開く前に読んだ値で判断すると、その間に利用者が「ワークスペースを閉じる」を終えても閉じたものを開き直し、別のフォルダーを開いていてもそれを上書きしてしまう。「何も開いていない」には、ワークスペースだけでなく、loose tab（9.1）も含める。据える切り替えは、開いているloose tabとその監視を破棄する（6.1）ため、フォルダーを開いている間にファイルだけをドロップして開いた文書も、復元が失わせてしまうためである（ワークスペースの監視IDだけで判断すると見逃す）。このときは復元を見送り、最後のワークスペースの記録は残す。復元に失敗したときは、上の規則どおり静かに外す。利用者が文書を開いていても外す。据えない理由（利用者が開いたものを残す）と、外す理由（開けない記録を残しても取れる行動がない）は別である。

応答しない共有での実測（Phase 4。到達できないIPのUNC共有を、実機の `tauri dev` と CDP で開いた）では、失敗を返すまで約21秒かかった。これはTCP接続の再送の合計（3 + 6 + 12秒）と一致するが、接続できたあとに応答しなくなる共有は測っていない。その間もウィンドウは操作でき（メッセージ往復の最悪値は0 ms）、welcomeは0.8秒で表示された。復元、「最近使ったフォルダー」、2つ目のプロセスで渡した共有上のファイルのいずれも、待ちはスレッドの中で起き、メインスレッドを止めない。復元がロックを持ったまま待っていた間は、渡したローカルのファイルが21.7秒後に開き、復元の最中に利用者が開いたローカルのフォルダーは16秒待たされた。上限を設けて復元を2段階にしたあとは、ファイルが起動から約4.1秒（待ち始めから3秒）で開き、利用者が開いたフォルダーは15 msで開いた。
- フォルダー選択、最近使ったフォルダー、起動時の復元は、同じ入口（`open_folder::open_path`）へ集まる。開けたときだけ記録し、Frontendへ知らせる。開けなかったときの示し方は入口ごとに違う。フォルダー選択とメニューはネイティブダイアログ、Frontendからの要求は応答、起動時の復元は示さない。

- 複数のファイルを渡された場合は、対象拡張子（6.3）のものをすべて開き、最後の1つをアクティブにする。抽出の規則は `src-tauri/src/startup.rs` の `files_to_open` を正本とする。

対象拡張子をすべて開くのは、Windowsが「1つのプロセスへ複数の引数」と「ファイル数ぶんのプロセス起動」のどちらで渡すかによらず同じ結果にするためである。後者の場合、2つ目以降はシングルインスタンス化によって既存インスタンスへ渡り、同じ経路へ集約される。先頭だけを開く規則では、渡され方によって振る舞いが変わる。2つ目のプロセスが引数を渡して終了し、起動中のインスタンスのタブとして開くことは、`tauri dev` の実機で確認した（Phase 4。相対パスと、最小化したウィンドウの前面化を含む）。エクスプローラーで複数のファイルを選んだときの実際の渡され方は、MSIXでの確認（Phase 5）で確かめる。

#### 起動時のファイルの受け渡し

新規に起動したプロセスの起動引数と、起動中のインスタンスへ渡された2つ目のプロセスの引数は、同じ入口（`src-tauri/src/launch.rs`）へ集まり、同じ規則（`files_to_open`）で対象を選ぶ。コマンドライン全体を受け取り、`argv[0]` は対象にしない。相対パスは、そのプロセスの作業ディレクトリで解決する。起動中のインスタンスの作業ディレクトリで解決すると、2つ目のプロセスが指したファイルとは別のファイルを開いてしまう。新規起動の引数は `env::args` ではなく `env::args_os` から読む（`args` は、Unicodeでない引数で異常終了する）。

開くのは、次の2つがそろってからである。それまでに届いたファイルは、届いた順に保留する。

- 最後のワークスペースの復元が済んだこと。復元はワークスペースの切り替えとして、開いているタブを破棄する（10.4）。先に開くと、開いたタブが消える。復元に失敗したときも、済んだものとして扱う。
- Frontendの準備が済んだこと。`open-document` はWebViewが購読する前に送ると誰にも届かない。Frontendは、`workspace-opened`、`workspace-closed`、`open-document` を購読し、`get_workspace_command` の応答を反映してから、`frontend_ready_command` で知らせる。応答の反映より先に知らせると、開いていないワークスペースのスコープIDの指示を捨ててしまう。

復元の完了を待つのは、ファイルが待ち始めてから3秒（`launch::RESTORE_WAIT_LIMIT`）までである。復元先が応答しない共有のとき、ローカルのファイルまで、共有が失敗を返すまで（実測で約21秒）表示されないためである。超えたら復元を取りやめ、待っていたファイルを開く。

- **取りやめた復元は、フォルダーを開けても据えない。** 据えると、取りやめたあとに開いたタブが、ワークスペースの切り替えで破棄される。ファイルは、復元先の中にあっても通常タブにならず、loose tab（9.1）で開く。最後のワークスペースの記録は残し、次の起動でもう一度試す。開けなかったときは、取りやめたかどうかによらず外す。
- **取りやめられるのは、ワークスペースを据える段階へ入る前だけである**（`Restore::Committing`）。据える段階は短く、入ったあとに取りやめると、据えたワークスペースがファイルのタブを破棄する。据えてよいかは、据える直前に一度だけ、保留の錠の内側で決まる。
- **上限は、ファイルが待ち始めてから数える。** 待つファイルがない通常の起動には掛けず、遅いストレージも完了まで待って復元する。起動から数えると、上限の直前に届いたファイルが、ほとんど待たずに復元を取りやめる。新規起動の引数を保留へ入れたとき、2つ目のプロセスの引数を受けたときに、それぞれ時間を計り始める。
- **3秒は、ローカルやLANの復元（数十ms）に対し、応答しない共有（約21秒）の待ちを短くする値である。** 応答に3〜10秒かかる共有は、ファイルを渡された起動では復元されない。フォルダーは「最近使ったフォルダー」から開き直せる。

利用者が応答しない共有を自分で開いたときは、この上限の対象にしない。開く操作は開閉のロックの内側で行うため、その間、ほかのフォルダーやファイルを開く操作は、完了まで待たされる（実測で、約21秒の共有を開いている間に発行したローカルのフォルダーを開く操作が16秒待たされた）。ウィンドウは止まらない。この待ちは、世代管理を要する別の関心事として、`tasks.md` に残している。

保留は、`tauri::Builder` の段階で登録する。プラグインは起動処理より先に、2つ目のプロセスの引数を届けうる。この段階では、他の状態（`AppState` など）が登録されていないため、保留は他の状態に触れずに済むようにする。新規起動の引数も、登録と同時に保留へ入れる（`LaunchQueue::started_with`）。起動処理の中で入れると、先に届いた2つ目のプロセスの引数が、新規起動の引数を追い越す。

「届いた順」は、2段階で守る。

- **保留へ入れる順は、通知を受けた時点で確定する。** 2つ目のプロセスの通知は、受けたスレッド（プラグインが通知を1つずつ処理するスレッド）がその場で保留へ入れ、開く処理だけを別のスレッドへ渡す。開く処理のスレッドで保留へ入れると、スレッドを作る順と実行を始める順が一致せず、通知A、Bに続けて届いても、Bが先に保留へ入りうる。開く処理のスレッドは、実行を始めた順に、保留にあるものをすべて届いた順に開く。
- **保留から取り出してから開き終えるまでは、受け取りごとに1つずつ行う**（`LaunchQueue::deliver`）。複数のスレッド（復元、Frontendの準備、2つ目のプロセス）が同時に開くと、先に取り出したファイルのストレージの応答が遅いとき、後のファイルが先に開き、最後にアクティブになるタブが届いた順と食い違う。順序の錠は取り出しの前に取る。取り出してから取ると、その間に別の受け取りが追い越せる。

開く処理は、そろったあとの呼び出しの中で、ファイルシステムを待つ。プラグインの通知を処理するスレッドを止めないよう、開く処理は別のスレッドで行う。開けなかったものの理由は、ドロップ（10.4）と同じく、1つのダイアログへまとめて示す。

同じ文書を重複して開かないため（9.1）、同値の引数は1つにまとめる。上限を超える分は9.1の退避規則で受け入れる。

### 9.3 リンク遷移と戻る／進む

**戻る／進む操作を初期版へ含め、タブごとの履歴として持つ。** 上限と規則の正本は `src/state/doc-history.ts` とする。

ルート内の相対Markdownリンクは現在のタブの中で開き、新しいタブを作らない（7.2）。リンクをたどるたびにタブが増えると、各タブの履歴が常に1件になって戻る／進むが機能しないうえ、数回たどるだけで上限20件（9.1）に達して退避規則が古いタブを黙って閉じることになる。遷移先が別のタブで既に開かれている場合は、そのタブへ切り替える。同一文書を重複して開かない規則（9.1）と揃えるためである。

WebViewのHistory APIには載せない。`history` はWebView単位に1本しかなく、タブごとに分けられないためである。WebView側の履歴を空のまま保てば、`Alt+←` とマウスのサイドボタンはWebViewの履歴を動かさず、`keydown` と `auxclick`（`button` は3と4）としてだけ届く。この2つの入力を自前のスタックへつなぐ。

`pushState` で履歴を積んだ状態では、この2つがWebView側の履歴を動かすことを実測で確認した。`Alt+←` は `popstate` を発火させて `history.state` を1つ前へ戻し、マウスのサイドボタンも同様に動かす。History APIに載せる案を採ると、この既定動作がタブごとの履歴と別に動くため、タブを閉じても履歴エントリが残り、「戻ると閉じた文書へ戻るのか、戻れない理由を出すのか」という判断を別に抱えることになる。

履歴へ積む単位を次のとおり定める。

- 文書の差し替えとアンカーへの移動の両方を1エントリとして積む。入口（本文のリンク、ツリー、パンくず）で区別しない。同じ「タブ内で表示が変わる」操作が入口ごとに違う結果を返さないようにするためである。入口を条件に含めないため、ツリーからの選択をどのタブで開くか（9.1「プレビュータブ」）とは独立に成り立つ。
- 現在位置と同じ場所（パスとアンカーが一致）は積まない。同じ見出しへのリンクを続けて押しても履歴は伸びない。
- 戻った状態で新しい遷移をしたときは、進む側を捨てる。
- 1タブあたりの上限を50件とし、超えるときは最も古い項目を捨てる。文書とアンカーの両方を積むため、目次の多い文書を行き来すると項目が伸びやすい。50件を超えて遡る操作はツリーから開き直すほうが速い。
- 各エントリはパス、アンカー、その位置を離れた時点のスクロール位置を持つ。
- renameを追跡してエントリのパスを差し替える（6.5）。タブのパスが追従する以上、履歴も同じパスを指し続けなければ、戻ったときに旧パスの読込が失敗する。
- 戻った先の文書を読み込めなかったときは、そのエントリを履歴から取り除く。削除された文書を指すエントリを残すと、戻る／進むのたびに同じ失敗を繰り返す。削除を検知した時点ではなく読込に失敗した時点で取り除くのは、`deleted` の判定がRust側の監視に依存し（6.5）、履歴が独自にファイルの生存を追う必要をなくすためである。

タブの状態遷移（読込の開始と完了、タブ内の移動、戻る／進む）は `src/state/document-tab.ts` を正本とし、次のとおり扱う。

- 履歴は読込の完了時に動かす。読込を始めた時点で積んだり戻したりすると、読めなかったときに現在位置を元へ戻す処理が別に要る。最初の読込が失敗したときはタブを作らない。
- 戻る／進むでは、見出しではなく、その位置を離れたときのスクロール位置へ戻す。見出しへ移ったあとに読み進めた位置が、戻ったときに失われないようにするためである。
- 表示中の文書の中での移動（見出しへのリンク、表示中の文書をツリーから選ぶ操作）は読み直さない。読込中の文書があれば、その応答は捨てる。ページ内の移動は利用者の新しい操作であり、後から届いた応答で表示を差し替えると操作が失われる。
- スクロール位置の復元は本文の描画完了時に1回だけ行う。画像の読込やMermaidの描画で後から高さが変わると、戻った位置がずれうる。

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
- Windowsハイコントラスト、`forced-colors`、`prefers-reduced-motion` に対応する。自前のUIにはアニメーションを置いていない。動きを足すときは `prefers-reduced-motion: reduce` を尊重する。Mermaidの図のエッジのアニメーションだけは図の定義で有効になるため、止める（8.4）。`forced-colors` の扱いは10.6とする。
- 本文の見出し、リスト、コードブロックの意味構造を保持する。
- 製品UIからsave、print、view source、devtoolsを除外する。

### 10.1 メニューの実装方式と構成

**ネイティブメニューを採る。** 標準タイトルバーを使う方針、OSのアクセシビリティ機構との統合、キーボード操作（`Alt` アクセスキー、矢印、`Esc`、ポップアップのフォーカス管理）の実装コストの点で優位である。`uimock.html` のHTMLメニューバーは視覚上の参考であり、実装方式を決めない。メニューバーの配色はアプリのテーマに従い、ドロップダウンはOSの配色に従う（後述）。

メニューはRust側が構築し、Frontendからメニューを操作しない。`menu` 系のcapabilityを追加せず、5.5で絞り込んだ集合を保つためである。

メニューには処理を実装したコマンドだけを載せ、実装が進むたびに下の表へ近づける（正本は `src-tauri/src/menu.rs` の `IMPLEMENTED`）。未実装の項目を無効表示で並べないのは、押しても何も起きない項目を見せないためである。「フォルダーを開く」は選ばれるとRust側でフォルダー選択ダイアログをメインウィンドウを親として開き、開けたら `WorkspaceOpenedEvent`（スコープIDと表示名。絶対パスは含めない）をFrontendへ送り、開けなければネイティブダイアログで原因を示す（`src-tauri/src/open_folder.rs`）。親を指定しないと、ダイアログはメインウィンドウと別のディスプレイに非モーダルで開いた（実測）。

コマンドの識別子とアクセラレータの正本は `src-tauri/src/menu.rs` とする。

メニューの選択と、WebViewにフォーカスがあるときのアクセラレータ（`webview_keys.rs`）は同じ振り分け（`src-tauri/src/menu_command.rs`）へ集まり、下の表の「処理する側」に従って、Rust側の担当モジュールへ渡すか、Tauri event `menu-command` でFrontendへ送る。payloadは `MenuCommand` の識別子（camelCase）である。コマンドごとにeventを分けないのは、受け手がFrontendの1か所であり、項目が増えるたびにevent名と購読を足すことになるためである。

| メニュー | 項目 | コマンド | アクセラレータ | 処理する側 |
| --- | --- | --- | --- | --- |
| ファイル | フォルダーを開く... | `openFolder` | `Ctrl+O` | Rust（ダイアログ） |
| ファイル | 最近使ったフォルダー | `openRecentFolder` | — | Rust（一覧を実行時に構築。11.1） |
| ファイル | ワークスペースを閉じる | `closeWorkspace` | — | Rust（状態を破棄し、`workspace-closed` でFrontendへ知らせる） |
| ファイル | タブを閉じる | `closeTab` | `Ctrl+W` | Frontend |
| ファイル | 終了 | `exit` | — | Rust |
| 表示 | サイドバー | `toggleSidebar` | `Ctrl+B` | Frontend |
| 表示 | 再読み込み | `reloadDocument` | `F5` | Frontend |
| 表示 | テーマ > システム / ライト / ダーク | `useSystemTheme` ほか | — | Rust（設定を保存し、ウィンドウとメニューバーへ適用する） |
| 表示 | 文字を大きく / 小さく / 既定に戻す | `increaseFontSize` ほか | `Ctrl+Equal` / `Ctrl+Minus` / `Ctrl+0` | Frontend |
| 表示 | 言語: システム / 日本語 / English | `useSystemLanguage` ほか | — | Rust（設定を保存し、メニューを組み直す。10.5） |
| ヘルプ | md-peruse について | `about` | — | Frontend（バージョンとライセンス一覧のダイアログ。11.3） |

保存、印刷、ソース表示、開発者ツールは置かない（10章）。終了にアクセラレータを割り当てないのは、`Alt+F4` をWindowsが処理するためである。

言語の切り替えをRust側で処理するのは、メニューの項目名そのものを組み直す必要があるためである。言語はネイティブメニューとネイティブダイアログの文言を変える。

切り替えでは、設定の保存、`AppState` の言語、メニューの組み直し、`language-changed` eventの送出をこの順に行う（`src-tauri/src/language.rs`）。メニューは項目名だけを差し替えず、`menu::build` で作り直して `set_menu` する。作り直せばチェックも新しい選択へ揃い、選ばれたときにmudaがチェックを反転する問題（下のテーマと同じ）も起きない。メニューのイベントの処理の中で作り直しても成立し、保存済みのテーマを渡して作り直すため、メニューバーの配色も保たれる（実測）。`system` を選んだときも、その時点のOSの表示言語で決め直す。言語の名前（日本語、English）は、現在のUI言語によらずその言語で書く。読めない言語のUIになったときも、自分の言語の項目を見つけて戻せるようにするためである。

**テーマの切り替えもRust側で処理し、ウィンドウのテーマとして適用する。** WebView2の `prefers-color-scheme` はウィンドウのテーマに従うため、本文とUIのCSS、コードハイライト、Mermaidの図（8.3、8.4）は、Frontendで値を受け取らずに切り替わる。Mermaidは描き直され、スクロールバー、タイトルバー、メニューバーも揃う（実測）。Frontendで `data-theme` 属性を切り替える案は、配色のCSSをメディアクエリと属性セレクターで二重に持ち、Mermaidとコードハイライトの判定もアプリの状態へ寄せる必要がある。そのうえタイトルバー、スクロールバー、メニューはOSの配色に残って食い違うため採らない。Frontendは設定値を知る必要がないため、`UiSettings` へテーマを含めない（11.1）。実装は `src-tauri/src/theme.rs` とする。

- 起動時は保存したテーマでウィンドウを作る。作ってから切り替えると、起動直後に別の配色が一瞬見える。
- 切り替えでは、ウィンドウのテーマとアプリ全体のテーマ（`AppHandle::set_theme`）の両方を設定する。ウィンドウに指定したテーマはアプリ全体の指定より優先されるため（tao）、起動時にウィンドウへ渡した値を置き換える必要がある。一方、メニューバーの配色を変えるのはアプリ全体の指定である。
- メニューはチェック付きの3項目をサブメニューにまとめ、選択中の項目にチェックを付ける。Tauriにはラジオ項目がなく、チェック付きの項目は選ばれると `muda` がチェックを反転してからイベントを送る。選択中の項目を選び直すとチェックが外れ、別の項目を選ぶと2つに付くため、選ばれるたびに3つとも付け直す。
- ドロップダウンの配色は、アプリ全体のテーマを指定してもOSの配色のまま変わらない（実測）。OSがダークでライトを選ぶと、メニューバーはライト、ドロップダウンはダークになる。

「ワークスペースを閉じる」をRust側で処理するのは、6.1の破棄のうち監視の停止と画像resource IDの破棄がRust側の状態にあるためである。Frontendだけでwelcome状態へ戻すと、監視が動き続け、旧ワークスペースの画像IDも有効なまま残る。「フォルダーを開く」がRust側で開いてから `workspace-opened` を送るのと同じく、閉じてから `workspace-closed`（payloadなし）を送る。Frontendは受け取ると、切り替えと同じ手順でタブ、表示中の本文、ツリーを破棄する。閉じる処理は別スレッドで行う。走査と読込はワークスペースのロックを保持したままファイルI/Oを行うため、応答の遅いストレージの処理中にメニューの処理（メインスレッド）で閉じると、ウィンドウが応答しなくなる。開く処理と閉じる処理は、状態の変更と通知の送出を一続きにして直列にし、通知の順序と実際の状態を食い違わせない。

「再読み込み」は監視のバッファあふれや監視停止（`WatcherStopped`）からの回復手段として置く。自動追従が効かない状況で、ユーザーが取れる唯一の行動だからである（6.4）。

**WebViewにフォーカスがあるときも、メニューのアクセラレータとアクセスキーを効かせる。** WebView2はキー入力を受け取っても、ホストウィンドウのアクセラレータ処理へ渡さない。そのままでは `Ctrl+O` も `Alt+F` も効かなかった（実測）。WebView2がホストへ知らせる `AcceleratorKeyPressed` をRust側で受け、メニューへ載せたコマンドの割り当てと修飾キーまで厳密に一致したら、キーをページへ渡さずにメニューの選択と同じ処理を行う。`Alt+英数字` は `WM_SYSCOMMAND`（`SC_KEYMENU`）でホストウィンドウへ送り、アクセスキーとしてメニューを開く。`Alt` 単独と `F10` はWebView2がホストへ渡しており、転送しなくてもメニューバーへ移る（実測）。`Alt+←` など英数字以外は転送せず、WebView内の処理（9.3）へ残す。実装は `src-tauri/src/webview_keys.rs` とする。WebView内の `keydown` で拾ってcommandでRustへ伝える案は、割り当てがRustとTypeScriptの2か所に分かれ、`Alt+文字` をメニューバーへ渡す手段もないため採らない。

同じ場所でWebView2のブラウザーアクセラレータキーを無効にする（`SetAreBrowserAcceleratorKeysEnabled(false)`）。`Ctrl+R`（WebView全体の再読込）、`Ctrl+P`（印刷）、`F12`（開発者ツール）、標準の検索バーは製品UIにない操作だからである（10章）。無効にしてもキーイベントはページへ届くため、WebView内で扱う `Ctrl+F`（8.6）と `Alt+←` / `Alt+→`（9.3）は影響を受けない（実測）。個別に `preventDefault` で潰す案は、WebView2が扱うキーを列挙し続ける必要があるため採らない。wryの `with_browser_accelerator_keys` はTauriが公開していないため、`with_webview` で得るWebView2のcontrollerへ直接設定する。

アクセラレータの表記は、Tauriが内部で使う `muda` の形式に従う。キーはW3Cの `KeyboardEvent.code` に対応する名前であり、`Plus` のような記号名は受け付けない。Tauriはパースに失敗した文字列を無言で捨て、アクセラレータなしの項目として登録する。ビルドもテストも通り、実行するまで「効かないショートカット」に気づけないため、すべての割り当てを実際のパーサーへ通すテスト（`accelerators_are_parsable`）で固定する。パーサーが何でも受け入れるようになった場合に備え、既知の無効な表記で反証も取る。WebViewにフォーカスがあるときの照合は表記を仮想キーへ自前で変換するため、すべての割り当てが変換でき、修飾キーが `muda` の解釈と一致することもテスト（`every_accelerator_is_routable`）で固定する。

文字サイズの拡大は `Ctrl+Equal`（`=` キー）とする。`muda` のアクセラレータは修飾キーを厳密に見るため、1つの項目で `Ctrl+=` と `Ctrl+Shift+=`（`Ctrl` + `+`）の両方は表せない。メニューには代表として `Ctrl+Equal` を表示し、`Ctrl` + `+` とテンキーの `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` / `Ctrl+Numpad0` はWebView内で同じ操作へ割り当てる。

`Ctrl` + `+` は物理キー（`KeyboardEvent.code`）ではなく入力される文字（`key` が `+`）で判定する。`+` はUS配列では `Shift` + `=`、JIS配列では `Shift` + `;` のキーであり、`code` の `Equal` で判定するとJIS配列で効かなかった（実測）。なお `Ctrl+Equal` は仮想キー `VK_OEM_PLUS` として登録され、JIS配列ではこのキーが `;` の位置にあるため `Ctrl+;` で拡大する。Chromeのズームと同じ割り当てである。

`Ctrl` + `=` / `-` / `0` をアプリへ割り当てるため、WebViewのズームホットキーは無効にする。有効なままだと、WebView全体の拡大とプレビュー本文の拡大が同じキーで二重に起きる。本文だけを拡大する方針（10.3）を保つための措置であり、設定はwebview側で行う。

タブの移動（`Ctrl+Tab`、`Ctrl+Shift+Tab`）とツリーの操作（矢印、`Enter`、`Home`、`End`）はメニュー項目を持たず、WebView内で処理する。メニューに現れない操作のアクセラレータをネイティブ側で登録すると、フォーカスのある要素へキーが届かなくなるためである。

文書内検索（8.6）と戻る／進む（9.3）も同じ扱いとし、メニュー項目を置かない。検索は検索欄が文字入力を受け取り、`Ctrl+F` のほかに `Esc`、`Enter`、`F3` を扱うため、ネイティブ側へ登録するとフォーカス中の入力欄へキーが届かない。戻る／進むはマウスのサイドボタンという非メニュー経路が主であり、キーとマウスの両方をWebView内の1か所で扱うほうが、履歴を動かす経路が1本に収まる。

### 10.1.1 パンくず

- タブバーの下に置き、アクティブタブの文書のパスをワークスペース名から順に示す。タブが無いときは出さない。どのタブのパスかを位置で示すためであり、ウィンドウ最上部に全幅で置くと、サイドバーの上にも掛かって対応が読み取りにくい。
- セグメントを選ぶと、サイドバーのツリーでそのフォルダーを展開し、フォーカスを移す。ワークスペースは切り替えない。
- 先頭のセグメント（ワークスペース名）を選ぶと、ツリーの先頭の項目へフォーカスを移す。ルートはツリーの項目ではなく常に展開しているため、フォルダーを選んだときと同じく「その階層の先頭」へ移す。
- 最終セグメント（表示中の文書）は選択済みであり、操作を持たない。ボタンにせず `aria-current="page"` で示す。
- サイドバーが非表示のときは、サイドバーを表示してから展開する。ユーザーの意図はその階層を見ることであり、非表示のまま無反応にすると壊れているように見える。
- 幅に収まらないときは横にスクロールし、パスが変わったときとパンくずの幅が変わったときに、末尾（表示中の文書名）が見える位置へ動かす。それ以外では、利用者が手で動かした位置を保つ。文書名はアクティブタブとウィンドウタイトルにも出るが、狭いウィンドウでは末尾が常に切れて見えなかった（実測）。「どこを見ているか」の主役は文書名であり、上位のフォルダーは左へ隠れても、スクロールで届く。スクロールバーはタブバーと同じく `scrollbar-width: thin` で細くする（9.1）。中間を省略記号へ畳む案は、セグメントごとの操作（ボタン）とキー操作を保ったまま省略の状態を持つことになるため採らない。実装は `src/breadcrumb/Breadcrumb.tsx` と、幅の観測 `src/layout/use-resize-observer.ts` とする。
- 深い階層の文書から親フォルダーへ戻る操作を1手で行えるようにするのが目的である。ポップアップで兄弟ファイルを一覧する案は採らない。ポップアップのキーボード操作とARIAを自前で実装することになり、ネイティブメニューを選んだ理由と矛盾する。

文書はリンクで開けるため、パンくずのフォルダーがツリーでまだ走査されていないことがある。祖先とそのフォルダーをすべて展開し、未取得のものは並行して走査する（6.2の遅延取得と同じ経路）。フォーカスは対象の項目が見えるまで待ち、待つ間は見えている最も近い祖先に置く。祖先の走査に失敗したら、その祖先で止める。失敗の理由はそのフォルダーの中に表示される（6.2）。

待つ間に利用者がツリーを操作するか、フォーカスがツリーの外へ出たら、その要求を取り下げる。走査が後から終わっても、利用者が移った先からフォーカスを奪わないためである。ワークスペースを閉じたときや切り替えたときも取り下げる。実装の正本は `src/tree/TreeView.tsx` と `src/state/file-tree.ts` の `revealFocus` とする。

### 10.1.2 ウィンドウタイトル

- 「文書名 - ワークスペース名 - md-peruse」とする。タブが無いときは「ワークスペース名 - md-peruse」、ワークスペースを開いていないときは「md-peruse」とする。「ワークスペース名」は、アクティブなタブのルートの表示名である。ワークスペースの文書ではワークスペース名、loose tab（9.1）では所在フォルダーの表示名になる。ワークスペースを開いていなくても、loose tabがあれば「文書名 - 所在フォルダー名 - md-peruse」とする。
- 具体的なものから並べるのは、タスクバーやAlt+Tabでは先頭しか見えないことがあるためである。文書名だけでは同名の文書（`README.md` など）がどのフォルダーのものか区別できないため、ワークスペース名を添える。ワークスペース相対パスを出す案は、深い階層でタイトルが長くなって文書名が見切れ、階層はパンくず（10.1.1）でも分かるため採らない。
- ワークスペース名はRust側が絶対パスの末尾2コンポーネントに限って渡す表示名であり（11.1）、タイトルにも絶対パスは現れない（7.1）。タイトルはタスクバーやアクセシビリティ機構を通じてアプリの外へ出るため、この制約を保つ。
- アクティブタブを知っているのはFrontendのため、Frontendが `core:window:allow-set-title`（5.5）でタイトルを設定する。Rust側のcommandで文字列を受け取る案は、Frontendが任意の文字列を渡せる点で権限と変わらず、commandとその呼び出しの分だけコードが増えるため採らない。Tauriのウィンドウタイトルは `document.title` と同期しない（実測）ため、明示的に設定する。設定に失敗した場合は、ほかのIPCの失敗と同じく理由を画面に示す。起動直後のwelcome状態でも示す。組み立ての正本は `src/state/window-title.ts` とする。

### 10.2 ペイン境界の操作

- `role="separator"`、`aria-orientation="vertical"`、`aria-valuenow`、`aria-valuemin`、`aria-valuemax`、`tabindex="0"` を設定する。
- 左右キーで幅を変更し、`Shift` 併用で大きく動かす。`Home` と `End` で最小幅と最大幅へ移動する。
- ポインターのドラッグでも幅を変える。ドラッグ中は表示だけを変え、離したときに保存する。キー操作は変更ごとに保存する（書込みのまとめはRust側。11.1）。掴んだときに境界へフォーカスを移し、続けてキーで微調整できるようにする（ドラッグ中の文字列選択を止めるために既定動作を止めると、フォーカスも移らなかった。実測）。
- サイドバーの表示切り替えは幅の値とは独立した状態として保持する。
- ウィンドウ全体はスクロールさせず、サイドバーとプレビュー領域がそれぞれスクロールする。戻る／進むで復元するスクロール位置（9.3）はプレビュー領域の `scrollTop` とする。実装の正本は `src/layout/SidebarLayout.tsx` とする。

幅の範囲と刻みを次のとおり確定する。値と規則の正本は `src/state/sidebar-width.ts` とする。既定値の正本は `src-tauri/src/settings.rs` の `DEFAULT_SIDEBAR_WIDTH` であり、範囲と刻みはUIの関心事のためFrontend側へ置く。

| 項目 | 値 |
| --- | --- |
| 最小幅 | 200 px |
| 最大幅 | `min(600 px, ウィンドウ幅の50 %)` |
| 左右キーの刻み | 16 px |
| `Shift` 併用の刻み | 64 px |

最大幅にウィンドウ幅由来の上限を併せるのは、幅の狭いウィンドウで本文が潰れるのを防ぐためである。800 pxのウィンドウで600 pxのサイドバーを許すと、本文は200 pxしか残らない。割合による上限が最小幅を下回る場合は最小幅を採る。極端に狭いウィンドウでサイドバーを操作できない状態にしないためであり、そこまで狭ければ何を選んでも本文は読めない。

ウィンドウを縮めて上限を下回ったときは表示だけを詰め、設定へは書き戻さない。広げ直したときに元の幅へ復帰させるためである。したがって「保存値」と「実効値」の2つを区別して持つ。`aria-valuemax` にはウィンドウ幅に応じた実効値を伝える。

設定ファイルに範囲外の値が入っていた場合（手で編集された場合など）は、読み込み時にFrontendが範囲へ収める（11.1）。
- 確定した幅をDOMへ反映する手段は、CSPの `style-src-attr 'none'` に従う（5.5）。インラインの `style` 属性は使えないため、`style` 要素へCSSカスタムプロパティを書き込む。

### 10.3 文字サイズ

- 変更対象はプレビュー本文とし、ツリーとメニューはOSのスケーリングに従う。
- 倍率が効くのは本文の文字（見出し、段落、リスト、表、コード、数式）である。Mermaidの図と画像は倍率に連動させず、それぞれ本来の幅で表示し、表示幅より広ければ縮める（8.4）。図のラベルはSVGが `font-size` を固定値で持つため文字の倍率を継承しない。図全体を拡大しても、幅の広い図は表示幅で頭打ちになり効果が限られるためである。
- メニューのアクセラレータは `Ctrl+Equal` / `Ctrl+Minus` / `Ctrl+0` とする。`Ctrl` + `+` とテンキーの `Ctrl+NumpadAdd` / `Ctrl+NumpadSubtract` / `Ctrl+Numpad0` はWebView内で同じ操作へ割り当てる（10.1）。
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

#### 実装

受け取りは `src-tauri/src/drag_drop.rs`（`on_window_event` の `DragDrop`）、開き先の決定は `src-tauri/src/open_document.rs` とする。

- `enter` で、各パスを `canonicalize`（7.1の境界判定と同じ正規化）し、`is_dir` で種別を判定して `plan_drop` へ渡す。実在しないパスとアクセスできないパスは落とす。結果が空なら `Rejected`、空でなければ `Acceptable` を、Tauri event `drag-state`（payloadは `DragState` だけ）で知らせる。`over` は何もしない。`leave` と `drop` は `Idle` を知らせる。
- `drop` は別のスレッドで実行する。フォルダーを開くとファイルシステムへ触れるため、ウィンドウのイベントを処理するスレッドを止めない。フォルダーを開いてから、ファイルを先頭から順に開く。開けなかった理由は、重複を除いて1つのネイティブダイアログへまとめて示す。フォルダーが開けなくても、ファイルは開く。
- ファイルは、開いているワークスペースの中にあればワークスペースのスコープの通常タブ、外ならloose tabで開く（`AppState::workspace_document`、`open_loose`）。Frontendへは `open-document`（`OpenDocumentEvent`）でスコープIDとスコープ相対パスを知らせ、Frontendは固定タブで開く。開閉を直列にするロック（9.2）の内側で判定と送出を行う。
- オーバーレイ（`src/layout/DragOverlay.tsx`）は、ウィンドウ全体を覆い、操作を受けない。受け入れるときは強調色の破線、受け入れないときは控えめな実線で囲み、どちらも文言を出す。「開けません。Markdownのファイルとフォルダーだけ開けます。」と「ここにドロップして開く」である。

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

選択はメニューから切り替える（10.1）。設定値（`LanguagePreference`）と実際の値（`Language`）を別の型で表す。起動時の値はFrontendへ `UiSettings`（`language` と `effectiveLanguage`）として渡し、切り替えは `LanguageChangedEvent`（5.3）で通知する。

イベントを設ける理由は、言語の切り替えをRust側で処理する（10.1）ためである。メニューの項目名を組み直す必要からRustが受け口になっており、Frontendはコマンドを受け取らない。起動時の投影だけではWebView内の文言が旧言語のまま残る。配色テーマはWebViewの `prefers-color-scheme` を通じてFrontendへ届くため通知を要さないが（10.1）、言語にはそれに当たる経路がない。

OSの表示言語そのものは監視しない。変更にはサインアウトを要し、アプリの実行中に変わらないためである。したがって `LanguageChangedEvent` が飛ぶのはメニューからの切り替えのときだけであり、`system` を選んでいる間にイベントが飛ぶことはない。

OSの表示言語は `GetUserDefaultLocaleName` で取得する（`ja-JP` を返すことを実測で確認した）。このために `windows` crate を直接依存へ加える。Tauriが依存する版（0.61.3）と揃えており、重複してコンパイルされない。`tauri-plugin-os` を足さないのは、Rust側からしか使わない値のためにプラグインとそのフロント側の面を持ち込む必要がないためである。取得できなかった場合は空文字を返し、`FALLBACK_LANGUAGE`（英語）を選ぶ。

文言はRust側とFrontend側の双方が持つ。

| 文言 | 持つ側 |
| --- | --- |
| ネイティブメニューの項目名（10.1） | Rust |
| ネイティブダイアログのタイトルと本文 | Rust |
| `IpcError.message`（5.3） | Rust |
| WebView内のUI（welcome、検索バー、エラー表示、Aboutの本文） | Frontend |

`IpcError.message` をRust側が現在の言語で組み立てるのは、ネイティブメニューとネイティブダイアログの文言をどのみちRust側が持つためである。IPCが成立しない場面（WebView2 Runtimeの欠落。12章）の表示もRust側で行う以上、辞書を両側へ分けると同じ文言が二重になる。言語を切り替える直前に発行した要求の応答は旧言語のまま届きうるが、これは受け入れる。エラー表示は一時的であり、同じ操作をやり直せば新しい言語になる。応答へ言語を添えてFrontendが捨てる仕組みは、失敗の表示のために往復を増やす割に得るものがない。

言語ごとの文言表は `Record<Language, …>` の形で持ち、言語を増やしたときの不足を `tsc --noEmit` が検出できるようにする。`src/types/error.ts` の `RETRYABLE` を `Record<ErrorCode, boolean>` として定義したのと同じ理由による（5.3）。Rust側は列挙に対する `match` の網羅性検査で同じ保証を得る。

Frontendの文言の正本は `src/i18n/messages.ts`（`Messages` 型と `MESSAGES: Record<Language, Messages>`）とする。`LanguageProvider`（`src/i18n/LanguageContext.tsx`）が現在の言語の文言を子孫へ渡し、Appが言語を決めて `<html lang>` を合わせる。言語は、`language-changed` eventで届いた切り替え（`onLanguageChanged`）があればそれ、なければ設定の `effectiveLanguage` とする。切り替えは設定とは別に持ち、設定の応答との前後を問わず優先する。起動時は、この購読を済ませてから設定を読む。読む前の切り替えは設定に含まれ、読んだ後の切り替えはeventで届くため、起動直後に言語を選んでも取りこぼさず、遅れて届いた旧言語の設定に上書きされない（購読より先に読むと、その間の切り替えはどこにも届かない）。設定を読むまで描画しないため、既定の言語が画面に出ることはない。英語の書き方は、Rust側の英語（`ipc/message.rs`、`menu.rs`）へ揃える。開発者向けの例外（不変条件の違反など）の文言は、利用者へ見せないため辞書へ置かない。

文言を作る場所によって、言語を切り替えたときの扱いが分かれる。

- **表示のときに文言へ変えるもの**。ラベル、検索バー、リンクの拒否理由、コードのハイライトの失敗は、コンポーネントが `useMessages()` で読む。Mermaidの失敗は、`MermaidRenderError` が文言ではなく失敗の種類（`tooLarge`、`timeout`、`loadFailed`、`renderFailed`）と詳細を持ち、`MermaidDiagram` が表示のときに文言へ変える。言語を切り替えても、描画し直さずに変わる。
- **hastへ書き込むもの**。数式の描画できなかった理由は、`rehypeMath` がhastへテキストとして書く。そのため、言語ごとにプロセッサを組み立てて使い回し（`render.ts`）、言語が変わったときは文書を組み立て直す（`MarkdownDocument` のeffectが文言を依存に持つ）。理由の種類だけをhastへ載せ、表示のときに文言へ変える案は、sanitize schemaへ属性を足すことになり、全列挙の方針（8.2）に反するため採らない。

UI文字列を外部のi18nライブラリへ載せない。対象は2言語であり、複数形や語順の入れ替えを要する文言も持たない。読み込み時に辞書を選ぶだけで足り、ライブラリの導入は依存とCSPの検討を増やすほうが大きい。

MSIXマニフェストの `<Resource Language>` は `ja-JP` と `en-US` の両方を宣言したまま保つ（13.1）。宣言と実体が揃う。

### 10.6 forced-colors（ハイコントラスト）

`forced-colors: active` では、WebView2が `color`、`background-color`、`border-color`、`outline-color` などをシステムカラーへ置き換える。次の3点をこの前提で扱う。

- **背景色の変化に頼る表示は消える。** 選択は輪郭（タブは2 pxの `Highlight`）か `Highlight` / `HighlightText` の塗り（ツリー）で、ホバーは1 pxの `CanvasText` の輪郭（ツリーの行、タブの閉じるボタン、パンくず）で示す。フォーカスは既存の2 pxの輪郭がそのまま見える。
- **選択のツリー行は `forced-color-adjust: none` にする。** 既定のままだと、Chromiumが文字の下へCanvas色の下敷きを敷き、`HighlightText`（黒）の文字が黒い下敷きに沈んで読めなくなる（実測）。
- **SVG（Mermaid）の塗りと線は置き換えられない。** `neutral` テーマは明るい背景向けのため、黒い背景では線と、ノードの外に描く文字が背景に沈む（コントラスト比は1.66〜3.66。実測）。そこで図を白い下地に載せ、`forced-color-adjust: none` にする。どのハイコントラストのテーマでも、黒字に白地で読める。黒いテーマでは図だけが白いブロックになるが、画像が元の色のまま表示されるのと同じ扱いである。`Canvas` の明暗で `dark` と `neutral` を切り替える案は、黄地や緑地などの変形テーマで `dark` の色が合う保証がなく、実際のOSのハイコントラストでの検証を要し、8.4の「色ではなく形状と境界線で区別する」方針からも外れるため採らない。

点検は、WebView2を `--remote-debugging-port` 付き（`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`）で起動し、CDPの `Emulation.setEmulatedMedia` で `forced-colors: active` にして行った。OSの設定を変えずに、実機のWebView2のレンダラーで確認できる。パレットはWindowsの「ハイコントラスト黒」相当（`Highlight` は `#1AEBFF`、リンクは黄）である。

問題がなかったものは、検索バーと現在位置のハイライト（8.6）、コードのトークン（太字と斜体。8.3）、数式、リスト、チェックボックス、区切り線、脚注、リンク、スクロールバー、フォーカスの輪郭（パンくず、タブ、ペイン境界、ツリー）である。

**実際のOSのハイコントラスト（Phase 4の完了前に確認）。** Windows 11 x64の実機で、OSのハイコントラスト黒（`SystemParametersInfo` で、セッションの間だけ有効にし、設定ファイルへは書かない）にして、Releaseのアプリを確かめた。タイトルバー（黄の背景に黒の文字、最小化・最大化・閉じるの輪郭つきのボタン）、ネイティブのメニューバー、ツリー（選択の行がシアンの塗りと黒の文字で判読でき、ホバーは輪郭）、タブ（アクティブなタブの輪郭）、パンくず、本文（見出し、シアンのリンク、表、タスクリストのチェックボックス、コードの太字と斜体、数式）、Mermaidの図（白い下地に、線とラベルが判読できる）、画像、脚注（隠した見出しは出ず、本文と戻りのリンクだけが出る）、文書内検索のバー（現在位置の一致がシアンの塗りで判読できる）、書式なしの文書の案内（輪郭つきの枠）とソースの表示に、読めない表示は無かった。確認後にOSの設定を元へ戻し、レジストリの `HighContrast` の `Flags` が確認の前と同じ126であることを確かめた。**未確認:** 黒以外のテーマ（白、ハイコントラスト1・2）は、OSのテーマを切り替える別の操作が要るため確かめていない。`forced-colors` ではシステムカラーへ置き換わるため、テーマ固有の色は使っていない。

## 11. アプリ設定と診断

### 11.1 設定の保存

- 保存先はTauriが返すアプリ設定ディレクトリとする。MSIX環境ではアプリが取得するパスは `%APPDATA%\com.scottlz0310.md-peruse` のままだが、実際の読み書きはWindowsがパッケージごとの領域へリダイレクトする。アンインストール時に設定も併せて削除される。WinRTの `ApplicationData` APIを使う必要はない（13.4）。
- 形式はJSONとし、`schemaVersion` を持つ。
- 未知のキーは読み捨てる。破損時は既定値で起動し、破損ファイルを退避したうえで通知する。
- 書込みはdebounceし、終了時にflushする。アイドル時に周期的な書込みを行わない。
- 書込みは一時ファイルへ書いてからrenameし、途中終了で設定を失わないようにする。

読み書きの実装は `src-tauri/src/settings_store.rs` を正本とし、次のとおりとする。

- 起動時に1度だけ読み、以後はメモリ上の値を正とする。読めない設定（壊れたJSON、`schemaVersion` が現在より大きいファイル、読み取りの失敗）は `settings.json.corrupt-<時刻>` へ退避してから既定値で始め、ネイティブダイアログで `SettingsCorrupted` を示す。退避名に時刻を含めるのは、繰り返し退避したときに前の退避を上書きしないためである。
- 退避できなかった場合は、そのセッションでは書き込まない。読めないファイルを上書きすると、利用者が手で直せたかもしれない設定を失うためである。この場合は `SettingsCorrupted` と `SettingsSaveFailed` を1つのダイアログで示す。
- 書込みは専用スレッドで行い、最後の変更から500 ms待ってから書く。サイドバー幅はキーを押し続ける間に続けて変わるためである。終了時（`RunEvent::Exit`）は待たずに書き出す。書込みの失敗は変更の操作とは切り離し、`SettingsSaveFailed` をネイティブダイアログで示す。`io::Error` の内容はネイティブ絶対パスを含みうるため表示しない（7.1）。
- 値の範囲への丸めはRust側で行わない。範囲と段階の正本はFrontendにあり（10.2、10.3）、読み込んだ値はFrontendが実効値へ丸める。定義を言語をまたいで二重に持たないためである。
- UI言語（10.5）とメニューの文言が設定から決まるため、メインウィンドウは `tauri.conf.json` で自動生成せず（`create: false`）、setupで設定を読み、状態を登録し、メニューを組み立ててから作る。自動生成するとsetupより前にWebViewが読み込まれ、状態を登録する前にcommandが呼ばれうる。
- Frontendとの受け渡しは `get_ui_settings_command`（`UiSettings`）と `update_ui_settings_command`（`UiSettingsUpdate`。指定した項目だけを変える）とする。加えて、起動時のワークスペースの問い合わせ（`get_workspace_command`）と、Frontendの準備が済んだ知らせ（`frontend_ready_command`。9.2）、最近使ったフォルダーの項目を開く要求（`open_recent_folder_command`）を置く。

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

テーマの設定値は `ThemePreference`（`system` を含む3値）とする。Frontendへは渡さず、実際の配色を表す型もIPCに設けない。切り替えと適用はRust側で行い、`system` を選んだときの実際の配色もWebViewの `prefers-color-scheme` でFrontendへ届くためである（10.1）。

`schemaVersion` は現在 1 とする。読み込んだ値が現在より小さいときはマイグレーションし、大きいとき（新しい版が書いたファイルを古い版が読んだとき）は既定値で起動し、破損時と同じ手順で退避する。未知のキーを落としたまま起動すると、次の書込みで新しい版の設定を破壊するためである。

#### Frontendへ渡す投影

`Settings` をそのままFrontendへ渡さない。「最近使ったフォルダー」と「最後のワークスペース」はワークスペースルート自身であり、ツリーの `FileNode` のように相対パスへ落とせないためである。7.1の「ネイティブ絶対パスをFrontendのURLまたはDOMへ露出しない」に例外を設けず、Frontendへは `UiSettings` を渡す。

| 状態 | Frontendへの渡し方 |
| --- | --- |
| UI言語、サイドバー幅、サイドバー表示状態、文字サイズ | 値をそのまま渡す。UI言語は選択（`LanguagePreference`）と実際の言語（`Language`）の両方を渡す。切り替え後の値は `LanguageChangedEvent` で通知する（10.5） |
| テーマ | 渡さない。Rust側がウィンドウへ適用し、Frontendは `prefers-color-scheme` で追従する（10.1） |
| 最近使ったフォルダー | 不透明なIDと表示ラベル（`RecentFolderView`）を渡す。絶対パスは渡さない。起動時は `UiSettings` で、以後の変化は `recent-folders-changed` で渡す |
| 最後のワークスペース | 渡さない。起動時にRust側が開き直す。開いたワークスペースは `workspace-opened` と `get_workspace_command` で伝える（下記） |
| ウィンドウ位置とサイズ | 渡さない。Rust側がウィンドウへ適用する |

IDはプロセス内でのみ有効な不透明値とし、対応表はRust側が保持する。設定ファイルへは保存しない。Frontendから受け取ったIDは5.3の原則どおり再検証し、未知のIDは `RecentFolderNotFound` で拒否する。値に意味を持たせず、Rust側の再検証を前提とする点は画像resource ID（5.4）と同じ考え方である。フォルダーそのものが移動または削除されている場合は `WorkspaceNotFound` とし、一覧を取り直せば解消する前者と区別する。

#### 最近使ったフォルダーの操作

ファイルメニューの「最近使ったフォルダー」と、ワークスペースを開いていないときの案内の一覧は、同じIDで開く。IDは、一覧を作り直すたび（開いた、外した）に振り直し、以前の一覧のIDは `RecentFolderNotFound` で拒否する。古い一覧を見ている側が、同じ位置の別のフォルダーを開いてしまわないためである。

メニューの項目のIDは `openRecentFolder:<ID>` とし、ほかのコマンドの識別子（`MenuCommand`）とは別に扱う。項目ごとにIDが要るためである。項目の表示名にある `&` は、アクセスキーの印ではなく文字として表示するため、重ねて書く。一覧が空のときは、サブメニューごと無効にする。一覧が変わると、メニューを組み直して反映し（10.1）、Frontendへ `recent-folders-changed` を送る。Frontendは受け取った一覧で丸ごと置き換える。設定の応答より先に届いたときも、届いた一覧を優先する（UI言語と同じ。10.5）。

フォルダーが見つからない項目は、`WorkspaceNotFound` を返したうえで一覧から取り除く。開けない項目を残しても、取れる行動がない（9.2）。アクセスできない項目は、権限を直せば開けるため残す。

#### 起動時のワークスペースの伝達

起動時の復元の `workspace-opened` は、WebViewが購読する前に送られうる。Frontendは `workspace-opened` と `workspace-closed` を購読してから、`get_workspace_command` で開いているワークスペースを問い合わせる。購読より先に問い合わせると、その間に開いたものを逃す。問い合わせの応答を反映したあと、Frontendは `frontend_ready_command` で知らせる。関連付け起動で渡されたファイルは、その知らせのあとに開く（9.2）。

購読後に通知が届いていたときは、問い合わせの応答を使わない。応答はそれより前の状態であり、適用すると新しいワークスペースを古いもので上書きする。閉じる通知も同じである。同じワークスペースが通知と応答の両方で届いたときは、スコープIDで見分けて二重に開かない。Rust側は、開閉を直列にするロックの内側で、スコープIDと表示名を同じワークスペースのものとして読む。WebViewを読み込み直したときも、Rust側に残るワークスペースを取り戻せる。

Frontendが準備完了を知らせてから、Rustが開き直す案は、読み込み直しのたびに開き直しの扱いが要るため採らなかった。`UiSettings` へワークスペースを含める案は、設定ではない状態が混ざり、読み込み直したあとに取り戻せないため採らなかった。

#### ウィンドウの配置

位置、サイズ、最大化の状態は、移動、サイズ変更、最大化のあと、動きが落ち着いてからメモリ上の設定へ反映する（`window_placement::track`）。eventの時点では、最大化の状態がまだ反映されていない（実測）。eventのたびに読むと、最大化に伴うeventで画面いっぱいの大きさが「最大化していない配置」として保存され、元へ戻したときの大きさを失った。そこで、eventが届いたら次のeventが来なくなるまで待ち（150 ms）、状態が揃ってから読む。読む専用のスレッドを1つ持ち、ドラッグで大量に届くeventのたびには読まない。動きが落ち着く前に終了すると、終了時の書き出しが先に走り、最後の配置を失う。そこで、ウィンドウを閉じる要求（`CloseRequested`）と、アプリの終了の要求（`ExitRequested`。メニューの「終了」のようにウィンドウを経由しない終了）の時点でも、待たずに読み、書き出しの前に確定する（`window_placement::capture_now`）。書込みは、ほかの設定と同じdebounceに任せる。単位は物理ピクセルで、位置は外枠の左上、サイズは内側の大きさとする。枠とタイトルバーの厚みはOSとDPIで変わるため、外形は保存しない。最大化中は、元へ戻したときの位置とサイズを保ち、最大化の状態だけを変える。最大化中に取れる値は画面いっぱいであり、それを保存すると、最大化を解いても画面いっぱいのまま戻る。最小化中はWindowsがウィンドウを画面の外へ置くため、保存しない。

復元は、ウィンドウを作るときに行う。保存した配置を復元するときは、ウィンドウを非表示で作り、位置とサイズを適用し、最大化してから表示する。表示してから動かすと、既定の位置に一瞬見える。

今の画面に合わない配置は、復元せず、既定の配置で開く。判定は、タイトルバーの中央が、接続中のいずれかのディスプレイの内側にあるかで行う（`window_placement::is_restorable`）。タイトルバーを掴めれば、画面からはみ出した配置や、2つのディスプレイにまたがる配置は、利用者が戻せる。掴めない配置（外したディスプレイの上、上へはみ出したもの）だけを弾く。最寄りのディスプレイへ寄せる案は、ディスプレイの幾何とDPIの計算が増え、寄せ先の判定が複雑になるため採らなかった。ディスプレイを取得できないときは、判断できないため復元しない。

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
| 出力 | `public/third-party-licenses.json`。リポジトリへコミットせず、lockfileから都度生成する。Viteが `public/` をビルドの出力へ複写する |
| 検査 | CIの `Licenses` ジョブが生成を実行し、条文を取得できないパッケージがあれば失敗する |

判断の理由は次のとおり。

- ライセンス本文まで収集する。MITやBSDは著作権表示とライセンス文の同梱を条件とするため、SPDX識別子の一覧では要件を満たさない。`cargo-license` を採らなかったのはこのため。
- SPDXのtag-valueファイル（`LICENSE.spdx` 等）は本文として扱わない。`PackageLicenseDeclared` などのメタデータだけで条文を含まないため、本文として数えると条文の欠落を見逃す。実際に `@tauri-apps/plugin-opener` は `LICENSE.spdx` しか同梱していない。
- 条文を取得できないパッケージは生成を失敗させる。配布物へ含める条件を満たせないまま出荷しないため。上流が同梱しない場合は `licenses/overrides/` へ本文を配置して解消する。
- 対象を配布物に含まれる依存へ限る。JavaScript側は `dependencies` とその推移閉包のみを辿り、Rust側は `about.toml` でbuild依存とdev依存を除外する。
- 許容ライセンスを `about.toml` の `accepted` へ列挙する。未列挙のライセンスを持つcrateが増えると生成が失敗するため、依存追加時にライセンスを確認する強制力を持つ。この一覧をJavaScript依存の検査も共有する（次の項）。
- `package.json` でライセンスを宣言していないパッケージは、同梱の条文から確かめたSPDX識別子を `licenses/overrides/<パッケージ名>/SPDX-ID` へ置く。推測で補わず、置かなければ生成を失敗させる（Mermaidの依存 `khroma` が該当。条文はMIT）。
- Mermaid 12の依存 `elkjs`（EPL-2.0、`layout: elk` 用）を受け入れて同梱する（Phase 4-2で判断）。EPL-2.0はオブジェクト形式での配布でもソースコードの入手方法の案内を求めるため、サードパーティライセンスの表示で上流のリポジトリを示す。依存の内部を差し替えて除外する案は、Mermaidの更新で壊れやすいため採らなかった。
- 生成物をリポジトリへコミットしない。バージョンの正本を `bun.lock` と `Cargo.lock` の1か所へ寄せ、生成物はそこから都度導出する。当初は生成物をコミットし `git diff --exit-code` で最新かを検査していたが、Renovateが依存を更新してもlockfileしか書き換えないため、依存更新のPull Requestが例外なく `Licenses` ジョブで失敗した（[#32](https://github.com/scottlz0310/md-peruse/pull/32) で顕在化）。バージョンを2か所で持つ限り、生成物を手で追随させるか自動マージを諦めるかの二択になる。導出へ変えれば不整合が構造として生じない。
- 差分でライセンスの増減が見えなくなる点は、生成の失敗で代替する。条文を取得できないパッケージがあれば生成自体が失敗するため、未知の依存が黙って入ることはない。Rust側は `about.toml` の `accepted` が未列挙のライセンスも検出する。JavaScript側も同じ許容リストで検査する（次の項）。
- JavaScript依存のライセンス種別も、`about.toml` の `accepted` で検査する（Phase 5）。条文を取得できても、GPLなど再配布条件の異なるライセンスが黙って入らないようにするためである。生成物をコミットしないため（上記）、Pull Requestの差分から気づく経路がなく、`Licenses` ジョブの失敗がその代わりになる。許容リストの正本は1つで、別の一覧を `scripts/` に持たない。片方だけに足して食い違う状態を作らないため、また、依存の許容を判断する場所を1つにするためである（`scripts/license-policy.ts` が `about.toml` を読む）。判定はSPDXのライセンス式で行う。`A OR B` はどちらか一方が許容されていればよく（利用者が選べる）、`A AND B` は両方が必要で、`A WITH 例外` は例外が権利を足すだけなので `A` で判定する。式として読めないもの（`SEE LICENSE IN ...` など）は許容しない。識別子は大文字小文字を区別しない（SPDXの規則）。末尾の `+` は `-or-later` として比べる（`GPL-2.0+` は `GPL-2.0-or-later`）。`+` を削って基底の版で比べると、後続版まで許す依存を、基底の版だけの許容で通してしまうため、削らない。実際の依存（242件）は、`MIT`、`ISC`、`Apache-2.0`、`BSD-2-Clause`、`BSD-3-Clause`、`Unlicense`、`(MPL-2.0 OR Apache-2.0)`、`EPL-2.0`（`elkjs`）に収まり、`khroma` は `SPDX-ID` の上書きでMITと判定する。
- `elkjs` のEPL-2.0は、`accepted` へ全体の許容として加えた。`elkjs` だけに限る案（パッケージ単位の例外）は、将来ほかの依存がEPL-2.0になったときに検出できる点で厳しいが、例外の仕組みを持つ必要があり、`accepted` の1つの一覧で足りることを優先した。この結果、Rust側（cargo-about）もEPL-2.0を許容する。Rust側の依存がEPL-2.0になっても検出されない点は、受け入れる（ユーザーの判断。2026-10-01）。
- 生成はリリースのビルドの前に行う。`tauri.conf.json` の `beforeBuildCommand` を `bun run generate:licenses && bun run build` とし、`build-msix.ps1` が呼ぶ `tauri build` が、生成してから同梱する。`bun run build` 単体には組み込まない。組み込むと `Frontend` と `Rust` の両ジョブに `cargo-about` の導入が要り、生成に約6秒（コールドで約33秒）が加わる（実測）。
- 生成物は `public/` へ置き、ダイアログを開いたときに `fetch` で読む（`connect-src 'self'` が許す）。JavaScriptのバンドルへ入らず、`typecheck`、`test`、`dev` は生成物に依存しない。静的に `import` する案は、型が付く代わりに、生成物が無いと `typecheck` と `dev` が失敗する。すべての入口の前で生成が要るため採らなかった。Rustが `include_str!` で埋め込みIPCで返す案は、`cargo build`、`test`、`clippy` のすべてで生成物が要り、約500KBをIPCで運ぶことにもなるため採らなかった。
- 生成物の形は `src/licenses/licenses.ts` を正本とし、生成スクリプトも同じ型を使う。読み込んだ生成物の形は検証しない。生成物は同じビルドで生成した自前のファイルであり、形が食い違うのは開発中に古い生成物が残っているときに限られる。
- md-peruse自身の名前、バージョン、ライセンスも生成物へ含める。バージョンの正本は `package.json` である（`Cargo.toml`、`tauri.conf.json` とCIで同期する）。Tauriの `getVersion` は `core:app` のcapabilityを増やすため使わない（5.5）。`package.json` には `license` を宣言する。
- JavaScript側に既製ツールを使わない。主要なツールはnpmのnode_modulesレイアウトとCLIに依存し、Bunでの動作保証がない。走査するのは `package.json` とライセンスファイルだけで、実装は小さい。
- ライセンス本文を `licenseTexts` へ集約し、各パッケージはインデックスで参照する。同じ本文を多数のcrateが共有するため、パッケージごとに本文を持たせると生成物が数MBに達し、バンドルサイズと依存更新時の差分の両方を悪化させる。

アプリ内の表示は、ヘルプメニューの「md-peruse について」（`about`）が開くダイアログで行う。処理はFrontendが担い、Rustは `about` を `menu-command` でFrontendへ渡す（10.1）。約490件の一覧はネイティブのダイアログに載せられない。専用のウィンドウはWebView2のプロセスを増やし、アイドル時の低負荷（`spec.md` 5.2）に反する。そこでWebView内のモーダルな `<dialog>`（`src/licenses/AboutDialog.tsx`）とする。フォーカスの閉じ込めと `Esc` で閉じる操作はブラウザーに任せ、閉じたあとは開く前にフォーカスのあった要素へ戻す。ワークスペースを開いていなくても開ける。ライセンスの本文を外部のファイルとして同梱し、既定のアプリで開く案は、検索できず、関連付けとMSIXのパスに依存し、`spec.md` 5.7の「アプリ内から参照できる」を満たすか怪しいため採らなかった。

- 一覧はパッケージ単位とし、名前・バージョン・ライセンスの行を並べる。名前で絞り込める。本文は行を開いたときにだけ描く。同じ本文を多数のパッケージが共有し、全件を描くとDOMの文字が数MBになるためである。本文ごとにパッケージをまとめる案は、パッケージ名から探すのに検索が要り、約490名を目で追うことになるため採らなかった。
- EPL-2.0の依存（`elkjs`）は、ソースコードの入手先（上流のリポジトリ）を本文の前に示す。EPL-2.0はオブジェクト形式での配布でも、ソースコードの入手方法の案内を求める。入手先は `licenses/overrides/<パッケージ名>/SOURCE-URL` に置いたURLで、生成物の `sourceUrl` へ書く。URLはリンクにせず文字として示す。外部のブラウザーを開く操作と、その失敗の扱いを増やさないためである。
- 開発中は、`bun run generate:licenses` を実行するまで、ダイアログは一覧を読み込めない。その場合は読み込めなかった理由を示す。

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
| `open_md_fail` | 文書全体を描画できず、失敗を表示したとき | 目的の未達 |
| `open_folder` | 利用者がワークスペースを開いたとき（起動時の復元は数えない） | フォルダー中心の利用 |
| `launch_by_association` | 関連付け起動でファイルを受け取ったとき（開けたかは問わない） | 関連付けの定着 |

**5つすべてをセッション単位とし、1セッションにつき1回だけ送る。** どの率も `session_start` を分母としてそのまま読めるようにするためである。発生ごとに送るイベントが1つでも混ざると、その系列だけが100 %を超えうる。Partner Center側には件数しか残らないため、後から分母を推定し直すこともできない。

この統一により、次の読み方が成立する。

- 起動して何もせず閉じた割合 = 1 − `open_md_ok` / `session_start`
- 失敗を経験したセッションの割合 = `open_md_fail` / `session_start`
- 関連付けから始まったセッションの割合 = `launch_by_association` / `session_start`

代償として、1セッションでタブを何枚開いたかという利用量は測れない。イベントを5種類から増やさない制約の下では達成率と利用量は両立しないため、「Markdownを実際に開けたか」の達成率を採る（[#21](https://github.com/scottlz0310/md-peruse/issues/21) の決定事項）。

シングルインスタンス（9.2）のため、2つ目以降のファイルは既存ウィンドウのタブとして開く。この経路では新しいセッションが始まらないので、`session_start` と `launch_by_association` を送らない。タブ追加でも送る設計にすると、1回の起動で複数のファイルを関連付けから開いたときに `launch_by_association / session_start` が100 %を超える。タブ起動では常用パターンとなるため必ず起きる。

`open_md_ok` は、ファイルを選んだ時点ではなく描画の完了時に送る。読込に成功しても描画で失敗する経路があり、選択時に送ると達成数を過大に数える。描画の完了はFrontendが知るため、Frontendからcommandで伝える（`report_open_result_command`。値は成功と失敗の2値に限り、イベント名は渡さない）。Frontend発のeventは使わない（5.5）。

**`open_md_fail` は、文書全体を表示できなかったときに限る。** 読込の失敗（見つからない、大きすぎる、文字コードなど）を表示したときと、本文の描画パイプライン自体が例外で失敗したときである。数式（KaTeX）・図（Mermaid）・画像の位置だけの失敗は、その位置に理由を示すだけで文書は描画できているため、失敗に数えず、`open_md_ok` を送る。この計測の目的は「Markdownを実際に開けたか」の達成率であり、壊れた数式1つで「開けなかった」と数えると、達成率が下がる要因が文書の書き方に混ざる。読込の失敗は、失敗の表示が実際に出たときだけ数える（閉じたタブや、変更を受けた再読込の失敗は数えない）。本文の描画パイプラインの例外は、これまで何も表示されなかった。利用者へ理由を示すようにし、あわせて失敗に数える。

**`open_folder` は、利用者が開いたものに限る。** フォルダー選択、最近使ったフォルダー、ドロップは数え、起動時の最後のワークスペースの復元は数えない。復元を数えると、前回のワークスペースが残る利用者は起動するだけで毎回送信され、`open_folder / session_start` がほぼ100 %になって、フォルダー中心の利用を区別できない。判定は `open_folder::open_path` の成功後に行う（復元は別の入口で、数えない）。

**`launch_by_association` は、新規に起動したプロセスの起動引数に、対象拡張子のファイルがあったときに送る。** ファイルを開けたかは問わない。起動中のインスタンスへ渡された2つ目のプロセスの引数では送らない（下記）。コマンドラインからファイルを渡した起動も、関連付け起動と区別できないため数える。

キャンセルと失敗では成功イベントを送らない。フォルダー選択ダイアログを閉じただけのときに `open_folder` を送らず、読込や描画に失敗したときに `open_md_ok` を送らない。

#### データ最小化

イベント名以外を送らない。`StoreServicesCustomEventLogger.Log()` は文字列1つを受け取るため、この形が要件をそのまま満たす。ファイルパス、ファイル名、本文、ワークスペース情報、ユーザー名、端末識別子のいずれも含めない。

`open_md_fail` に失敗の原因（`ErrorCode`）を添えない。原因の内訳は診断（11.2）の関心であり、送信するとイベント名が原因の数だけ増えて「5種類から増やさない」制約と衝突する。

#### 失敗時の挙動

送信の失敗を無視する。ログにも残さない（11.2）。`StoreServicesCustomEventLogger` の取得と `Log()` の失敗はHRESULTとして返り、例外やプロセス終了にはならない（13.5）。再送しない。エラーを上位へ伝播させる原則（12章）はユーザーの操作に対する失敗を対象とし、テレメトリはユーザーが要求した操作ではないため、この原則の対象外とする。

ファイル・フォルダー操作の成否を、テレメトリの成否へ依存させない。送信は操作の完了後に行い、送信の結果を操作の結果へ反映しない。

#### 実装の構成

発火点はすべて `Telemetry::record`（`src-tauri/src/telemetry.rs`）を呼ぶ。この入口が、Store署名のときだけ送ること、各イベントを1セッションに1回だけ送ること、送信の失敗を無視することを引き受ける。発火点ごとに書かない。送信の口は `EventLogger`（イベント名だけを受け取る）で、実装は `StoreEventLogger`（`src-tauri/src/telemetry/store_logger.rs`）である。

`StoreEventLogger` は、`StoreServicesCustomEventLogger.Log()` を常駐の専用スレッドで呼ぶ。`record` は名前をチャンネルへ置くだけで、DLLのロードと `Log()` の待ちで呼び出し元を止めない。起動時の `session_start` はメインスレッドで記録されるため、これは起動を遅らせないための要件でもある。専用スレッドはMTAで初期化し、ロガーのオブジェクトをセッションの間ずっと持つ。通常のアプリが最初に作ったロガーを使い続ける形と揃え、SDKが内部で持つ送信の処理をスレッドの終了に巻き込まない。Partner Centerに実際に反映されるかは、Store公開後にしか確認できない（13.5）。

スレッドは最初のイベントで初めて立てる。Storeから配布されていない実行は `record` が送信の手前で止めるため、スレッドもWinRTの活性化も生じない。スレッドを立てられない場合と、送信の口を得られない場合は、スレッドが終わって受け手が捨てられ、以後の記録が失敗として返る。これは他の送信失敗と同じく無視する。終了直前にチャンネルに残ったイベントは失われうる。最善努力の送信であり、再送しない方針（前節）と整合する。

| イベント | 発火点 |
| --- | --- |
| `session_start` | プロセスの起動時（`setup`。`Telemetry::record_process_start`） |
| `launch_by_association` | 同上。起動引数に対象拡張子のファイルがあるとき（`launch::launched_by_association`） |
| `open_folder` | `open_folder::open_path` の成功後 |
| `open_md_ok`、`open_md_fail` | Frontendが `report_open_result_command` で知らせる（`MarkdownDocument` の描画の完了と失敗、読込の失敗の表示） |

起動中のインスタンスへ渡された2つ目のプロセスの引数の経路（`launch::second_instance`）は、テレメトリに触れない。テストで固定している。

#### Store版限定条件

**`Package.Current.SignatureKind` が `Store` のときだけ送る。** 判定の正本は `src-tauri/src/telemetry.rs` の `should_send` とする。

パッケージIDを持たない実行では送信経路そのものが成立せず、`bun run tauri dev` を含む非パッケージ実行では `GetDefault()` が `0x80040154` で失敗する（13.5）。しかしこれだけでは「開発版・テスト環境で本番イベントを送信しない」を保証できない。13.5はEngagementとVCLibsの `PackageDependency` を宣言したpackaged classic appで `GetDefault()` と `Log()` が成功することを記録しており、これは開発用の自己署名MSIXやパッケージ化したE2E実行にも当てはまる。パッケージ化した開発版・テスト版がStoreの計測へ混ざる経路が残る。

署名種別で判定できることを実測で確認した。開発用証明書で署名してインストールしたMSIXは `Developer` を返し、Microsoft Storeから配布されたアプリは `Store` を返す。

| パッケージ | `SignatureKind` |
| --- | --- |
| 開発用証明書で署名した自己配布MSIX（別プロジェクトのローカル検証用パッケージ2件） | `Developer` |
| Microsoft Storeから配布されたアプリ（電卓、メモ帳） | `Store` |

ビルド時のfeature flagで分けない。提出用ビルドの設定を取り違えたときに気づけないためである。署名種別は提出物そのものの性質であり、ビルド設定から独立している。パッケージIDを取得できない実行では署名種別も得られないため、`None` として同じ判定へ集約する。

「パッケージ化した開発版・テスト版で送信しない」ことは、回帰テストとして固定した。すべてのイベントが `Telemetry::record` の判定（`should_send`）を通り、`Developer` 署名と非パッケージ実行では、どのイベントも送信の口へ届かない。署名種別は `package_signature_kind`（`Package::Current().SignatureKind()`）で取得し、取得できないとき、または知らない値のときは送らない側へ倒す。実際にパッケージ化した開発版でも、`Developer` 署名では送信の口へ届かないことを、開発用証明書で署名したMSIXで確認した（13.5）。

将来のSDK更新で経路が失われた場合は、イベントなしで提出する。この機能がStore提出をブロックしない（13.5）。

#### 計測定義

実装前に確定すること（本節）と、公開後に実データで確認すること（Phase 5、段階4）を分ける。

**本設計の「セッション」はプロセスの起動から終了までを指す。** Partner CenterのUsage reportが持つ標準のUser sessions指標とは単位が異なる。標準側は利用者の非活動によって区切られうるため、1回のプロセス起動が複数のUser sessionとして数えられることも、短時間の起動と終了が別々に数えられることもある。`session_start` はプロセスの起動時に1回だけ送るため、両者の件数は一致しない。

この違いから、次を実装前の規則として定める。

- 比率はカスタムイベントどうしでのみ取る。`open_md_ok / session_start` は「プロセス起動あたりの達成率」であり、標準Sessions指標に対する率ではない。分母を標準Sessionsへ置き換えない。
- 「起動して何もせず閉じた割合」は 1 − `open_md_ok` / `session_start` とし、プロセス起動を単位として読む。標準セッション率とは呼ばない。
- 件数からDAU、インストール数、利用時間、1セッションあたりのタブ数を推定しない。イベントは5種類で各1回であり、これらを導く情報を持たない。

[#21](https://github.com/scottlz0310/md-peruse/issues/21) が求める「カスタムイベントだけではセッション単位の判定ができない場合の制約と代替する分析方法」は、次のとおり確定する。**標準Sessions指標との対応付けを行わない。** カスタムイベントはプロセス単位の指標として独立に読み、両者を同じ式へ混ぜない。対応付けの試みは、非活動による区切りという観測できない要因を推定することになり、「過剰な推定を行わない」という要件と衝突する。

公開後に確認する項目は次のとおり（段階4）。

| 項目 | 確認する内容 |
| --- | --- |
| 反映遅延 | イベントがUsage reportへ現れるまでの時間 |
| バージョン別フィルター | パッケージバージョン別に分離できる粒度 |
| 標準Sessions指標との開き | 対応付けはしないが、桁が大きく違う場合は発火点の誤りを疑う材料になる |
| 母集団の偏り | 診断データをオプトインした端末に限られること。率は読めてもインストール数へは接続できない |

## 12. エラー方針

次の失敗では原因と対象を表示し、握りつぶさない。

- WebView2 Runtimeの欠落または初期化失敗
- フォルダー選択失敗、アクセス拒否
- Markdownのデコード失敗、サイズ上限超過
- 画像の境界違反、サイズ超過、ピクセル寸法超過、読込失敗
- Mermaid、lowlight、KaTeXの描画失敗とlazy importの失敗
- Mermaidの図と数式が処理上限を超え、描画しなかったこと（8.4、8.5）
- ファイルの削除、移動、置換、共有違反
- 監視が追従できない量の変更、または監視の停止
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

**WebView2 Runtimeの欠落と初期化の失敗（起動失敗）。** ウィンドウ（WebView）を作れないと、FrontendもIPCも成立しないため、ネイティブ側だけが原因を示せる。Release（Phase 4）で、環境変数 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER`（存在しないフォルダー、Runtimeの無いフォルダー）と `WEBVIEW2_USER_DATA_FOLDER`（ファイルを指す）で失敗を再現し、次の挙動を確かめた。

| 失敗 | 実装前 | 実装後 |
| --- | --- | --- |
| Runtimeが見つからない | Tauri（wry）の英語のダイアログ（「Could not find the WebView2 Runtime」、公式の入手先つき）だけで、UI言語の案内は無い。ダイアログが出ないまま異常終了した回が1回あった（再現せず） | 同じダイアログの後に、UI言語のダイアログを示して終了する |
| 利用者データのフォルダーを使えない | panic（`Failed to setup app: error encountered during setup hook: the underlying handle is not available`）で、案内なしに異常終了した（終了コード0xC0000409）。WebView2が出す日本語のダイアログ（「データ ディレクトリを作成できませんでした」）は別のプロセスから出る | WebView2のダイアログの後に、UI言語のダイアログを示して終了する |

実装は、ウィンドウを作る処理（`WebviewWindowBuilder::build` と、そのWebViewを扱う `webview_keys::attach`）の失敗を捕まえ、`src/startup_failure.rs` で、UI言語（設定から決まる言語）の案内、Microsoftの公式の修復先（https://developer.microsoft.com/microsoft-edge/webview2/）、失敗の内容を含むネイティブのメッセージボックスを示してから、終了する（終了コード1）。Tauriの `setup` は失敗を返すとpanicにするため、返さずにその場で終了する。`webview_keys::attach` のWebView2のCOM呼び出し（`ICoreWebView2Settings3` の取得を含む）の失敗は、`.expect` のpanicではなく `Result` で返す。`panic = "abort"` のReleaseでは、panicすると案内を出せないためである（レビュー指摘）。Tauriのダイアログのプラグインは、アプリを作った後のハンドルが要るため使わず、`MessageBoxW` を呼ぶ。WebView2やwryが先に出すダイアログは、抑えられないため、そのまま出る（2つ続けて出る）。実機のWebView2で、上の2つの失敗を再現し、案内のダイアログの表示と、閉じた後の終了を確かめた。旧いRuntimeで `ICoreWebView2Settings3` を取得できない場合は、インターフェイスの取得を一時的に失敗させて再現し、案内の詳細に「WebView2のブラウザーアクセラレータキーを無効にできない: インターフェイスがサポートされていません (0x80004002)」が出ることを確かめた。MSIXのPackage Identityの失敗は、この確認の対象外で、Phase 5で扱う。

## 13. パッケージングとStore

- Tauri CLIのRelease出力をx64で生成する。
- winapp CLIでx64のMSIXを生成する。
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
| 依存 | `Microsoft.Services.Store.Engagement`（10.0.23012.0以上）と `Microsoft.VCLibs.140.00`（14.0.0.0以上）の2つの `PackageDependency`。Store向けカスタムイベントの送信に必要（13.5） |
| winapp CLI | 0.6.1（WinGet `Microsoft.WinAppCli`） |

マニフェストは `packaging/Package.appxmanifest.template` を正本とし、`scripts/build-msix.ps1` が `Version` を置換して生成する。`ProcessorArchitecture` は `x64` に固定する（ARM64は対応外。3章）。

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

MSIXはx64のReleaseビルドから生成する。ARM64は対応外とした（3章）。Phase 1ではx64ホストからのクロスコンパイル（`aarch64-pc-windows-msvc`）でARM64版のMSIXも生成できることを確認したが、実機で検証できないため以後は扱わない。x64の `tauri build` は成功し、生成したMSIXのサイズは約1.4MBである。

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

いずれもアプリのコードが外部プロセスを起動するものではない。Store提出を妨げる失敗はないと判断するが、審査で指摘された場合に備えて上記の内訳を記録する。

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

したがって関連付け起動の受け口はコマンドライン引数でよく（`std::env::args_os()`。`args()` はUnicodeでない引数で異常終了する）、WinRTのアクティベーションハンドラを実装する必要はない。`ContractId="Windows.File"` はレジストリへ登録されるが、`EntryPoint="Windows.FullTrustApplication"` のpackaged classic appに対してはWindowsがコマンドライン起動へ変換する。

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
- パッケージIDを持たない実行（`bun run tauri dev` を含む）では `0x80040154` で失敗する。ただしこれは「開発版・テスト環境で本番イベントを送信しない」という要件を満たさない。上記のとおりEngagementとVCLibsの `PackageDependency` を宣言したパッケージでは送信が成功するため、開発用の自己署名MSIXやパッケージ化したE2E実行はこの経路を通る。要件は `Package.Current.SignatureKind` による明示的な判定で満たす（11.4）。
- 失敗はHRESULTとして返るだけで、例外やプロセス終了にはならない。「テレメトリの送信失敗でファイル・フォルダー操作を失敗させない」という要件は呼び出し側で担保できる。

実装（`src-tauri/src/telemetry/store_logger.rs`）は、SDKのwinmdも、そこから生成したバインディングも使わない。SDKの成果物とそこから生成したコードは、ライセンス上の扱いに注意が要るため、リポジトリへ含めない。呼ぶのは `GetDefault()` と `Log()` の2つだけなので、必要な情報を手で書いた最小のABIで呼ぶ。値は、ローカルに導入したframework packageの `Microsoft.Services.Store.Engagement.winmd` のメタデータから読み取った。

| 項目 | 値 |
| --- | --- |
| 活性化するクラス | `Microsoft.Services.Store.Engagement.StoreServicesCustomEventLogger`（ThreadingModel `both`） |
| statics のIID | `IStoreServicesCustomEventLoggerStatics` = `5E9C9D4B-A892-32F3-87AC-410B81F89CD6` |
| ロガーのIID | `IStoreServicesCustomEventLogger` = `6D544721-C351-3A70-95B6-161F52FBC13D`（`GetDefault()` が既定のインターフェースを直接返すため、実行時には使わない） |
| staticsのvtable | `IInspectable`（6スロット）のあと、slot 6 が `GetDefault(out logger)` |
| ロガーのvtable | `IInspectable`（6スロット）のあと、slot 6 が `Log(HSTRING)`、slot 7 が `LogForVariation`（呼ばない） |

活性化ファクトリを `IInspectable` として得て、staticsのIIDで `QueryInterface` し、`GetDefault()` でロガーを得る。ロガーとstaticsの解放は、`IInspectable` の`Drop` に任せる。インターフェースはIIDで固定されるため、SDKの更新でメソッドの並びが変わることはない。

このABIを、開発用証明書で署名したmd-peruse本体のMSIX（2つの `PackageDependency` を宣言したもの）で実測した。送信スレッドの各段の結果を一時的に記録するパッチを当てたReleaseビルドで、確認後にパッチは戻している。

| 実行条件 | 結果 |
| --- | --- |
| `Developer` 署名のまま起動 | `session_start` の記録が署名種別の判定で止まる。送信スレッドも `RoInitialize` も `Log()` も動かない |
| 署名種別の判定だけを一時的に外して起動 | `RoInitialize`、`GetDefault()`、`Log(session_start)` がすべて成功する。起動後もアプリは応答し、ウィンドウを閉じると正常に終了する |

これで、手書きのABIが本物のDLLに対して成立すること、`Developer` 署名では送信の口へ届かないことを確認した。`Store` 署名での送信は、Store公開後にしか確認できない。

未確認の事項は次のとおり。

- Store提出時にframework packageの依存をStoreが解決するか。ローカル検証では `Add-AppxPackage` で事前に導入した。
- Partner CenterのUsage reportへイベントが実際に反映されること。Store公開後にしか確認できないため、段階4で行う。
- SDKがpackaged classic appを公式サポートすると明記した文書はない。動作は実測できたが、将来のSDK更新で崩れうる前提として扱い、段階2では送信経路が失われても機能へ影響しない設計とする。

[#21](https://github.com/scottlz0310/md-peruse/issues/21) の追加要件1は、公式API経路が使えなかった場合の分岐（イベントなしで初回提出する、提出を遅らせて実装する、別経路を採る）を確認作業の前に決めることを求めていた。実測で経路が成立したため、この分岐を選ぶ必要はなくなった。将来SDK側の変更で経路が失われた場合は「イベントなしで提出する」を既定とし、このIssueがStore提出をブロックしない。


### 13.6 Phase 4 での再測定（Release、パッケージ化しない）

13.3で「実装が進んだ時点で再測定する」とした指標のうち、描画に関わる3つ（文書切り替え、変更反映、ツリー展開）を、Phase 4の機能が揃った時点で測った。起動とメモリはMSIXインストール済みの条件が要るため、Phase 5で測る。この測定で、大きい・複雑な文書の描画が数十秒から2分かかることが分かり、書式を付けて描画する文書に上限を設けた（8.7）。[spec.md](./spec.md) 5.1の目標は、この実測に合わせて改めた。

**条件。** x64、Windows 11、Core i7-12700K（Pコア8、Eコア4。20論理コア）、メモリ48 GB、SSD、Microsoft Defenderの既定、WebView2 154。`tauri build --no-bundle` のReleaseのexeを直接実行した（MSIXではない）。ユーザーが操作していない状態で、CDP（リモートデバッグ）から測った。

**測り方。**

- 文書切り替え: ツリーの行のclickを発行し、本文のh1が新しい文書になるまでをMutationObserverで待ち、直後のフレームで強制レイアウトを行った時点を「描画完了」とした（ラスタライズと合成は含まない。含めても判定が変わらないことは下の「描画完了の測定点」で確かめた）。測定の前に小さな文書へ戻す。
- 変更反映: 外部で一時ファイルを書いてrename（atomic replace）した時刻から、本文が新しい内容になり強制レイアウトが済むまで。時刻は `Date.now()` である。debounce（150 ms）を含む値を測り、引いた値を併記する。
- ツリー展開: フォルダーの行のclickから、1000項目が並び強制レイアウトが済むまで。フォルダーを5つずつ用意し、初回の展開を5回測る。
- 文書: 見出し・段落・リスト・表・引用（素のMarkdown）と、コードブロック・数式を含む形の2種類を、指定のサイズへ生成した。

**結果。**

| 指標 | 条件 | 実測 | 目標 |
| --- | --- | ---: | ---: |
| 文書切り替え（書式あり） | 250 KiB（13万文字） | 0.30〜0.33秒 | 500 ms |
| 同 | 1 MiB（54万文字、リスト項目3800） | 1.3〜1.4秒（外れ値2.15秒が1回） | 2.5秒 |
| 同 | 上限の内側（59万文字、素のMarkdown。8.7） | 中央値1.43秒（40回。95パーセンタイル2.42秒、最大2.84秒。2.4秒以上は2回。下記の「外れ値」） | 2.5秒 |
| 文書切り替え（書式なし） | 10 MiB | 1.8〜2.1秒 | 3秒 |
| 変更反映 | 250 KiB | 0.35〜0.39秒（debounceを除き約0.22秒） | 500 ms |
| 同 | 1 MiB | 1.05〜1.15秒（初回1.4〜1.7秒。除き約0.9〜1.0秒） | 2.5秒 |
| ツリー展開 | 1000ファイル | 26〜38 ms | 300 ms |
| 同 | 1000サブフォルダー | 104〜110 ms | 300 ms |

小さな文書の切り替えは約0.09秒である（前の文書のDOMの破棄を含む）。サイズごとの表示時間の内訳は8.7を参照する。

**判定の基準と外れ値。** 目標は、同じ条件の連続した測定の中央値で判定する。上限の内側（59万文字）の文書は、40回の連続した切り替えで、中央値1.43秒、95パーセンタイル2.42秒だったが、2回（2.84秒、2.42秒）が平常の1.4〜1.5秒より大きく外れ、別の測定でも12回中2回（2.6秒、3.6秒）が出た。この端末のCPUは、高性能コア（P）と効率コア（E）が混在する。アプリのプロセスの実行先をコアの種類で固定して測ると、次のとおり外れ値の大きさと一致した。

| 実行先 | 回数 | 最小 | 中央値 | 最大 |
| --- | ---: | ---: | ---: | ---: |
| Pコアだけ（論理CPU 0〜15） | 8 | 1.39秒 | 1.43秒 | 1.57秒 |
| Eコアだけ（論理CPU 16〜19） | 8 | 2.47秒 | 2.52秒 | 2.83秒 |

外れ値は、描画の処理が効率コアで動いたときの値（約1.8倍）と考えられる（外れ値の回に実際に効率コアで動いたかは、確かめていない）。30回のトレースでは外れ値は出ず、GCの合計（1回の切り替えあたり最大約0.14秒）も外れ値を説明しない。したがって、上の表の目標は、高性能コアで動いたときの中央値で判定し、効率コアで動く回はその約1.8倍を見込む。この端末で目標の2.5秒に収まるのは、上限の内側の文書が高性能コアで動くときである。効率コアだけで動くと、書式ありの上限の内側では2.5秒前後になる。[spec.md](./spec.md) 5.1へ、判定の基準を明記した。

**描画完了の測定点。** 上の測定は、DOMへの反映後の最初のフレームで強制レイアウトを行った時点を完了とした（ラスタライズと合成を含まない）。利用者が画面で見る時点とのずれを、Chromiumのトレース（CDPの `Tracing`。描画のメインスレッドの `ProxyMain::BeginMainFrame` と、その中の段階ごとの合計）と、次のフレームの `requestAnimationFrame` までの時間で確かめた。強制レイアウトの後に残るのは、PrePaintとペイントで合わせて0.03〜0.11秒（書式なしの10 MiBで約0.25秒）、ラスタライズが別スレッドで最大11 msだった。ずれは、目標（500 ms、2.5秒、3秒）の判定を変えない大きさであり、レイアウトの確定を完了とみなす。定義は [spec.md](./spec.md) 5.1に明記した。

**アクセシビリティ木の更新。** 次のフレームまでの時間は、この端末では、そのほとんどをアクセシビリティ木の更新（`Blink.Accessibility.UpdateTime`。フレームのコミットの後に、メインスレッドで行う）が占めた。測定に使ったWebView2では、無人の測定でもこの更新が走っていた（アクセシビリティを有効にしたUIAクライアントがあるためと考えられるが、特定していない。`--disable-renderer-accessibility` を渡しても変わらなかった）。

| 文書（書式） | 強制レイアウト | 次のフレーム | アクセシビリティ | PrePaint＋ペイント | ラスタライズ |
| --- | ---: | ---: | ---: | ---: | ---: |
| コードと数式 250 KiB（あり） | 0.40秒 | 0.57秒 | 0.22秒 | 33 ms | 8 ms |
| リスト主体 500 KiB（あり） | 0.85秒 | 1.20秒 | 0.31秒 | 39 ms | 2 ms |
| 素のMarkdown 1 MiB（あり） | 1.15秒 | 1.66秒 | 0.45秒 | 52 ms | 1 ms |
| コードと数式 1 MiB（あり） | 1.35秒 | 1.45秒 | 1 ms | 112 ms | 2 ms |
| コードと数式 2 MiB（なし。分ける前） | 0.39秒 | 6.6秒 | 6.1秒 | 50 ms | 1 ms |
| 同 10 MiB（なし。分ける前） | 1.9秒 | 150〜152秒 | 148〜150秒 | 242〜247 ms | 0〜1 ms |
| コードと数式 2 MiB（なし。分けた後） | 0.35〜0.40秒 | 0.44〜0.49秒 | 38〜40 ms | 49〜52 ms | 0〜12 ms |
| 同 10 MiB（なし。分けた後） | 1.71〜1.92秒 | 2.10〜2.32秒 | 140〜143 ms | 235〜251 ms | 1 ms |
| 1行が109万文字のテキスト（なし。分けた後） | 0.62〜0.79秒 | 0.78〜0.95秒 | 115〜116 ms | 48〜50 ms | 1〜13 ms |

書式ありの文書では、ノード数に比例して0.2〜0.5秒である。書式なしの表示は、1つの `pre` に巨大な1つのテキストノードを置いていたため、テキストの長さの二乗に近く伸びた（109万文字で5.9秒、543万文字で148秒。観測であり、Chromium内部の原因は確かめていない）。アクセシビリティ木を使う環境（スクリーンリーダーなど）では、書式なしの大きい文書を開くと、数秒から2分を超えて応答しなくなる。本文を5,000〜10,000文字ごとの隣り合うテキストノードに分けて対処した（8.7）。アクセシビリティを有効にした（`Accessibility.enable`）状態の実機（Release）で、上の表の「分けた後」のとおり、10 MiBが次のフレームまで約2.3秒、1行が極端に長いテキストも1秒以内になった。分ける前の1行のテキストは、テキストノードだけを分ける試作の比較で、109万文字が約81秒（分けると0.6〜0.8秒）だった。テキストノードの数と長さを変えた比較（2 MiBで、1,000〜5,000文字は0.41〜0.45秒、20,000文字は0.48〜0.54秒、100,000文字は0.87秒）で、5,000文字とした。

**未確認・未解決。**

- （解決済み。下記）ユーザーが操作していない（無人・バックグラウンド）状態で、1 MiBの文書を1.5秒間隔で書き換えると、変更反映が約6秒遅れる測定があった。遅れはJSの描画ではなく、書き換えから約5.2秒後にRustのファイル変更の通知がJSへ届くまでの間にある（IPCの `scan_directory_command` と `read_file_command` の発行時刻、メインスレッドの遅延の監視で確認した）。別のプロセスの活動（`Performance.getMetrics` の呼び出し、`fs.watch` の並走）があると再現しない。OSの電力制御が疑われるが未確認である。上の変更反映の値は、この遅れが出ない条件で測った。ユーザーが前面で操作している状態で測り直す（tasks.mdの「検討待ち」）。
- 前面での再測定（Phase 4の完了前）: アプリのウィンドウを前面に出し、ユーザーが操作できる状態で、同じ測定を10回行うと、約6秒の遅れは出なかった。変更反映は、素のMarkdownの1 MiBで強制レイアウトまで約1.0秒（debounceの150 msを含む）、コードと数式の1 MiBで1.4〜2.0秒だった。次のフレームまでは、アクセシビリティ木の更新が乗り、素のMarkdownで約1.8秒、コードと数式で1.5〜3.0秒である。約6秒の遅れは、無人・バックグラウンドの状態に固有で、OSの電力制御によるものと考えられる（未確認）。通常の使い方（前面で操作する）では起きない。
- 起動とメモリは、MSIXインストール済みの条件で、Phase 5で測る。
- 測定した端末は高性能である。遅い端末では、時間がおよそ比例して伸びる。目標は、この端末での実測に余裕を見た値である。

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
- 大文字小文字差、8.3形式の短い名前、コンポーネント境界の誤判定（`C:\root` と `C:\rootx`）をテストする。
- UTF-8、UTF-16、デコードエラー、サイズ上限をテストする。
- Watcherのdebounce、削除、rename、atomic replaceをテストする。
- custom image protocolのresource ID、Content-Type、上限、エラー応答をテストする。
- ファイルシステムとWatcherをtraitで注入し、単体テストから実ファイルとOSイベントを分離する。
- 同じ振る舞いの入力差分はテーブル駆動テストで表現する。

境界判定（7.1）だけはこの注入の対象外とし、実ファイルで確認する。検証しているのは `canonicalize` がファイルシステムの表記へ解決する挙動そのものであり、注入した実装で置き換えると確認したい対象が消えるためである。文字列だけで判定できる形式の検証はテーブル駆動の単体テストで固定し、実ファイルを使うのは短い名前・大文字小文字・junctionの解決に限る。junctionは特権も開発者モードも要さずに作成できるため、CIでもそのまま実行できる。

Watcherの写像・畳み込み・窓の時間規則（6.4）も注入の対象とし、時刻を呼び出し側から渡して実時間なしに検証する。一方でWatcherのライフサイクル（起動、親の監視、停止）は実ファイルと実OSイベントで確認する。確認したいのが `notify` のWindowsバックエンドの挙動そのものであり、注入した実装へ置き換えると対象が消えるためである。実イベントの到達は時間に依存するため、固定の待ち時間ではなく条件待ちのポーリングで書く。CIの `Rust` ジョブは `windows-latest` で走るため、Windows固有の前提（親の監視でルートの消失を拾う、イベント種別が `Any` に潰れる）をそのまま固定してよい。

#### Tauriに触れるコードのテスト

`tauri::test::mock_app` を使う。dev-dependencyで `tauri` の `test` featureを有効にする。対象は次の2つで、いずれも他の手段では到達できない。

- Tauri command本体（`ipc/commands.rs`）。`State<'_, AppState>` はruntimeに依存しない型であり、mock appの managed state からそのまま取れる。commandは `async fn` のため `tauri::async_runtime::block_on` で待つ。
- Tauri eventの送出（`watch_runtime.rs` の `TauriChangeSink`）。`mock_app` が返すのは `AppHandle<MockRuntime>` であり、製品が使う `AppHandle<Wry>` とは別の型になる。そのため `TauriChangeSink` はruntimeを型引数に取り、既定を `Wry` とする。

送出の内容は `app.listen` で受けて検証する。ただし、検証したい規則そのものはできる限りTauriの外へ出す。文言をUI言語で組み立てる規則（10.5）は `watcher_error_event` として自由関数に切り出し、Tauriなしで固定している。`TauriChangeSink` に残るのは送出の配線だけである。

**この featureを有効にすると、libが comctl32 v6 の関数（`TaskDialogIndirect`、`SetWindowSubclass` など）を参照する。** v6 を読み込むにはアプリケーションマニフェストの依存宣言が要るが、cargoが作るテストバイナリはマニフェストを持たない。宣言がないと既定の v5 が読まれ、テストは1件も走らないまま起動時に `STATUS_ENTRYPOINT_NOT_FOUND` で落ちる。`build.rs` からリンカへ `/MANIFESTDEPENDENCY` を渡して宣言する。

宣言を `RUSTFLAGS` や `.cargo/config.toml` へ置いてはならない。CIのカバレッジ計測は `cargo llvm-cov` で行い、これが `RUSTFLAGS` を設定する。`RUSTFLAGS` が設定されるとcargoは `.cargo/config.toml` の `rustflags` を無視するため、カバレッジ計測のときだけ宣言が消えてテストが起動しなくなる。テストターゲットだけを対象にする `rustc-link-arg-tests` はcargo 1.98.1が受け付けないため、全ターゲットへ効く `rustc-link-arg` を使う。製品バイナリのマニフェストは `tauri_build` が同じ依存を既に宣言しており、この宣言を足しても内容が変わらないことを実測で確認した。

### 14.3 セキュリティ回帰

悪意ある入力を模した固定のMarkdown一式をリポジトリへ置き、描画結果を検証する回帰テストを設ける。

- Raw HTML、`javascript:` リンク、`data:` 画像、`ms-` scheme
- `..` を含む相対パス、UNC、device path、絶対パス
- 巨大画像、巨大Mermaid、巨大な数式、多数の短い数式、深いネスト
- SVG内のscriptと外部参照
- KaTeXのマクロ展開を悪用した入力

### 14.4 パッケージと実機

- x64のReleaseビルドを検証する。
- MSIX manifest、Identity、Publisher、Version、Capabilitiesを静的検査する。
- 自己署名MSIXをインストールし、起動、関連付け、Package Identityを確認する。
- WACKをStore提出前に実行する。
- Storeへ提出するMSIXがCIで検証したartifactと一致することを確認する。
- x64実機でスモークテストする。
- [spec.md](./spec.md)の性能目標をインストール済みパッケージに対して測定する。

### 14.5 FrontendのDOMテスト構成と退避条件

Phase 2で `bun:test` によるReactコンポーネントのDOMテストが成立することを確認した。構成は次のとおり。

| 要素 | 採用 |
| --- | --- |
| test runner | `bun:test` |
| DOM実装 | `@happy-dom/global-registrator` |
| コンポーネント操作 | `@testing-library/react` |
| プリロード | `bunfig.toml` の `[test] preload` で `test/setup.ts` を読み込む |

例外として、Mermaid生成SVGのsanitize（8.4）のテストだけはjsdomの `window` をDOMPurifyへ渡して行う。happy-domではDOMPurifyが要素名を取得できず、実際の挙動を検証できないためである。グローバルのDOM実装はhappy-domのまま変えない。

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
| ARM64への対応 | 対応外とし、バイナリも配布しない。Phase 1で確認したx64ホストからのクロスコンパイルによるビルドも以後は行わない（2026-09-29に改めた。当初はクロスコンパイルで生成し、実機での検証はPhase 5の提出前に行う方針だった） | 3、13.2 |
| BunのみでMSIXビルドを完結できるか | Node.jsは不要 | 13.2 |
| `runFullTrust` だけを使用するMSIXでフォルダー選択、監視、関連付け起動が動作すること | いずれも動作する。関連付け起動の引数は `argv[1]` | 13.4 |
| MSIXでのアプリ設定保存先が期待どおりに解決されること | パッケージ領域へリダイレクトされ、アンインストールで併せて削除される | 11.1、13.4 |
| custom image protocolのURL形式 | `http://mdperuse-img.localhost/<resource-id>` | 5.4 |
| x64のMSIX生成、インストール、起動、WACK結果 | いずれも成立。WACKはOVERALL PASS | 13.1、13.3、13.4 |
| `bun:test` でのDOMテスト成立可否とVitestへの退避条件 | happy-domとTesting Libraryの組合せで成立。退避条件を明文化 | 4.8、14.5 |
| Tauri command/eventの型、version、request ID、cancel、error契約 | 型はRust側を正本に `ts-rs` で生成。version・request ID・cancelは導入せず、エラーは `IpcError` と `ErrorCode` で表す | 5.3 |
| custom image protocolのresource ID生成、無効化、キャッシュ方針 | ワークスペース単位のソルトと変更世代のHMAC。文書単位で発行し、ワークスペース切替で無効化 | 5.4 |
| CSPの最終値とTauri capabilityの最小集合 | `style-src` を elem と attr へ分け、`font-src` は `'none'`。capabilityは `core:event` の listen / unlisten と `opener:allow-open-url` の3つだけ（UI/UXでウィンドウタイトル用の `core:window:allow-set-title` を加えて4つ） | 5.5 |
| 永続化する状態と設定ファイルのスキーマ | `src-tauri/src/settings.rs` を正本とし、`schemaVersion` は1。読み書きはRust側が担い、Frontendへは絶対パスを含まない `UiSettings` を投影する | 11.1 |
| 最近使ったフォルダーと最後のワークスペース復元 | いずれも初期版へ含める。復元は最後のワークスペースだけを対象とし、タブは復元しない | 9.2、11.1 |
| ファイル削除、rename、atomic replace後のタブ状態と、置換時の再読込例外の可否 | タブは `loaded` / `stale` / `deleted` の3状態。renameは追跡してパスを追従させ、置換直後の読込失敗は同一イベントにつき1回だけ再読込を許す（案B） | 6.4、6.5 |
| ファイル監視のライフサイクル | ワークスペース単位の再帰監視と、loose tab 1件ごとのファイル単体監視の2系統。切り替え時は旧Watcherを停止してから状態を破棄する | 6.4 |
| 大規模ツリーでのイベント量の上限と監視範囲の縮退モードの要否 | 窓ごとのイベント数に上限（1024）を設けて縮退させる。監視範囲そのものを縮退させるモードは設けない | 6.4 |
| `DEBOUNCE_MS`、`MAX_WINDOW_MS`、`REPLACE_RETRY_DELAY_MS` の確定 | 実測のうえ150 / 600 / 100で据え置き | 6.4 |
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

未解決の項目はない。

### P1: 初期版仕様確定前

Phase 4の実装で解決した項目は次のとおり。未解決の項目はない。

| 項目 | 結論 | 参照 |
| --- | --- | --- |
| lowlightへ登録する言語allowlist | 初期案の28名で確定。単独の文法を持たない `tsx`、`jsx`、`toml`、`html` は別名として写像する | 8.3 |

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
