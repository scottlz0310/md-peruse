# md-peruse テスト対応表

[spec.md](./spec.md) の要件と、それを確かめるテストおよび実機での確認の対応を示す。[dev-flow.md](./dev-flow.md) Phase 4 の完了条件「spec.md の機能要件をテストで確認できる」の証跡であり、要件のうち確認の在りかがないものを見つけるための表でもある。

## 読み方

- **Rust**: `src-tauri/src/` 以下のテスト（`cargo test`）。ファイル名と関数名で示す。
- **Frontend**: `src/` 以下のテスト（`bun test`）。ファイル名と `describe` / `test` の名前で示す。`App` は `src/App.test.tsx` である。
- **実機**: `tauri dev`（パッケージ外）または Release ビルドの実機で確かめた記録。記録の場所を添える。パッケージ化した MSIX での確認は Phase 5 で行う（[tasks.md](../tasks.md)）。
- 「—」は、その種類の確認が無い、または要らないことを示す。
- 名前は要約である。変えたときは `grep` で追い、この表も同じ Pull Request で直す。

## 4.1 ワークスペースとナビゲーション

| 要件 | Rust | Frontend | 実機 |
| --- | --- | --- | --- |
| フォルダー選択 | `open_folder`（開いた結果と範囲、開けなかったものを記録しない、エラーの写像） | `App`「ワークスペースを開くと、設定の幅で2ペインを表示し…」 | tasks.md 4-2「Rust Core との最小の結線」 |
| フォルダー走査 | `scan`（ディレクトリを先に並べる、相対パス、範囲外の拒否）、`ipc::commands`（開いたワークスペースへの応答） | `App`「ワークスペースを開いたらルート直下を走査して表示する」「走査の失敗は…」、`file-tree.test.ts`（世代） | 同上 |
| ノイズ除外 | `scan`（除外名、属性、reparse point、解決できない名前、`hasChildren`） | — | — |
| ツリー表示 | — | `TreeView`（ARIA の階層と選択、クリックとダブルクリック）、`file-tree.test.ts` の `visibleNodes` | — |
| ツリーの表示対象 | `scan`（Markdown 以外を除く）、`file_kind` | — | — |
| キーボード操作 | — | `TreeView`（`test.each` で 上下・`Home`・`End` の移動と、左右・`Enter` の開閉） | — |
| パンくずリスト | — | `Breadcrumb`、`App`「パンくず（10.1.1）」、`TreeView`「フォーカスの要求（10.1.1）」、`file-tree.test.ts` の `pathChain` と `revealFocus` | — |
| ペイン幅調整 | — | `SidebarLayout`（キー、ドラッグ、範囲）、`sidebar-width.test.ts`、`App`「…変えた幅を保存する（10.2、11.1）」「開き直すと、閉じる前に変えた幅で表示する」 | — |
| タブ | — | `tab-set.test.ts`（プレビュー、固定、重複、上限）、`TabBar`、`App`「タブ（9.1）」 | — |
| 対象ファイル | `file_kind`、`state`（フォルダーと存在しないファイルは文書として開かない） | — | — |
| ワークスペースを閉じる | `open_folder`（閉じる待ちと通知、最後のワークスペースの記録）、`state`、`watch_runtime`（Watcher の停止） | `App`「ワークスペースを閉じる（6.1）」 | — |

## 4.2 Markdown プレビュー

| 要件 | Rust | Frontend | 実機 |
| --- | --- | --- | --- |
| Read-only | — | `sanitize-schema.test.ts`（`input` は常に操作不可）。編集可能な要素は出力しない構造で、専用のテストは無い | — |
| GFM | — | `render.test.tsx`（表、タスクリスト、取り消し線）、`sanitize-schema.test.ts`（許可する要素） | — |
| Mermaid | — | `mermaid.test.ts`（選択、設定、SVG の sanitize、同時数、打ち切り、構文エラー）、`MermaidDiagram.test.tsx` | tasks.md 4-2「Mermaid の図の描画」 |
| シンタックスハイライト | — | `highlight.test.ts`、`HighlightedCodeBlock.test.tsx`、`render.test.tsx`「コードハイライト（8.3）」 | — |
| 数式 | — | `math.test.ts`（数式のない文書では読み込まない）、`render.test.tsx`「数式（8.5）」、`pipeline.test.ts`「数式の処理上限」 | — |
| 見出しアンカー | — | `heading-id.test.ts`、`pipeline.test.ts`「見出しアンカー」、`MarkdownDocument`「同一文書内のアンカーは…」、`App`「見出しへの移動も履歴へ積み…」 | — |
| 相対リンク | — | `link-target.test.ts`（解決できる、拒否する）、`MarkdownDocument`「別の文書へのリンクは…」、`App`「本文中の相対リンクで別の文書を開く」「開けないリンクは…」 | — |
| 相対画像 | `image::reference`（解決、範囲外の拒否）、`image::format`、`image::resource`、`image::protocol`、`ipc::commands`（参照ごとの発行） | `render.test.tsx`「画像（5.4、7.3）」、`MarkdownDocument`、`App`「本文の画像は…」 | tasks.md 4-2「画像の表示」「画像 resource ID の世代管理」 |
| 文書内検索 | — | `DocumentFind`、`find-ranges.test.ts`、`find.test.ts`、`App`「文書内検索は本文だけを対象にし…」 | `forced-colors` は CDP のエミュレーションで確認。実 OS のハイコントラストは未確認（下の「確認できていない項目」） |
| ホットリロード | `watch`（畳み込み、窓の時間規則）、`watch_runtime`（実ファイルでの Watcher、atomic replace の追従） | `tab-changes.test.ts`、`tab-status.test.ts`、`App`「ファイル変更への追従（6.4、6.5、5.4）」 | tasks.md 4-2「`notify` のイベントを…写像する処理」（atomic replace の単発と 50 ms 間隔 20 回） |
| 入力上限 | `read`（10 MiB の境界）、`image::format`（バイト数とピクセル寸法）、`limits` | `mermaid.test.ts`（入力サイズ）、`highlight.test.ts`、`limits.test.ts`、`render.test.tsx`（数式の上限と予算） | — |
| 大きい・複雑な文書 | — | `limits.test.ts`「plainDocumentReason」（文字数、ブロックの長さ、項目数と境界）、`MarkdownDocument`「大きい・複雑な文書の書式なし表示（8.7）」「文書の切り替えでの部分木の作り直し」、`plain-chunks.test.ts`（本文の分け方）、`PlainDocument`（分けた境目をまたぐ文書内検索） | tasks.md 4-2「大きい・複雑な文書を、書式なしで表示する」「書式なしで表示する大きい文書が、アクセシビリティ木が有効な環境で応答しなくなる」、design-decisions.md 8.7、13.6 の測定表。選択とコピーの専用テストは無い |
| 部分的失敗の分離 | — | `MermaidDiagram`（描画できなければ定義を残して理由を示す）、`HighlightedCodeBlock`（文法の読込失敗）、`render.test.tsx`（発行できなかった画像、構文エラーの数式）、`math.test.ts`（KaTeX の読込失敗） | — |

## 4.3 表示とアプリケーション制御

| 分類 | Rust | Frontend | 実機 |
| --- | --- | --- | --- |
| ファイル | `menu`（実装済みのコマンドだけがメニューに載る）、`open_folder`、`menu_command` | `App`（ワークスペースの開閉） | 「アプリを終了する」は Tauri の標準処理で、専用のテストは無い |
| タブ | `webview_keys`（アクセラレータの経路）、`menu`（割り当ての一意性） | `TabBar`（端で反対側へ回る）、`App`「タブを閉じる（10.1）」 | — |
| 履歴 | — | `doc-history.test.ts`、`document-tab.test.ts`、`App`「戻る／進む（9.3）」 | — |
| 表示 | `menu_command`（Frontend へ転送するコマンド） | `font-scale.test.ts`、`App`「表示メニュー（10.1、10.3）」（サイドバー、再読み込み、文字サイズ） | — |
| テーマ | `theme`（設定への保存、ウィンドウへの適用、メニューのチェック）、`menu` | — | tasks.md 4-2「テーマ」（本文、コード、Mermaid が追従することを実測） |
| 言語 | `language`（状態、設定、メニューの組み直し、イベント）、`i18n` | `messages.test.ts`（日英のキー一致）、`App`「UI 言語の切り替え（10.5）」 | — |

## 4.4 起動と OS 連携

| 要件 | Rust | Frontend | 実機 |
| --- | --- | --- | --- |
| 単一インスタンス | `launch`（2つ目の起動を既存のインスタンスへ渡す、相対パスの解決） | `App`「起動後に2つ目の起動で届く指示は…」 | tasks.md 4-2「関連付け起動と単一インスタンス」（`tauri dev`）。MSIX 内は Phase 5 |
| ファイル関連付け | — | — | MSIX manifest の宣言。Phase 5 で実機確認 |
| 関連付け起動 | `launch`（関連付けの起動と判定、準備前の保留と順序） | `App`「起動時に渡されたファイル（9.2）」 | 同上 |
| 複数ファイルの同時オープン | `startup`（`files_to_open`）、`open_document`（失敗しても続ける） | 同上 | 同上（エクスプローラーの複数選択は Phase 5） |
| 関連付け起動とワークスペース | `open_document`（開き先の決定）、`state`（loose tab のスコープ） | `App`「ワークスペース外のファイルとドラッグ＆ドロップ（9.1、10.4）」 | tasks.md 4-2「ドラッグ＆ドロップ」 |
| 起動時復元 | `open_folder`（最後のワークスペースの復元と取りやめ）、`launch`（3秒の上限） | `App`「ワークスペースの復元と最近使ったフォルダー（9.2、11.1）」 | tasks.md 4-2「応答の遅いストレージ」（到達できない UNC パスで再現） |
| 最近使ったフォルダー | `recent`、`settings`（10件の上限）、`menu`（動的なサブメニュー）、`settings_store` | `RecentFolders`、`App`（一覧の置き換え、項目を選んで開く） | — |
| WebView2 欠落時 | `startup_failure`（日英の文言、公式の修復先、失敗の内容、案内を1回だけ示すこと） | — | tasks.md 4-2「WebView2 Runtimeの欠落と初期化の失敗」（環境変数で、Runtimeが見つからない場合と利用者データのフォルダーを使えない場合を再現し、案内のダイアログと閉じた後の終了を確認）。MSIXのPackage Identityの失敗は Phase 5 |
| ドラッグ＆ドロップ | `drag_drop`（受け入れ可否、フォルダーを先に開く）、`drop`（`plan_drop`）、`open_document`（絶対パスを載せない） | `App`「ドラッグのオーバーレイは、文書を表示している間も出る」 | tasks.md 4-2「ドラッグ＆ドロップ」（エクスプローラーからのドラッグ） |

## 5章 非機能要件

| 項目 | テスト | 実機・測定 |
| --- | --- | --- |
| 5.1 性能 | — | design-decisions.md 13.6（Release、パッケージ化しない）。起動時間とメモリは Phase 5（MSIX） |
| 5.2 リソース効率 | `watch_runtime`（Watcher の破棄で通知が止まる）、`settings_store`（debounce と終了時の flush） | 終了後のプロセスの残存は未確認（Phase 5） |
| 5.3 アクセシビリティ | `TreeView`（ARIA、キー）、`TabBar`、`SidebarLayout`（キーでの幅変更）、`Breadcrumb`、`DocumentFind`（`forced-colors`） | design-decisions.md 10.6（CDP で `forced-colors`）、tasks.md「Reduced Motion」。実 OS のハイコントラストは未確認 |
| 5.4 セキュリティ | 下の「セキュリティ回帰との突き合わせ」 | — |
| 5.5 プライバシーとテレメトリ | `telemetry`（5種、1回だけ、Store 署名のときだけ）、`telemetry::store_logger`、`App`「文書の表示結果の通知（11.4）」 | tasks.md 4-2「実送信」「署名種別の判定」（開発用署名の MSIX で確認） |
| 5.6 国際化 | `messages.test.ts`、`i18n`、`language`。言語ごとの表の不足は型検査（`tsc --noEmit`）で検出する | — |
| 5.7 ライセンス | `licenses.test.ts`、`AboutDialog.test.tsx`。一覧は CI の `Licenses` ジョブが依存関係から生成する | — |

## セキュリティ回帰との突き合わせ

[design-decisions.md](./design-decisions.md) 14.3 が挙げる悪意ある入力ごとに、テストの在りかを示す。

| 入力 | テスト |
| --- | --- |
| Raw HTML | `raw-html.test.ts`、`render.test.tsx`「Raw HTML はソース文字列として…」、`pipeline.test.ts`「危険な入力」、`sanitize-schema.test.ts`（`on*` と `style` の除去） |
| `javascript:` リンク、`data:` 画像、`ms-` scheme | `sanitize-schema.test.ts`（リンクのプロトコル、画像の `src`。`ms-settings:` を含む）、`link-target.test.ts`（拒否するリンク） |
| `..` を含む相対パス、UNC、device path、絶対パス | Rust: `path_guard`（形式の検証、境界、ハンドルでの最終確認）、`image::reference`（範囲外、UNC 表記）、`ipc::commands`（要求のパスをエラーに含めない）。Frontend: `link-target.test.ts`（スキーム相対 URL） |
| 巨大画像 | `image::format`（バイト数、ピクセル寸法）、`image::protocol` |
| 巨大な Mermaid | `mermaid.test.ts`（入力サイズの上限、打ち切り、同時数） |
| 巨大な数式、多数の短い数式 | `render.test.tsx`（1数式の上限、文書の予算）、`limits.test.ts`（個数で頭打ち） |
| 深いネスト | `limits.test.ts`（引用とリストの入れ子を数える、線形時間）。パース結果のネストの深さを直接ためすテストは無い |
| SVG 内の script と外部参照 | `mermaid.test.ts`（`script`、`foreignObject`、イベント属性、リンク先を落とす）、`image::protocol`（画像の応答ヘッダーの CSP） |
| KaTeX のマクロ展開 | `pipeline.test.ts`（`maxExpand`、無限再帰マクロ、`maxSize`、出力の膨張率） |

固定の悪意ある Markdown を一式のファイルとして置く形は採っておらず、入力は各テストが持つ。

## Phase 4 の完了条件との対応

[dev-flow.md](./dev-flow.md) 第6章の完了条件ごとに、確認の在りかを示す。

| 完了条件 | 確認 |
| --- | --- |
| spec.md の機能要件をテストで確認できる | この表（4.1〜4.4、5章）。確認できていない項目は、下に示す |
| ファイル更新がプレビューへ反映される | Rust: `watch_runtime`。Frontend: `tab-changes.test.ts`、`tab-status.test.ts`、`App`「ファイル変更への追従（6.4、6.5、5.4）」。実機: tasks.md 4-2「`notify` のイベントを…写像する処理」 |
| atomic replace による連続更新でプレビューが壊れない | Rust: `watch`（`coalesce_*`）、`watch_runtime`（`a_loose_watcher_follows_its_file_including_atomic_replace`）。Frontend: `tab-status.test.ts`（atomic replace の畳み込み結果で、開いているタブが `stale` になる）、`App`（変更のたびに読み直しても、遅れて届いた古い応答で上書きしない）。実機: 単発と、50 ms 間隔の20回連続（tasks.md 4-2）。MSIX での確認は Phase 5 |
| 陳腐化した走査応答が新しいツリーを上書きせず、別パスの同時走査が相互に無効化されない | `file-tree.test.ts`「走査の世代（5.3）」、`App`「切り替える前に要求した走査の応答は反映しない」 |
| 画像の更新と監視のバッファあふれの後に、古い画像がキャッシュから表示されない | Rust: `image::resource`（世代の前進、無効化）、`image::protocol`（書き換えた画像を旧いIDで配信しない）、`watch_runtime`（書き換えの通知、あふれ）。Frontend: `MarkdownDocument`「画像の書き換えを知らされたら…」、`App`「発行済みの画像が書き換わったら…」。実機: tasks.md 4-2「画像resource IDの世代管理」 |
| キーボードだけで主要操作を完了できる | 個別の操作は、`TreeView`（移動、開閉、選択）、`TabBar` と `App`（`Ctrl+Tab`、`Ctrl+W`）、`SidebarLayout`（幅）、`DocumentFind`（`Ctrl+F`、`F3`）、`App`（`Alt+←`、`Alt+→`）、Rust の `menu` と `webview_keys`（アクセラレータ）でテストしている。**通しの実機確認は未実施**（下に示す） |
| 不正な Markdown や Mermaid 入力でアプリが停止しない | Markdown: `malformed.test.tsx`（29種の壊れた入力）、`MarkdownDocument`「本文全体を描画できないときは、失敗を知らせ…」。Mermaid: `mermaid.test.ts`（構文エラー、読込の失敗、時間切れ）、`MermaidDiagram.test.tsx`。WebView2 の失敗: `startup_failure` |
| Raw HTML、危険な URL scheme、境界外画像が遮断され、セキュリティ回帰テストが通る | 「セキュリティ回帰との突き合わせ」 |
| `forced-colors` 有効時に Mermaid 図とコードブロックが判読できる | 実機の WebView2 を CDP で `forced-colors: active` にして確認（design-decisions.md 10.6）。実 OS のハイコントラストは未確認（下に示す） |
| spec.md の性能目標を満たす | 描画に関わる3指標（文書切り替え、変更反映、ツリー展開）は、Release の実機で満たす（design-decisions.md 13.6。判定は中央値）。起動とメモリは、MSIX が条件のため Phase 5 |

## 確認できていない項目

- **WebView2 の失敗ダイアログを出す経路そのもの（4.4）**: 案内の文言と、表示を注入した関数は単体テストで固定したが、実際のウィンドウ作成の失敗から `MessageBoxW` までの結線は、自動テストで再現できない（WebView2 を欠落させられない）。実機で環境変数により再現して確かめた記録（tasks.md）が担う。
- **実 OS のハイコントラスト**: `forced-colors` は CDP のエミュレーションで確認した。実際の OS 設定下の確認は、利用者の環境で行う（tasks.md「検討待ち」）。
- **キーボードだけでの通しの操作**: 個別の操作は上のとおりテストで固定しているが、フォルダーを開く、タブを移る、文書内を検索する、戻る／進む、ウィンドウを閉じる、までを、マウスを使わずに通して行う実機の確認は、まだ行っていない。
- **変更反映の、前面での再測定**: 1 MiB の文書を1.5秒間隔で書き換えると、変更反映が約6秒遅れる測定が、無人・バックグラウンドの状態であった（tasks.md「検討待ち」）。ユーザーが前面で操作している状態での再測定は、まだ行っていない。
- **選択・コピーの、書式なし表示での動作**: 専用のテストは無い。書式なしの表示は `pre` の隣り合うテキストノードであり、`textContent` が元の本文と一致することは `PlainDocument.test.tsx` で固定している。文書内検索が、分けた境目をまたぐ一致を取れることも同じテストで固定した。
- **MSIX での実機確認**: ファイル関連付け、単一インスタンス、複数ファイルの渡され方、ファイル変更への追従。Phase 5（tasks.md Phase 5）。
- **起動時間とメモリ**: Phase 5（MSIX）。
