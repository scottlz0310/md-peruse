# Microsoft Store 提出の手順書

`md-peruse` を Microsoft Store へ提出するための手順書である。初回は手動で提出し、審査に通ったあとは GitHub Release に連動した提出へ移る（方針の根拠は [design-decisions.md](./design-decisions.md) 13.7）。Store の画面名や項目は変わりうるため、画面上の最新の表示を優先する。

先行する2つのリポジトリの提出経験（[PhotoGeoExplorer](https://github.com/scottlz0310/PhotoGeoExplorer)、[cloud-migrator](https://github.com/scottlz0310/cloud-migrator)）に学んだ点は、該当する節に書く。

## 1. 方針

| 項目 | 方針 |
| --- | --- |
| 対象アーキテクチャ | x64 のみ。ARM64 は対応外（[design-decisions.md](./design-decisions.md) 3章） |
| 初回の提出 | 準備とレビュー完了後、GitHub Releaseの公開より先に手動提出する。Partner Center の画面で、あなたが入力し、あなたが提出する |
| 初回の公開 | 審査に通っても、自動では公開しない（手動公開）。公開の操作は、初回の提出物と掲載内容を確認してから行う |
| 2回目以降 | GitHub Release に連動して提出する。提出の前に、手動承認のゲートを置く（9章） |
| 掲載素材（画像、説明文） | ローカルで用意する（イラストの生成を含む）。リポジトリへは、確定した素材と一覧だけを置く（6章） |
| Partner Center の登録内容との照合 | ローカルで行う（2章の項目） |
| 実機での確認（MSIX） | ローカルで行う（8章） |

## 2. 提出前の停止条件

次がすべて揃うまで、Partner Center の提出画面で保存・提出を進めない。

- [ ] Partner Center の `md-peruse` の予約と、`packaging/Package.appxmanifest.template` の Identity が一致している（Name `scottlz0310.md-peruse`、Publisher `CN=39FB3D39-1F1A-4B82-B081-47469FD12CA6`、PublisherDisplayName `scottlz0310`。Store ID `9P35BW61FN4W`。[design-decisions.md](./design-decisions.md) 13.1）
- [ ] 提出する MSIX は、タグ実行の `Package` ワークフローが生成した artifact であり、同じ実行で WACK が `PASS`（全項目）になっている（3章）
- [ ] MSIX の SHA-256 を記録している（3章）
- [ ] プライバシーポリシーの URL（GitHub Pages）が、HTTPS で HTTP 200 を返す（5章。Pages の設定と、最初の公開が済んでいる）
- [ ] 掲載情報（説明、スクリーンショット、年齢区分、言語）が揃っている（6章）
- [ ] 審査ノート（Notes for certification）と、制限付き Capability（`runFullTrust`）の用途の説明（Restricted capabilities）を用意している（7章）
- [ ] 市場、価格（無料）、公開の方法（手動公開）を、あなたが確認した

## 3. 提出物の同一性

「Store へ出す提出物」と「CI で検証した成果物」を同じものにするため、提出物は、**リリースのタグ（`vMAJOR.MINOR.PATCH`）を push したときの `Package` ワークフローの artifact**（`md-peruse-msix-x64`）とする。手元でビルドし直した MSIX は提出しない。MSIX はビルドごとにバイト列が変わるため、ビルドし直すと、WACK を通したものと別の成果物になる。

1. タグを push する。`Package` ワークフローが動き、MSIX の生成、署名（開発用の自己署名）、WACK、`.msixupload` の作成、SHA-256 の記録、artifact の保存まで行う。
2. 実行の結果を確認する。`WACK OVERALL_RESULT: PASS` で、全工程が成功している。
3. artifact `md-peruse-msix-x64` をダウンロードし、`SHA256SUMS.txt` と、ダウンロードした `.msix` と `.msixupload` の SHA-256 が、それぞれ一致することを確認する。
4. `.msixupload` を、Partner Center へアップロードする。
5. 11章の記録表へ、実行の URL、コミットの SHA、`.msix` と `.msixupload` の SHA-256 を書く。

開発用の自己署名は、Store の配布には使われない。Partner Center が、提出された MSIX を Store の証明書で署名し直す。このため、署名の違いは、成果物の同一性を損なわない。

アップロードの形式は、`.msixupload` を使う。Microsoft の案内（[Upload MSIX app packages](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/upload-app-packages)）は、Windows 10 以降の提出では、`.msix` より `.msixupload`（または `.appxupload`）のアップロードを推奨している。`.msixupload` は、MSIX とシンボルファイルを同梱する ZIP で、シンボル（PDB）は、Partner Center のクラッシュ分析が、アドレスを読めるスタックトレースへ直すために使う。`.msix` だけを出すと、シンボルが失われる。

`winapp` が出力する `.msix` には、Visual Studio のような `.msixupload` の作成機能がない。そこで、`scripts/pack-msixupload.ps1` が、**WACK を通した `.msix` に手を加えず（再ビルドも再署名もしない）、外側を ZIP で包む**。`Package` ワークフローは、WACK の後にこれを実行する（Issue #144）。

```text
md-peruse_<version>_x64.msixupload（実体は ZIP）
├── md-peruse_<version>_x64.msix    ← winapp の出力そのもの（WACK を通したもの）
└── md-peruse_<version>_x64.appxsym ← リリースビルドの md_peruse.pdb を1つ含む ZIP
```

- 内側の `.msix` の SHA-256 が、元のファイルと一致することを、スクリプトが検査し、食い違えば失敗する。外側の `.msixupload` は別の SHA-256 になる。記録表には、両方を書く。
- PDB は、`strip = true` のリリースビルドでも出る（CI で確認。`src-tauri/target/x86_64-pc-windows-msvc/release/md_peruse.pdb`、約2.8 MB）。ただし、小さいため、公開シンボルだけで、行番号などの詳細を含まない可能性がある（確認していない）。スタックトレースに関数名が出ることは、初回の公開後に Partner Center で確認する。詳細が要るなら、`Cargo.toml` の `strip` の設定を見直す（バイナリの大きさへの影響も測る）。
- シンボルファイルの拡張子は `.appxsym` にした。Microsoft の資料は `.appxsym` を説明しており、MSIX 向けに `.msixsym` とする記述もある。スクリプトの `-SymbolExtension` で変えられる。
- Partner Center が、この手作りの `.msixupload`（ZIP の構成、シンボルの名前）を受け付けるかは、初回のアップロードまで確認できない。受け付けられない、または警告が出るときは、`.msix` だけを提出する（artifact には、`.msix` も入っている）。シンボルが認識されたかの確認は、Package details の表示と、初回の公開後のクラッシュ分析で行う。

## 4. バージョンとタグ

- 製品のバージョンの正本は `package.json` である。`bun run check:versions` が、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock` との一致と、タグ実行ではタグの版との一致を検査する。
- MSIX の Package Version は、`MAJOR.MINOR.PATCH.0` である。第4要素は Store の予約により常に 0 とする。
- 提出済みのバージョンより大きい版でなければ、次の提出はできない。差戻しの再提出でも、同じバージョンのままでは出せない（10章）。

## 5. プライバシーポリシーの提示先

本文の正本は [privacy-policy.md](./privacy-policy.md) である。公開は GitHub Pages で行い、Partner Center の「プライバシーポリシーの URL」には、次を入れる。

```text
https://scottlz0310.github.io/md-peruse/privacy-policy.html
```

ルートの `https://scottlz0310.github.io/md-peruse/` も、同じページへ転送する。

**公開の仕組み。** `scripts/build-pages.ts` が、`docs/privacy-policy.md` から HTML を生成し（`bun run build:pages`。出力は `site/`。コミットしない）、`.github/workflows/pages.yml` が、`main` の更新で公開する（`docs/privacy-policy.md` などの変更のときに動く。手動起動もできる）。本文の正本は Markdown の1か所だけで、HTML に別の本文を持たない。日英の2言語を1ページに並べ、英語の節は `lang="en"` で囲む。

**初回の設定（リポジトリの管理者が行う）。** リポジトリの Settings > Pages で、Source を **GitHub Actions** にする。これを設定していないと、`Pages` ワークフローの公開の job が失敗する。設定後に、`Pages` ワークフローを手動起動して、最初の公開を行う。

入力する前に、ブラウザーで開いて表示を確認し、応答を確かめる。

```powershell
$uri = "https://scottlz0310.github.io/md-peruse/privacy-policy.html"
$response = Invoke-WebRequest -Uri $uri
if ($response.StatusCode -ne 200) { throw "HTTP $($response.StatusCode)" }
```

先行する PhotoGeoExplorer は Cloudflare Pages、cloud-migrator は GitHub Pages で公開している。`md-peruse` は、認証情報などの設定を増やさずに済む GitHub Pages にした。ポリシーを変えるとき（送るイベントや保存する情報が変わるとき）は、`docs/privacy-policy.md` を直して、`main` へ入れる。公開は自動で更新される。

Partner Center のデータ収集の申告は、「データを収集しない」とは申告しない。Store 版は、イベント名だけの5種類のカスタムイベントを送る（[privacy-policy.md](./privacy-policy.md)）。

## 6. 掲載情報

表示例は [サンプル一覧](../examples/README.md)、MSIXの確認済み項目と測定条件は [実機確認記録](./msix-device-verification.md) を参照する。掲載素材は確定前にローカルでレビューする。

掲載素材は、ローカルで用意する。リポジトリへ置くのは、確定した素材と、一覧（CSV）である。

| 項目 | 内容 |
| --- | --- |
| 言語 | 日本語（`ja-jp`）と英語（`en-us`）。マニフェストの `Resource` と合わせる |
| 説明文、機能の一覧、検索語（最大7個） | 実装と一致させる。機能の一覧には、手動の箇条書きの記号を付けない（Store が箇条書きで表示する） |
| スクリーンショット | 1枚以上、3〜4枚を推奨。1920x1080 を推奨（PhotoGeoExplorer は 1186x793、cloud-migrator は 1920x1080 で通過） |
| Store のロゴ | 300x300（原本から縮小する。`assets/app-icon.png` が原本） |
| 年齢区分、カテゴリ | Partner Center の質問票に答える |
| サポートの連絡先 | `https://github.com/scottlz0310/md-peruse/issues` |
| ウェブサイト | リポジトリの URL |

一覧（CSV）の取り扱い（先行する2つのリポジトリの経験）:

- 最初に、Partner Center から、現在の掲載情報をエクスポートし、その形式（`Field`、`ID`、`Type`）を正とする。リポジトリの CSV を、確認なしにインポートで上書きしない。
- UTF-8（BOM あり）と CRLF で保存する。LF だと、行が連結されて無効になる。Excel で開いたまま保存し直さない。
- 画像を含むときは、フォルダー単位でインポートする。CSV 単体では、画像の参照が失敗する（PhotoGeoExplorer の `docs/MicrosoftStore.md`「listingData.csv インポート手順」）。
- インポートするフォルダーは、直下に `listingData.csv` と画像だけを**フラットに**置く。CSV 内の画像の参照は、**選ぶフォルダーの名前**を先頭にした相対パス（例: フォルダー名が `store` なら `store/screenshot1.png`）にする。画像用の入れ子のフォルダーは作らない（cloud-migrator の `docs/assets/store-source/README.md`「CSV の扱い」手順3。`docs/assets/store` を選び、直下に CSV と4画像だけを置き、パスは `store/...` で始める）。
- 提出に使わない原本や下書きは、インポートするフォルダーの外に置く（cloud-migrator は `store-source/` に分けている）。
- Partner Center がエクスポートした CSV にある、一時的な絶対 URL や、申請の識別子は、リポジトリへコピーしない。

素材は、`docs/assets/store/`（Partner Center へそのまま渡せるフォルダー）へ置く。確定するまでは、リポジトリへ入れない。

現在の配置（フォルダー名が `store` なので、CSV の画像の参照は `store/screenshot1.png` 等）:

```text
docs/assets/store/
├── listingData.csv
├── screenshot1.png
├── screenshot2.png
├── screenshot3.png
└── screenshot4.png
```

2026-10-03の初回提出までは、画像を `docs/assets/store/store/` の下に置いていた。これは上のフラットな構成とは違い、`docs/assets/store/` を選んでも、CSV の `store/screenshot1.png` が指す画像（選んだフォルダー直下）に当たらない。先例の構成に合わせて、画像をフォルダー直下へ移した。この構成での手動インポートは、まだ実機で確かめていない（次に下書きの申請ができるときに確かめる）。

[`listingData.csv`](./assets/store/listingData.csv) は、2026-10-03にパッケージのアップロード後のPartner Centerから取得したエクスポートの形式（`Field`、`ID`、`Type`、`default`、`ja-jp`、`en-us` の6列、454行）に合わせたもの。`ja-jp` へ日本語、`en-us` へ英語を記入し、`default` は空である（エクスポートと同じ構造）。画像は実際のMSIXで撮影した1920×1032 PNGを4枚収録し、画像参照は両言語とも `store/screenshot1.png` 等である（英語の掲載にも日本語UIの画像を使っている）。CSVのUTF-8 BOM・CRLFは、専用の `.gitattributes` と `.editorconfig` の設定で保持する。

初回提出（v0.1.0）の入力で分かったこと（2026-10-03）:

- パッケージを追加する前のエクスポート（`default` 列だけ）を基にしたCSVは、パッケージを追加して言語（`ja-jp`、`en-us`）が現れた後は、インポートに失敗した。パッケージを追加した後に、必ずエクスポートし直して、その形式に合わせる。
- 画像参照を含むCSVは、「.csv のアップロード」（CSV 単体）でも、フォルダー用のファイル入力へ個別にファイルを渡す自動操作でも、インポートに失敗した（`ja-jp` の保存途中で止まった）。CSV 単体の失敗は、先例（PhotoGeoExplorer）の記録と一致する。自動操作の失敗は、フォルダーの構造が渡らないためと推測しているが、確かめていない。あなたが手でフォルダーを選ぶインポートは、未検証である。
- 初回は、画像参照を空にしたCSVを「.csv のアップロード」で取り込み（エラーなしで完了）、画像は掲載ページの入力欄へ1枚ずつ、字幕は画像ごとの「イメージの字幕の追加」から入力した。複数の画像を一度に渡すと、先頭の1枚だけが登録された。
- 任意のStoreロゴ（9:16のポスターアート、1:1のボックスアート）は登録していない。認定を通った後のStore上の表示で、見え方を確認する。

次回以降の掲載情報の更新は、公開済みの内容をエクスポートし直して、このCSVとの差を確かめてから行う。

公開後の保守:

1. 公開された掲載情報をPartner Centerから手動でエクスポートする。
2. 公開済みの内容を正として、リポジトリのCSVを差し替える。`Field`・`ID`・`Type` と言語列はエクスポートに合わせる。一時URLや申請固有の情報を確認し、画像はローカルに揃えて参照を相対パスへ戻す。
3. 以後は必要な変更だけをCSV・画像へ反映し、PRで管理する。エクスポートの取得は自動化しない。
4. 将来の自動提出では、このCSVと画像を掲載情報の正本とし、採用するAPI／CLIに合わせて変換する。現在のCSVだけで自動提出が実装済みとは扱わない。

## 7. 審査ノートと、制限付き Capability の申請

`runFullTrust` は制限付き（restricted）の Capability である。Partner Center には、次の2つの別の入力欄があり、**両方を入力する**。

| 入力欄 | 場所 | 役割 |
| --- | --- | --- |
| Notes for certification（画面名は「認定の注意書き」） | 左メニュー「追加のテスト情報」（`suppinfo/additionaltestinginfo`）の「説明」。申請ではなくアプリ単位で、「Save description」で保存する | 審査員が、アプリを正しく試すための情報（7.1） |
| Restricted capabilities | 申請オプション。パッケージのアップロード前は欄がない（2026-10-03に確認）。現れる場所と文言は、初回のアップロード後に確認する | 制限付き Capability ごとの、用途と必要性の説明。**審査員が承認するかを判断する**（7.2） |

Restricted capabilities の欄は、パッケージが制限付き Capability を宣言していることを Partner Center が検出したときに現れる。ここへの記入が漏れる、または説明が足りないと、Capability が承認されず、認定に失敗する（[Microsoft Learn](https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/manage-submission-options)）。承認の確認の分だけ、認定に時間がかかることがある。一度承認されれば、更新の提出では、通常は繰り返さない（Capability を足したときを除く）。承認されなければ、Capability を宣言しないパッケージで出し直すか、指摘を直して、新しい申請で承認を求める。

### 7.1 審査ノート（Notes for certification）

Capability の名前だけでなく、実際の用途と、ユーザーの操作との関係を書く。次は英語のたたき台である。提出の前に、実際の動作と合っているかを確かめる。

```text
md-peruse is a read-only Markdown viewer for Windows. It displays Markdown files and the folder tree the user opens, and never modifies those files.

It uses the runFullTrust capability because it is a packaged desktop application (a Tauri application running in the Windows.FullTrustApplication entry point, hosting WebView2). The process reads only the files and folders that the user explicitly opens (File > Open Folder..., drag and drop, or by opening a .md or .markdown file from File Explorer). It does not declare broadFileSystemAccess. The app makes no network connections, except for opening a link in the user's default browser when the user explicitly clicks it, and for sending five usage events (event names only) to the Microsoft Store measurement platform in the version distributed through the Store. No file paths, file names, or file contents are sent. See the privacy policy for details.

How to test:
1. Install and launch md-peruse.
2. Choose File > Open Folder... and select any folder that contains .md files (a sample folder with Markdown files, including images, tables, math, and diagrams, can be used).
3. Select a file in the tree to view it as a read-only preview. Open a second file to see it in a new tab.
4. In File Explorer, double-click a .md file to open it with md-peruse.
No account or sign-in is required.
```

審査用のアカウントは要らない。審査員が使える Markdown のサンプルが要るかは、提出時に判断する（要るなら、公開リポジトリのサンプルへのリンクを書く）。

### 7.2 Restricted capabilities（`runFullTrust`）

`runFullTrust` の欄に、なぜ宣言が要るのか、どう使うのかを、できるだけ具体的に書く。次は英語のたたき台である。7.1 の内容と矛盾しないようにする。

```text
md-peruse is a packaged desktop application (a Tauri application with a native Rust process that hosts a WebView2 view), launched through the Windows.FullTrustApplication entry point. Packaged classic desktop apps (Win32) cannot run without runFullTrust, so the capability is required for the app to start.

How it is used: the process runs at medium integrity as the signed-in user. It reads only the Markdown and image files and folders that the user explicitly opens (File > Open Folder..., drag and drop, or opening a .md/.markdown file from File Explorer) and watches that folder for changes in order to refresh the preview. It never writes to or modifies those files. It stores only its own settings (theme, language, window layout, recent folders) in its app data folder.

What it does not do: it does not declare broadFileSystemAccess or any other restricted capability, has no background service, does not start with Windows, does not install drivers, and makes no network connection other than opening a link in the default browser when the user clicks it and sending five event names (no paths, file names, or contents) to the Microsoft Store measurement platform in the Store version.
```

## 8. 初回の提出（手動）

1. Partner Center で `md-peruse` のアプリを開き、新しい申請（submission）を作る。
2. **Pricing and availability**: 市場、価格（無料）、可視性、公開の予定（Schedule）を確認する。公開の方法（手動公開）は、7番の Submission options で選ぶ。2026-10-03時点の下書きでは、価格が未設定で、画面に警告が出ている。
3. **Properties**: カテゴリ、個人情報の取り扱いの回答、プライバシーポリシーの URL（5章）、サポートの情報、システム要件（x64のみ対応）を入力する。年齢区分は、次の別ページである。
4. **Age ratings**: IARC の質問票に答える（アプリの種類は「その他のすべてのアプリの種類」）。
5. **Packages**: 3章の `.msixupload` をアップロードする（受け付けられないときは `.msix`）。アップロード後の検証が終わるまで、先へ進まない。Package details で、Identity Name、Publisher、Version、x64、Capability（`runFullTrust` のみ）、警告とエラーを確認する。エラーや、確認できていない警告があれば、提出せず、パッケージを直して、タグを切り直す（10章）。
6. **Store listings**: 掲載の言語は、パッケージのアップロード後に「パッケージでサポートされている言語」として現れる（アップロード前は空。2026-10-03に確認）。6章の内容を、日本語と英語で入力する。プレビューで、言語を切り替えて、画像のぼけ、切り抜き、文字化けを目で確認する。
7. **Submission options と審査ノート**: 次の3つを入力する。入力先は、前の2つが申請オプション、審査ノートは別ページである。
   - **Publishing hold options**: 「Don't publish this submission until I select Publish now」を選ぶ（手動公開。審査に通っても自動で公開しない）
   - **Notes for certification**: 左メニュー「追加のテスト情報」の「説明」へ、7.1 の審査ノートを入力して保存する（資格情報の欄は使わない）
   - **Restricted capabilities**: `runFullTrust` の用途の説明（7.2）。この欄が出ているのに空のまま提出しない
8. 概要のページで、パッケージ、掲載情報、価格と市場、プライバシーポリシー、審査ノートと Restricted capabilities、公開の方法（手動公開）を確認し、**提出の操作は、あなたが行う**。
9. 提出した記録（11章）を残す。

認定（審査）の結果は、通常数日で出る。通ったあと、公開の前に、次を確認する。

- [ ] Store の掲載の表示（プレビュー）に問題がない
- [ ] 初回の提出物と、3章で記録した SHA-256 が一致している
- [ ] あなたが、公開してよいと判断した

公開の操作（Publish now）は、あなたが行う。

## 9. 2回目以降の提出（GitHub Release に連動）

初回の審査に通ったあとに、実装する。実装の前に、次を確かめる。

進める順序は、次のとおりとする。

1. 掲載情報・パッケージ・審査ノート等の準備とレビューを終え、GitHub Releaseを公開する前に初回の手動提出を行う。
2. 初回の審査通過後、cloud-migrator／PhotoGeoExplorerで安定運用している提出フローを参照し、md-peruseの自動提出フローを実装・レビューする。
3. 自動提出フローが整ったら、GitHub Releaseの公開と承認ゲートを経たStoreへの自動提出を連動させる。初回の手動申請が処理中の間に自動提出を重ねず、同じ提出済みバージョンを再提出しない。

参照先の安定運用状況はユーザーによる確認に基づく。方式・認証・送信形式・公開設定は、実装時に両リポジトリの現行フローを確認して決める。

- 提出に使う方法（Microsoft Store の Submission API、または Microsoft Store Developer CLI（`msstore`））の、現在の版、認証の方式、MSIX のパッケージへの対応。先行する PhotoGeoExplorer は Submission API（`manage.devcenter.microsoft.com/v1.0/my`、`Submit-ToPartnerCenter.ps1`）、cloud-migrator は `msstore` を使っている。`msstore` の GitHub Actions での更新は、無料のアプリが前提である（`md-peruse` は無料）。
- 認証に必要な値（Entra ID のアプリ、テナント ID、クライアント ID、シークレット、Seller ID、Product ID）。値は、リポジトリへ書かず、GitHub の Environment の secret に置く。

構成の方針:

1. タグの push で、`Package` ワークフローが、MSIX の生成と WACK を行う（今のとおり）。
2. WACK が合格したときだけ、GitHub Release を作り、同じ artifact の MSIX を添付する。
3. その次に、`store-production` の Environment の job が、同じ MSIX を Store へ送る。**この job の前に、手動承認（required reviewer）のゲートを置く**。承認がなければ、送信しない。
4. 送信の対象は、承認時点のコミットとタグに紐づく、WACK を通した artifact だけにする（再ビルドしない）。
5. 公開の方法は、最初は手動公開のままにして、運用に慣れてから自動に変えるかを決める。
6. GitHub Release の公開と、Store の提出・認定・公開は、別の状態として記録する。

先行する2つのリポジトリの経験から、実装で次を押さえる。

- 処理中の申請（pending submission）があるときは、自動で消さず、失敗にして、人が確認してから対応する。
- 別のバージョンの申請が処理中のときは、上書きしない。
- 実行の再試行は、新しいタグを切らず、同じ実行を再実行する。
- 認証の値や、トークンを、ログへ出さない。

提出の API が使えないときは、8章の手動の手順を、そのまま使う。

## 10. 差戻しと認定の失敗

1. Certification report の検出の名前、対象のパッケージ、再現の条件を保存する。
2. 原因を分類する（Required の失敗、Capability の説明の不足、掲載情報の不一致、テスト手順の不足）。
3. 必要な修正をする（コード、マニフェスト、掲載情報、審査ノート、Restricted capabilities の説明）。
4. バージョンを、提出済みより大きくし、新しいタグで `Package` を動かす。WACK を、新しい MSIX で通す。
5. 修正の内容と、新しい SHA-256 を、新しい申請の記録へ紐づける。

同じバージョンと同じ MSIX の再提出はしない。同じ申請の入力を上書きして、証跡を失わない。

## 11. 提出の記録

提出（と、差戻しの再提出）のたびに、次を残す。

| 項目 | 値 |
| --- | --- |
| 作業日時 |  |
| 操作した人 |  |
| Partner Center のアプリ名、Store ID | md-peruse、`9P35BW61FN4W` |
| Submission ID |  |
| パッケージの Version、アーキテクチャ | x64 |
| タグ、コミットの SHA |  |
| `Package` の実行の URL |  |
| MSIX の SHA-256 |  |
| WACK の結果（`OVERALL_RESULT`、報告書の保存先） |  |
| プライバシーポリシーの URL の確認日時と結果 |  |
| 認定の状態、差戻しの内容 |  |
| 公開の方法と、公開の操作をした人 |  |

### 11.1 初回の提出（v0.1.0）の記録

| 項目 | 値 |
| --- | --- |
| 作業日時 | 2026-10-03（提出の時刻は記録していない） |
| 操作した人 | 提出の操作は scottlz0310。入力は Claude in Chrome で行い、各項目はあなたの承認を得て保存した |
| Partner Center のアプリ名、Store ID | md-peruse、`9P35BW61FN4W` |
| Submission ID | `1152921505702030146`（Submission 1） |
| パッケージの Version、アーキテクチャ | 0.1.0.0、x64（Windows.Desktop 10.0.22000.0 以上、言語 ja-jp・en-us） |
| タグ、コミットの SHA | `v0.1.0`、`072d019f30abc1efec2aaf61026d5c8c76e333f6` |
| `Package` の実行の URL | <https://github.com/scottlz0310/md-peruse/actions/runs/37124922688> |
| MSIX の SHA-256 | `.msix`: `A35D303FA57CA1E80F5CF8B9209543A4DDBA1F02AB2B4972B92EC094007CC743`。アップロードした `.msixupload`（4,287,866 バイト）: `A1A35E978ED2155B7129A7D20907C765009B238E8544B6F7874E8DD871E36A55`。どちらも artifact の `SHA256SUMS.txt` と、ダウンロードして再計算した値が一致した |
| WACK の結果（`OVERALL_RESULT`、報告書の保存先） | `PASS`、FAIL 0件。報告書は artifact `md-peruse-msix-x64` の `wack/wack-report.xml` |
| プライバシーポリシーの URL の確認日時と結果 | 2026-10-03、HTTP 200 |
| 認定の状態、差戻しの内容 | 送信直後の2026-10-03は「認定中」（申請と前処理中まで完了）。結果は未確認 |
| 公開の方法と、公開の操作をした人 | 手動公開（「今すぐ公開」を選ぶまで公開しない）。公開の操作は、まだしていない |

提出時に分かったこと:

- Partner Center は、アップロードしたパッケージのハッシュを表示しない。提出物と検証済みの成果物の一致は、artifact から取り出したファイルを、再ビルドせずにそのままアップロードした手順で担保している。
- `.msixupload`（手作りのZIP、シンボル `.appxsym` 同梱）は、そのまま受理された（Validated）。シンボルが認識されたかの確認は、初回の公開後のクラッシュ分析で行う。
- Package details の Capabilities には、`runFullTrust` のほかに `Microsoft.storeFilter.core.notSupported_8wekyb3d8bbwe` が表示された。マニフェストにはない（Partner Center 側の表示と思われるが、出所は確認していない）。
- 「Restricted capabilities」の入力欄は、パッケージのアップロード後も、申請オプションに現れなかった。認定の過程で説明を求められたら、7.2 の英文を使う。
- 年齢区分の IARC 質問票は、アプリの種類を「その他のすべてのアプリの種類」にして全問「いいえ」とし、IARC 3+（ESRB 全年齢、PEGI 3+、USK 全年齢）になった。公開元の表示名とメールアドレスが IARC と共有される。
- プロパティの個人情報の質問には「はい」と答え、プライバシーポリシーの URL を入れた（Store 版がイベント名だけを Microsoft の計測基盤へ送るため）。

## 12. 初回の公開後に確認すること

- Store の掲載の表示、インストール、起動、ファイルの関連付け、アンインストールを、実機で確認する。
- Partner Center の Usage レポートで、カスタムイベント（5種類）と、パッケージのバージョン別の集計を確認し、反映の遅延と、バージョン別のフィルターの粒度を、計測の定義へ記録する（[design-decisions.md](./design-decisions.md) 11.4。[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）。
- Microsoft の資料で確かめられなかった、診断データの設定との関係（母集団の偏り）を、実データで確かめる。
