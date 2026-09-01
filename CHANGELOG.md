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
- ファイル監視のライフサイクルを確定（[design-decisions.md](./docs/design-decisions.md) 6.4）。Watcherはワークスペースのルート以下を再帰監視するものと、loose tabが開いているファイル1件を監視するものの2系統とする。ワークスペース側は走査の完了を待たずに開始し、走査中の変更を取りこぼさない。切り替え時は旧Watcherを停止してから状態を破棄する。停止前に破棄すると、停止前に届いたイベントが新しいワークスペースの状態へ適用されうる
  - loose tabのファイル単体を監視するのは、関連付けで開いた文書だけが変更に追従しない状態を避けるためである。主用途では開いている文書が外部のツールに書き換えられることが常態であり、ワークスペース経由で開いたときと振る舞いが変わると、ユーザーは古い内容を見ていることに気づけない。暗黙のルート配下は再帰監視せず、相対画像の差し替えは検知しない
  - debounceの窓と、置換直後の再読込の回数・待ち時間を `src-tauri/src/watch.rs` へ追加。いずれも暫定値であり、Phase 4で実測して確定する。待ち時間がdebounceの窓より短いことはコンパイル時に固定した。窓より長いと、次のdebounceが確定してから前の再読込が走り、古い内容で新しい内容を上書きしうる
- 削除・rename・atomic replace後のタブ状態を確定（[design-decisions.md](./docs/design-decisions.md) 6.5）。タブは `loaded` / `stale` / `deleted` の3状態を持ち、遷移規則を `src/state/tab-status.ts` の `applyFileChange` へ置く
  - 変更を受けたタブはアクティブかどうかによらず `stale` になり、アクティブタブはそこから再読込して `loaded` へ戻す。再読込という副作用を状態から切り離すことで、再読込に失敗したタブが `stale` のまま留まる状態も同じ規則で表せる
  - `deleted` は終端状態とする。削除はdebounce窓で置換とrenameを除いてから確定するため、確定した時点でファイルは実際に失われている。同じパスへ後からファイルが作られてもタブは復帰させない
  - 置換直後の読込失敗は案Bを採り、同一イベントに対して1回だけ再読込を許す。「共有違反時に自動リトライしない」原則の限定的な例外として明文化した。連続書込みが常態である主用途では、置換直後の一時的な失敗をユーザーへ提示する価値が低い
- `FileChangeEvent` へ監視の発生元を表す不透明な `scopeId` を追加（[design-decisions.md](./docs/design-decisions.md) 6.4）。イベントの `path` はスコープのルートからの相対パスであり、それだけでは通知先を一意にできない。暗黙のルートが異なる2つのloose tab（`C:\A\README.md` と `C:\B\README.md`）はどちらも `README.md` になり、ワークスペース切替では停止前に送出された旧Watcherのイベントが新しいルートの同名ファイルへ適用されうる。Frontendは自分が保持するスコープと一致しないイベントを破棄する。スコープはワークスペースまたはloose tabの暗黙のルートを単位とし、画像resource IDのソルトと同じ粒度である
- 文書読込の世代を `src/state/tab-status.ts` へ追加（`beginLoad` / `applyLoadResult`。[design-decisions.md](./docs/design-decisions.md) 6.5）。再読込の待ち時間をdebounceの窓より短くしても保証されるのは開始順だけであり、非同期の読込は完了順が入れ替わる。先に開始した読込が後から完了して新しい表示を古い内容で上書きしないよう、開始時の世代が最新の応答だけを反映する。5.3の2層の世代は走査の応答が対象であり、文書の読込は含まない
- `FileChangeEvent` の変更内容を `FileChange` としてtagged unionへ切り出し、`FileRenamed`（旧パスを持つ）を追加。`FileChangeKind` は廃止した。renameを追跡してタブのパスとツリーの選択状態を追従させるためであり、旧パスを任意フィールドとして持たせると、renameでないのに旧パスが入った状態や、renameなのに欠けた状態を型として表現できてしまう（`ImageResource` と同じ理由）。debounce窓内で `Modify(Name(From))` と `Modify(Name(To))` を対にできた場合だけ通知し、対にできない場合は削除と作成として扱う
- 永続化するアプリ設定のスキーマを `src-tauri/src/settings.rs` へ追加。`schemaVersion` は1とし、読み書きはRust側が担う。Frontendに設定ファイルを触らせないことで `fs` 系のcapabilityを増やさずに済ませ、一時ファイルへ書いてrenameする書込みと破損時の退避をOSのAPIで素直に書けるようにする（[design-decisions.md](./docs/design-decisions.md) 11.1）
  - 保存対象はテーマ、サイドバー幅、サイドバー表示状態、文字サイズ、ウィンドウ位置とサイズ、最近使ったフォルダー、最後のワークスペース。開いているタブ・選択中ファイル・スクロール位置は保存しない
  - 「最近使ったフォルダー」と「最後のワークスペースの復元」を初期版へ含めることを確定。復元は最後のワークスペースだけを対象とし、タブは復元しない。復元先が存在しないかアクセスできない場合はwelcome状態で起動し、一覧からも取り除く（[design-decisions.md](./docs/design-decisions.md) 9.2）
  - `Settings` をそのままFrontendへ渡さず `UiSettings` を投影する。最近使ったフォルダーと最後のワークスペースはワークスペースルート自身であり相対パスへ落とせないため、そのまま渡すと7.1の「ネイティブ絶対パスをFrontendのURLまたはDOMへ露出しない」に例外ができる。最近使ったフォルダーは不透明なIDと表示ラベル（`RecentFolderView`）で渡し、絶対パスはRust側に留める。IDはプロセス内でのみ有効な値として設定ファイルへ保存せず、Frontendから受け取ったIDはRust側で再検証する
  - 表示ラベルは絶対パスの末尾2コンポーネントに限る（`recent_folder_label`）。フォルダー名だけでは同名フォルダーを区別できないためである。一覧は新しいものが先頭で最大10件とし、同じフォルダーを開き直したときは既存の項目を先頭へ移す（`push_recent_folder`）
  - 設定のテーマは `ThemePreference`（`system` / `light` / `dark`）とし、OSから得た実際の配色を表すIPCの `Theme`（2値）と型を分ける
  - 未知のキーを読み捨てて欠落キーを既定値で埋めることと、JSONのキーがcamelCaseであることをテストで固定した。`schemaVersion` が現在より大きいファイルは既定値で起動して退避する。未知のキーを落としたまま起動すると、次の書込みで新しい版の設定を破壊するためである
- 未知の「最近使ったフォルダー」IDを拒否する `ErrorCode::RecentFolderNotFound` を追加。一覧を取り直せば解消するため、フォルダーそのものが失われた `WorkspaceNotFound` と分ける
- CSPとTauri capabilityの最終値を確定（[design-decisions.md](./docs/design-decisions.md) 5.5）。`style-src` を `style-src-elem 'self' 'unsafe-inline'` と `style-src-attr 'none'` へ分け、Mermaidが生成SVGへ埋め込む `style` 要素は通しつつインラインの `style` 属性を全面的に禁止する。sanitize schemaが `style` 属性を許可していないことと一致させ、DOMPurifyの設定漏れをCSPが二重に受け止める。`img-src` へ実測した画像protocolのオリジンを追加し、`font-src` はKaTeXのMathML出力とシステムフォント指定により `'none'` とした。あわせて、MathML出力へ切り替える前の記述として残っていた5.4「KaTeXのフォントを含む静的アセットを提供する」と11.3「KaTeXの同梱フォントのライセンス表記」を、フォントを同梱しない方針へ揃えた
- capabilityを `core:event:allow-listen` / `core:event:allow-unlisten` / `opener:allow-open-url`（`http://*`、`https://*` へ限定）の3つへ絞り込み。`core:window:default`・`core:webview:default`・`core:app:default` は現時点で呼ぶ予定がなく、`core:webview:default` には `allow-internal-toggle-devtools` が含まれるため付与しない
- Mermaid・コードブロック・KaTeX・画像の処理上限を追加。Frontendが行う処理の上限は `src/markdown/limits.ts`、Rustが検証する上限は `src-tauri/src/limits.rs` を正本とする。いずれも実測に基づく（[design-decisions.md](./docs/design-decisions.md) 7.3、8.3、8.4、8.5）
  - コードブロックのハイライトは1ブロック64 KiB、1文書の合計256 KiB。超過分はハイライトせずプレーンな `pre/code` として表示する。lowlightは488 KiBで198 ms・18万hastノードを生み、ブロック単位の制限だけでは1 MiBの文書が「500 ms以内」の目標を超えるため二段で抑える
  - Mermaidは1図50 KiB・エッジ500・タイムアウト3秒・同時2図・1文書50図。`maxEdges` はMermaidの既定値と同じだが既定に依存せず明示する
  - KaTeXは `maxExpand` 1000、`maxSize` 50 em に加え、入力サイズを1数式16 KiB・1文書の合計64 KiB。KaTeXの出力は入力の約11倍へ膨張し、977 KiBの単一数式は468 ms・出力10.7 MiBとなるため、Markdownの10 MiB上限では性能目標を守れない。`maxSize` は出力サイズではなくユーザー指定寸法の上限であり、`\raisebox` の `voffset` には効かないことをテストで固定した
  - 文書の予算は入力サイズではなくコスト（入力サイズと最小コスト32 Bの大きいほう）で数える。入力サイズだけで積むと、`$x$` のような短い数式が固定の処理費用ごと上限を迂回し、65536個・39万要素に達する
  - 上限の判定は `shouldHighlight` と `shouldRenderMath`、コストの算出は `highlightCost` と `mathRenderCost` を正本とし、境界を `src/markdown/limits.test.ts` で固定した
  - 画像は1辺16384 px、かつ総24 Mpx。RGBA8で96 MB、同時読込2件で192 MBとなり、全プロセス合計300 MBのメモリ目標の内側に収まる
- YAML front matterの扱いを追加。`remark-frontmatter` で文書先頭のYAMLブロックを解析し、本文からは除く。解析しないと `---` が水平線、続く行がsetext見出しとして描画され、見出しIDまで付く（実測）。対象はYAMLに限り、TOML（`+++`）・文書途中のブロック・閉じられていないブロック・前に空行があるブロックは本文として残す（[design-decisions.md](./docs/design-decisions.md) 8.1）
- `remark-frontmatter` の推移依存 `format@0.2.2` が条文を同梱しないため、`licenses/overrides/format/LICENSE` へ上流の著作権表示を伴うMIT条文を配置（[design-decisions.md](./docs/design-decisions.md) 11.3）
- 見出しアンカーのID生成規則を `src/markdown/heading-id.ts` へ追加。`rehypeHeadingIds` が木を2度走査し、1度目で既存のID（脚注の `user-content-fn-1` など）をそのまま使用済みとして集めてから、2度目で見出しへ `user-content-` 前置のIDを付ける。既存のIDはslug化せず候補IDと完全一致で比べる。一部をslug化して比べると、`[^a.b]`（実IDは `user-content-fn-a.b`）が実在しない `fn-ab` を占有して `# fn-ab` をずらすなど、リンクから到達できない見出しが生じる。`rehype-slug` は既存のIDを重複回避の対象へ含めないため使わない。同プラグインでは `# fn-1` と `[^1]` が同じ文書にあると `user-content-fn-1` が2つ生成され、脚注参照が見出しへ移動してしまう。`rehype-katex` より前に置く。後ろに置くとKaTeXが生成するMathMLのテキストと `annotation` のLaTeXを二重に拾い、`# 数式 $x^2$ を含む` のIDが `数式-x2x2-を含む` となる（実測）。脚注の相互参照リンクは前置済みのIDと対応するため、`data-footnote-ref` と `data-footnote-backref` で経路を分ける（[design-decisions.md](./docs/design-decisions.md) 7.2、8.2）
- 相対リンクの解決規則を `src/markdown/link-target.ts` へ追加。sanitizeを通過する `href` を実測で列挙し、同一文書内アンカー・ワークスペース内Markdown・外部URL・拒否のいずれかへ解決する。ルート絶対リンクはワークスペースルート基準とし、ルート外・非Markdown・スキーム相対URL・`%5C` によるUNC表記・代替データストリーム表記は遷移せず理由を示す（[design-decisions.md](./docs/design-decisions.md) 7.2）
- Store向けカスタムイベント（[#21](https://github.com/scottlz0310/md-peruse/issues/21)）の実施計画を `tasks.md` と [dev-flow.md](./docs/dev-flow.md) へ追加。Phase 3-5（送信経路の実測と要件確定）、Phase 4（発火点の実装と「起動中に2つ目の `.md` を関連付けから開く」経路のE2E回帰）、Phase 5（データ収集申告、Partner Centerでの確認、計測母集団の制約の明記）の4段階に分ける。送信単位はシングルインスタンス＋タブ起動を前提としてセッション単位へ統一する
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

- サードパーティライセンス一覧をリポジトリへコミットせず、`bun.lock` と `Cargo.lock` から都度生成する方式へ変更（[design-decisions.md](./docs/design-decisions.md) 11.3）。従来は生成物をコミットし `git diff --exit-code` で最新かを検査していたが、Renovateは依存を更新してもlockfileしか書き換えないため、依存更新のPull Requestが例外なく `Licenses` ジョブで失敗していた（[#32](https://github.com/scottlz0310/md-peruse/pull/32) で顕在化）。バージョンの正本をlockfileの1か所へ寄せ、不整合が構造として生じないようにする。`Licenses` ジョブは生成の実行のみを検査し、条文を取得できないパッケージがあれば失敗する
- Phase 3-1・3-2の確定内容が他セクションへ反映されていなかった箇所を、[design-decisions.md](./docs/design-decisions.md) 内で整合させた。確定した判断と、まだ仮置きの記述が混在したまま次のフェーズへ進まないようにするための見直しである
  - 6.2「ツリーの表示対象は未決とする」を、6.3で確定済みの内容（フォルダーと `.md`・`.markdown` に限る）へ揃えた。`spec.md` 側は先に確定形へ更新されており、`design-decisions.md` だけが古いままだった
  - 5.3のエラー区分の表に「ピクセル寸法超過」が抜けていたため、12章の記述と揃えた。`ErrorCode` には `imagePixelLimitExceeded` が定義済みで、表記だけが漏れていた
  - 12章のエラー方針と5.3の表へ、Mermaidの図と数式が処理上限を超えて描画されなかったことを加えた（8.4、8.5）。コードブロックのハイライト上限の超過は、8.3の定めによりプレーンな `pre/code` として表示され本文が失われないため、理由を示す対象としないことを明記した
  - 5.4のresource IDの発行単位に、loose tabでは所在フォルダーを暗黙のルートとする旨を追記した。9.1からは参照していたが、5.4だけを読むと伝わらない状態だった
  - 9.1のdirty状態に、外部変更による再読込が必要な状態を指し、Read-onlyのため編集による未保存状態は存在しないことを明記した
  - 10.2と10.3へ、確定した幅と文字サイズをDOMへ反映する手段がCSPの `style-src-attr 'none'` に従うことを追記した
  - 14.1のテスト方針から「schemaの拡張差分」という表現を除き（8.2で全列挙へ変更済み）、見出しID・front matter・処理上限のテスト項目を加えた。14.3のセキュリティ回帰へ巨大な数式と多数の短い数式を加えた
  - 9.2が「複数ファイル引数」を未決としている一方、15章のP1・`dev-flow.md` の割り当て表・`tasks.md` のPhase 3-3タスクがいずれもこの項目を落としていたため、3か所へ追加した
- `tasks.md` へ「検討待ち」を追加し、作業中に見つかったスコープ外の事項をその場で直さず積む運用を運用ルールへ明記。フェーズを割り当てられる状態になってから該当フェーズのタスクへ移す。最初の項目として、脚注セクションの隠し見出し（`<h2 class="sr-only">`）の `class` がsanitize schemaで落ちる件を登録した
- ルート外Markdownリンクとloose tabの扱いを確定。loose tabは関連付け起動でワークスペース外のファイルを開いたときにだけ生じ、所在フォルダーを暗黙のルートとして配下の相対リンクと相対画像を解決する。文書内のリンクからワークスペースの外へは出ない（[design-decisions.md](./docs/design-decisions.md) 7.2、9.1、9.2）
- リンク中のパーセントエンコードの扱いを「1回復号し多重エンコードを拒否」から「パスを `/` で分けたセグメントごとに1回復号」へ改訂。remarkは有効なエスケープだけを温存して他の `%` を `%25` へ変換するため、復号後に `%` が残ることを多重エンコードの証拠として使えない。セグメント単位であれば `..%2F..%2Fetc.md` は1つの名前にとどまり、トラバーサルが成立しない（実測。[design-decisions.md](./docs/design-decisions.md) 7.2）
- 非Markdownファイルをツリーへ表示しないことを確定（[design-decisions.md](./docs/design-decisions.md) 6.3）。あわせて `tasks.md` の運用ルールへ、フェーズ最後のPull Requestで進捗サマリと完了条件も更新する旨を追加した
- Phase 3を4単位（IPC、描画とナビゲーション、状態管理、UIとUX）へ詳細化し、着手順と成果物の形式を [dev-flow.md](./docs/dev-flow.md) 第5章に定義。P1未決事項の解決先を単位まで細分した
- Bunのバージョン固定を `package.json` の `packageManager` から `.bun-version` へ移行。Renovateの `bun-version` マネージャは `.bun-version` を対象とし、`packageManager` からはBun本体を更新できないため（[design-decisions.md](./docs/design-decisions.md) 4.4）
- Bun本体（`bun-version`）を `Bun runtime` グループへ切り出し、自動マージを無効化。MSIX生成とWACKがrequired status checkに含まれず、自動マージのゲートで破壊を検出できないため手動でマージする
- Renovateの自動マージを再開。required status checkが揃ったため、`presets/options/automerge` を `extends` へ戻し、`renovate.json` のautomerge打ち消しを削除した。レビューの必須範囲（人が作成する変更とRenovateの定型更新の区別）を [design-decisions.md](./docs/design-decisions.md) 4.12 に定義した
- アプリアイコンをTauriテンプレートの既定からmd-peruse独自のデザインへ差し替え。正方形アイコンの原本は `assets/app-icon.png`（1024x1024）、横長タイルの原本は `assets/wide-logo.png`（3100x1500）とし、各サイズは生成する
- MSIXのタイルへ `Wide310x150Logo` と `Square310x310Logo` を追加し、`BackgroundColor` をアイコンの実測色へ変更。横長タイルはパッケージ工程で原本から直接生成する
- MSIX環境での動作をスパイクで実測し、設計判断を確定（[design-decisions.md](./docs/design-decisions.md) 5.4、5.5、6.4、11.1、13.4）

[Unreleased]: https://github.com/scottlz0310/md-peruse/commits/main
