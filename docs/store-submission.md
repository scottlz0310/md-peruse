# Microsoft Store 提出の手順書

`md-peruse` を Microsoft Store へ提出するための手順書である。初回は手動で提出し、審査に通ったあとは Submission API による自動提出へ移る（方針の根拠は [design-decisions.md](./design-decisions.md) 13.7）。Store の画面名や項目は変わりうるため、画面上の最新の表示を優先する。

先行する2つのリポジトリの提出経験（[PhotoGeoExplorer](https://github.com/scottlz0310/PhotoGeoExplorer)、[cloud-migrator](https://github.com/scottlz0310/cloud-migrator)）に学んだ点は、該当する節に書く。

## 1. 方針

| 項目 | 方針 |
| --- | --- |
| 対象アーキテクチャ | x64 のみ。ARM64 は対応外（[design-decisions.md](./design-decisions.md) 3章） |
| 初回の提出 | 準備とレビュー完了後、GitHub Releaseの公開より先に手動提出する。Partner Center の画面で、あなたが入力し、あなたが提出する |
| 初回の公開 | 審査に通っても、自動では公開しない（手動公開）。公開の操作は、初回の提出物と掲載内容を確認してから行う |
| 2回目以降 | Submission API で提出する（パッケージのリリースと、掲載情報だけの更新）。資格情報を使う実行（dry-run を含む）の前に、手動承認のゲートを置く。GitHub Release との連動は、自動提出が安定してから行う（9章） |
| 掲載素材（画像、説明文） | ローカルで用意する（イラストの生成を含む）。リポジトリへは、確定した素材と一覧だけを置く（6章） |
| Partner Center の登録内容との照合 | ローカルで行う（2章の項目） |
| 実機での確認（MSIX） | ローカルで行う（8章） |

## 2. 提出前の停止条件

次がすべて揃うまで、Partner Center の提出画面で保存・提出を進めない。

- [ ] Partner Center の `md-peruse` の予約と、`packaging/Package.appxmanifest.template` の Identity が一致している（Name `scottlz0310.md-peruse`、Publisher `CN=39FB3D39-1F1A-4B82-B081-47469FD12CA6`、PublisherDisplayName `scottlz0310`。Store ID `9P35BW61FN4W`。[design-decisions.md](./design-decisions.md) 13.1）
- [ ] 提出する MSIX は、タグ実行の `Package` ワークフローが生成した artifact であり、同じ実行で WACK の `OVERALL_RESULT` が `PASS` になっている。必須テストはすべて PASS で、FAIL は [design-decisions.md](./design-decisions.md) 13.3 に記録した任意テスト「Blocked executables」の1件だけである（3章）
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

2026-10-03の初回提出までは、画像を `docs/assets/store/store/` の下に置いていた。これは上のフラットな構成とは違い、`docs/assets/store/` を選んでも、CSV の `store/screenshot1.png` が指す画像（選んだフォルダー直下）に当たらない。先例の構成に合わせて、画像をフォルダー直下へ移した。この構成での手動インポートは、2026-10-04に実機で確かめた（下の「公開後の実測」）。

[`listingData.csv`](./assets/store/listingData.csv) は、2026-10-03にパッケージのアップロード後のPartner Centerから取得したエクスポートの形式（`Field`、`ID`、`Type`、`default`、`ja-jp`、`en-us` の6列、454行）に合わせたもの。`ja-jp` へ日本語、`en-us` へ英語を記入し、`default` は空である（エクスポートと同じ構造）。画像は実際のMSIXで撮影した1920×1032 PNGを4枚収録し、画像参照は両言語とも `store/screenshot1.png` 等である（英語の掲載にも日本語UIの画像を使っている）。CSVのUTF-8 BOM・CRLFは、専用の `.gitattributes` と `.editorconfig` の設定で保持する。

初回提出（v0.1.0）の入力で分かったこと（2026-10-03）:

- パッケージを追加する前のエクスポート（`default` 列だけ）を基にしたCSVは、パッケージを追加して言語（`ja-jp`、`en-us`）が現れた後は、インポートに失敗した。パッケージを追加した後に、必ずエクスポートし直して、その形式に合わせる。
- 画像参照を含むCSVは、「.csv のアップロード」（CSV 単体）でも、フォルダー用のファイル入力へ個別にファイルを渡す自動操作でも、インポートに失敗した（`ja-jp` の保存途中で止まった）。CSV 単体の失敗は、先例（PhotoGeoExplorer）の記録と一致する。自動操作の失敗は、フォルダーの構造が渡らないためと推測しているが、確かめていない。あなたが手でフォルダーを選ぶインポートは、フラット構成にして通った（下の「公開後の実測」）。
- 初回は、画像参照を空にしたCSVを「.csv のアップロード」で取り込み（エラーなしで完了）、画像は掲載ページの入力欄へ1枚ずつ、字幕は画像ごとの「イメージの字幕の追加」から入力した。複数の画像を一度に渡すと、先頭の1枚だけが登録された。
- 任意のStoreロゴ（9:16のポスターアート、1:1のボックスアート）は登録していない。認定を通った後のStore上の表示で、見え方を確認する。

公開後の実測（2026-10-04。手動の「更新の開始」で作った下書き Submission 2 で確認し、終わったあと、あなたが「送信の削除」で削除した）:

- フラット構成のフォルダー単位のインポート: あなたが `docs/assets/store/` を手で選んで、成功した。取り込みエラーはなく、Store 登録情報の状態は「更新済み」になった。`ja-jp`、`en-us` とも、デスクトップの画像は4枚、字幕は4件で、文章項目は取り込み前と変わらなかった。
- 画像の順序: `ja-jp` で、3番目と4番目の画像が CSV の指定と入れ替わった（3番目がリリースノートの文書、4番目が数式とコード）。`en-us` は CSV どおりだった。画像と字幕の組み合わせは、どちらも正しい。試行は1回で、並び順の決まり方は確かめていない。画像を含むインポートの後は、必ず画面で順序を目視する。
- 公開済みの内容のエクスポートとリポジトリの CSV: 454行、6列で、`Field`、`ID`、`Type` は位置ごとに完全に一致した。文章項目（説明、最新情報、機能、検索語、字幕など）はすべて一致し、差は画像の参照だけだった。エクスポートの画像の参照は、アカウントに紐づく URL（`developer.microsoft.com/en-us/dashboard/apps/…`）になる。リポジトリの CSV は、相対パスのまま保つ。エクスポートしたファイルは申請の ID を含むので、リポジトリへ入れない。

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
| Restricted capabilities | 申請オプション。パッケージのアップロード前は欄がない（2026-10-03に確認）。v0.1.0 では、アップロード後も欄は現れず、説明を入力しないまま認定を通過した（2026-10-04に確認）。Capability を足す更新では、欄が現れるかを確認する | 制限付き Capability ごとの、用途と必要性の説明。**審査員が承認するかを判断する**（7.2） |

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

## 9. 2回目以降の提出（自動提出）

初回の提出（8章）と審査を終えたので、2回目以降は、Submission API で提出する。方針の根拠は [design-decisions.md](./design-decisions.md) 13.7。提出のツールは `scripts/store/` にある。

### 9.1 方針（2026-10-04に決定）

| 項目 | 決定 |
| --- | --- |
| 方式 | **Submission API を TypeScript（bun）で一本化する。** `msstore` は使わない |
| 理由 | パッケージの差し替えと、掲載情報（文章、スクリーンショット、イラスト）の更新を、同じ仕組みで扱うため。`msstore` の資料（2026-08-30 更新）には、掲載画像のアップロード方法の記載がない。Submission API は、画像を ZIP で送る方法を定めている |
| 提出の種類 | ①**パッケージのリリース**（タグ実行の `Package` の artifact を送る）。②**掲載情報だけの更新**（タグ、バージョン上げ、GitHub Release は要らない。パッケージは公開済みのまま） |
| 掲載情報の元 | `docs/assets/store/`（`listingData.csv` と画像）。CSV にある項目のうち、許可リストの項目だけを上書きする。値が空の項目は、申請の値を変えない |
| 既定の動作 | **dry-run**（読み取りだけ。何が変わるかを表示する）。`--apply` を付けたときだけ、書き込む |
| 承認 | 資格情報を使う実行は、dry-run も含めて、GitHub の Environment `store-production` の必須レビュアー（あなた）の承認を必要とする（資格情報は Environment の secret で、承認の前は渡らない）。dry-run で差分を確かめてから、`apply` を別の実行として承認する |
| 公開 | 申請が引き継いだ設定に従う。公開方法を `--publish-mode`（既定 `Manual`）で明示し、申請の設定と違えば止める |

進める順序は、次のとおりとする。

1. **ツール**（`scripts/store/`、テスト、この章）を作る。dry-run で、実際の Partner Center の申請の JSON と突き合わせる。
2. **承認ゲート付きのワークフロー**と、Environment の設定を整える。
3. 最初の実走として、**英語版スクリーンショットの掲載情報だけの更新**を通す。
4. 自動提出が安定したら、**GitHub Release の公開と連動**させる。`release-automate` の導入は、`tauri.conf.json` のバージョン更新への対応と、`GITHUB_TOKEN` が作るタグでは `push: tags` の `Package` が起動しない点を確かめてから決める。

### 9.2 使い方

```text
bun run store:submit --listing docs/assets/store
```

| オプション | 内容 |
| --- | --- |
| `--listing <フォルダー>` | `listingData.csv` と画像を直下に置いたフォルダー（6章のインポート用フォルダーと同じ） |
| `--languages ja-jp,en-us` | 反映する言語（既定は `ja-jp,en-us`） |
| `--replace-screenshots` | スクリーンショットを、CSV の内容で入れ替える。指定しなければ、画像は変えない |
| `--package <.msixupload>` | パッケージを差し替える。既存のパッケージは `PendingDelete` にする |
| `--publish-mode Manual／Immediate` | 申請が引き継いでいるはずの公開方法。違えば止める。既定は `Manual` |
| `--apply` | 書き込む。指定しなければ dry-run |
| `--no-commit` | `--apply` でも commit せず、下書きのまま止める（初回の確認用） |
| `--clone-only` | `--apply` と組み合わせる。申請（下書き）を作り、公開済みの申請との違いを表示するだけで止める（更新も commit もしない。初回の確認用） |

認証の値は、環境変数で渡す（GitHub の Environment の secret と変数。値はログに出さない）。

| 名前 | 内容 |
| --- | --- |
| `STORE_PRODUCT_ID` | Store ID（`9P35BW61FN4W`） |
| `AZURE_AD_TENANT_ID` | Entra ID のテナント ID |
| `AZURE_AD_APPLICATION_CLIENT_ID` | Entra ID のアプリのクライアント ID |
| `AZURE_AD_APPLICATION_SECRET` | Entra ID のアプリのシークレット |

名前は、先例の cloud-migrator と同じにした。

実行の流れは、①アプリの情報を読む（処理中の申請があれば止まる）、②公開済みの申請を読んで、変更の計画を作る（変更が無ければ、申請を作らずに終わる）、③（`--apply` のとき）申請を作り、公開済みの申請の複製になっていることを確かめてから更新する（申請ごとに変わる項目を除いて、トップレベルの項目に違いがあれば、更新せずに止まる）、④画像やパッケージがあれば ZIP を SAS URL へアップロードする、⑤commit し、受理されるまで待つ（認定の完了までは待たない）。

#### ワークフローから使う

GitHub の Actions の **Store Submit**（`.github/workflows/store-submit.yml`）が、このツールを呼ぶ。手動起動だけで動き、起動のたびに Environment `store-production` の承認（必須レビュアー）を求める。承認されるまで、資格情報は使われない。

| 入力 | 内容 |
| --- | --- |
| `mode` | `dry-run`（既定。読み取りだけ）／`clone-only`／`draft-only`（更新するが commit しない）／`apply`（提出する） |
| `languages` | 反映する言語（既定は `ja-jp,en-us`） |
| `replace_screenshots` | スクリーンショットを `docs/assets/store/` の内容で入れ替える |
| `publish_mode` | 申請が引き継いでいる公開方法（`Manual`／`Immediate`）。違えば止まる |

結果は、実行の Step Summary に出る（何が変わるか、申請の ID と状態）。パッケージ（`.msixupload`）の提出は、このワークフローの対象外とする（GitHub Release との連動で別に扱う）。同時に 2 つの実行が動かないよう、実行は直列にしてある。

### 9.3 運用の規則

- **API で作った申請は、以後 Partner Center の画面で変更しない。** 画面で変更すると、その申請を API で変更も commit もできなくなり、エラーの状態で残ることがある。その場合は、申請を削除して作り直す。
- **処理中の申請（下書き）が残っていると、ツールは止まる。** 自動では消さない。申請の削除は取り消せない操作なので、あなたが内容を確かめて、Partner Center の「送信の削除」で行う。
- 認定の結果と、公開は、Partner Center（とメール）で確認する。公開方法が `Manual` なら、認定の後に、あなたが「今すぐ公開」を押す。
- ログと Step Summary に、シークレットと、署名つきのアップロード URL は出さない。
- **価格は、このツールで変えない。** Partner Center の「価格と提供状況」に「市場ごとの価格のレビュー」が出るアプリは Pricing Version 2 で、API は価格を不明な tier として返す（資料の定め）。申請の JSON をそのまま送り返すため、価格が意図せず変わらないかを、初回に実測で確かめる（9.4 の「初回の実走」）。ツールは、公開済みの申請と作成した申請の価格をログに出し、価格を含むトップレベルの項目に違いがあれば、更新せずに止める。

#### 公開方法を「手動」から「自動」に変える

自動提出の公開方法は、公開済みの申請から引き継がれる。変えるには、Partner Center で、変更なしの提出を 1 回行う。

1. 概要の「製品の更新」の「更新の開始」を押す（公開済みの内容を引き継いだ下書きができる）。
2. 「申請オプション」の「公開の保留オプション」で、「認定されたらすぐに、（または [スケジュール] セクションで選択した日付に）この提出物を公開する」を選び、保存する。
3. 概要に戻り、「送信して認定を受ける」を押す。

以降のすべての申請は、認定の後に自動で公開される（人の確認は、送信前の承認ゲートだけになる）。そのとき、自動提出のツールには `--publish-mode Immediate` を指定する。

### 9.4 あなたが用意するもの

テナント ID、クライアント ID、シークレットは、リポジトリへ書かない。画面の文言は、Partner Center と GitHub の更新で変わることがある（違っていたら、近い項目を探す）。

#### ① Entra ID のアプリを、Partner Center のアカウントに結びつける

Submission API は、Partner Center のアカウントに登録した Entra ID（旧 Azure AD）のアプリの資格情報で呼ぶ。**cloud-migrator が使っているアプリを、そのまま使う**（新しく作らなくてよい。同じ Partner Center のアカウントの製品なので、アプリも同じ）。

1. Partner Center の右上の歯車（アカウント設定）から「ユーザー」を開き、Microsoft Entra アプリケーションの一覧を見る。
2. cloud-migrator 用のアプリが一覧にあり、ロールが **Manager** なら、結びつけは済んでいる。アプリの名前を開き、**テナント ID** と **クライアント ID** が、控えた値と一致することを確かめる。
3. 一覧に無いときだけ、「Microsoft Entra アプリケーションの追加」を押す。ディレクトリにある**既存のアプリ**を選び、**Manager** のロールを付けて保存する。新しいアプリを作るのは、既存のアプリが選べないときに限る。
4. Entra ID のディレクトリとアカウントが関連付いていなければ、アカウント設定の組織のプロファイルで関連付ける（Entra ID のグローバル管理者が必要）。cloud-migrator で API を使えているなら、済んでいる。

**シークレット（キー）**は、GitHub に保存した値を後から読み返せない。cloud-migrator のときに控えた値（`.env`、パスワード マネージャー）を使う。控えが無いときは、同じアプリの画面で「新しいキーの追加」を押す（値は、そのとき 1 回しか表示されない。既存のキーは失効しない）。リポジトリごとにキーを分けると、片方を失効させても、もう片方に影響しない（こちらを勧める）。

#### ② GitHub の Environment `store-production`

**ワークフローを起動する前に**作る。Environment が無いまま起動すると、GitHub が保護の無い Environment を自動で作るため。

1. リポジトリの Settings の「Environments」で「New environment」を押し、名前を `store-production` にする。
2. **Required reviewers** を有効にし、あなた（`scottlz0310`）を指定する。
3. **Prevent self-review** は**オフ**にする。一人で開発しているため、オンだと、起動した本人が承認できず、実行が止まったままになる。
4. **Deployment branches and tags** は「Selected branches and tags」にし、ブランチ `main` だけを追加する（Store Submit は `main` から起動する）。タグ `v*` は、パッケージの提出（GitHub Release との連動）を足すときに加える。
5. Environment secrets に `AZURE_AD_TENANT_ID`、`AZURE_AD_APPLICATION_CLIENT_ID`、`AZURE_AD_APPLICATION_SECRET` を、Environment variables に `STORE_PRODUCT_ID`（`9P35BW61FN4W`）を登録する。

登録は、画面のほかに、`gh` でもできる。secret は、値を対話で貼り付ける（コマンドの引数に値を書くと、シェルの履歴に残る）。

```text
gh secret set AZURE_AD_TENANT_ID --env store-production --repo scottlz0310/md-peruse
gh secret set AZURE_AD_APPLICATION_CLIENT_ID --env store-production --repo scottlz0310/md-peruse
gh secret set AZURE_AD_APPLICATION_SECRET --env store-production --repo scottlz0310/md-peruse
gh variable set STORE_PRODUCT_ID --env store-production --repo scottlz0310/md-peruse --body 9P35BW61FN4W
```

cloud-migrator の `scripts/Configure-StorePublishing.ps1` は、そのままは使わない。作る Environment がタグ `v*` だけを許可し、必須レビュアーを付けず、`SELLER_ID` を必要とするため、この方針（承認ゲート、`main` から起動）と合わない。

#### ③ 初回の実走（確認の手順）

Actions の **Store Submit** で「Run workflow」を押し（ブランチは `main`）、`mode` を選ぶ。承認の待ちになるので、実行の画面の「Review deployments」で承認する。結果は、実行の Step Summary とログに出る。**下の順に、1 つずつ進める。**

1. **`dry-run`**（読み取りだけ）。成功すれば、Entra ID のアプリの資格情報と権限が正しい。失敗の見分け方:
   - 「アクセス トークンを取得できませんでした（HTTP 400／401）」: テナント ID、クライアント ID、シークレットのどれかが違う（シークレットの期限切れも）。
   - 「Store API のエラー: GET applications/…（HTTP 401／403）」: アプリが、この Partner Center のアカウントに登録されていない、または Manager のロールが無い。
   - 「処理中の申請が残っています」: 下書きが残っている。内容を確かめ、不要なら「送信の削除」で消す。

   文章は公開済みの内容と一致しているはず（6章「公開後の保守」）なので、**「変更はありません」と出れば**、CSV の項目と API の項目の対応が合っている。差が出たら、改行コードなど、CSV と API の値の違いを確かめてから進む。ログの「価格（公開済み）」は、Pricing Version 2 の実測として控える。
2. **`clone-only`**（下書きを作るだけ）。ログの「違い（トップレベル）」が「なし」で、「価格（作成した申請）」が公開済みと同じなら、複製として安全。違いがあれば、`apply` へ進まず、原因を調べる。終わったら、Partner Center で作られた下書きを**見るだけ**にして（画面で変更しない）、「送信の削除」で消す。
3. **`draft-only` と `replace_screenshots`**（今ある画像のまま入れ替えて、commit しない）。更新と ZIP のアップロードまで通す。Partner Center で下書きを開いて、次を見る（変更はしない）。
   - 「価格と提供状況」: 基本価格、市場、無料のままか（Pricing Version 2 で価格が変わっていないか）
   - 年齢区分、プロパティ、パッケージ、申請オプション（公開方法が、期待どおりか）
   - 「Store 登録情報」: 文章と、画像の**順序**（6章のとおり、インポートでは 3 番目と 4 番目が入れ替わったことがある）

   変わっていなければ、「送信の削除」で消す。変わっていれば、`apply` へ進まない。
4. **`apply`**（提出）。`publish_mode` は、公開済みの申請の設定に合わせる（手動公開なら `Manual`。9.3 の手順で自動に変えたなら `Immediate`）。`Manual` のときは、認定の後に、あなたが「今すぐ公開」を押す。

申請の削除は取り消せない操作なので、毎回あなたが行う（9.3）。

### 9.5 実測した引き継ぎ（手動の「更新の開始」）

手動の「更新の開始」で作った下書き（Submission 2）で、公開済みの内容の引き継ぎを読み取りで確かめた（2026-10-04）:

- 引き継がれたもの: 市場（全市場）、表示範囲（一般ユーザー）、見つかりやすさ（検索可）、基本価格（USD）、年齢区分（評価 ID つき、IARC 3+）、プロパティ、パッケージ（v0.1.0.0 の `.msixupload` と対象デバイス）、Store 登録情報、申請オプション（**「今すぐ公開を選択するまで、この提出物を公開しない」**）。「追加のテスト情報」（審査ノート）はアプリ単位で、申請とは別に残る。
- パッケージは、新しい版を出すときに、古いものを「Remove」してアップロードする。段階的な展開と必須の更新のオプションが現れる。
- 下書きの申請が残っていると、先例の自動提出は失敗する（pending submission の検出）。実測用の下書きは、確認後に、あなたが「送信の削除」で削除した。
- これは手動での「更新の開始」の結果である。Submission API の新しい申請は、資料では「直近の公開のコピー」と定められている。実際に同じ内容を引き継ぐかは、最初の dry-run と実走で確かめる。

### 9.6 先例から押さえた点

- 処理中の申請（pending submission）があるときは、自動で消さず、失敗にして、人が確認してから対応する。
- 別のバージョンの申請が処理中のときは、上書きしない。
- 実行の再試行は、新しいタグを切らず、同じ実行を再実行する。
- 認証の値や、トークンを、ログへ出さない。
- 先例の PhotoGeoExplorer（`Submit-ToPartnerCenter.ps1`）は Submission API を使い、cloud-migrator は `msstore` を使っている。エンドポイントと呼び出しの順序は、前者に合わせた。

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
| WACK の結果（`OVERALL_RESULT`、報告書の保存先） | `OVERALL_RESULT="PASS"`。24テスト中23 PASS、任意テスト（`OPTIONAL="TRUE"`）「Blocked executables」の1件が FAIL で、総合結果には影響しない（`CreateProcessW`、`ShellExecuteW` と `cmd.exe` などの文字列への参照。内訳と原因は [design-decisions.md](./design-decisions.md) 13.3。過去の実行でも同じ）。報告書は artifact `md-peruse-msix-x64` の `wack/wack-report.xml` |
| プライバシーポリシーの URL の確認日時と結果 | 2026-10-03、HTTP 200 |
| 認定の状態、差戻しの内容 | 送信直後の2026-10-03は「認定中」（申請と前処理中まで完了）。その後、認定は通過した（scottlz0310 が Partner Center で確認。通過の日時は記録していない）。差戻しはなかった。認定の過程で、追加の指摘や「Restricted capabilities」の説明の要求はなく、そのまま公開された（scottlz0310 の報告。WACK の任意テスト「Blocked executables」への指摘もなかった）。Partner Center から「Your submission is processed」の通知メールが届いた |
| 公開の方法と、公開の操作をした人 | 手動公開。scottlz0310 が「今すぐ公開」を操作して公開した（操作の日時は記録していない）。2026-10-04に、Partner Center の製品の状態が「Microsoft Store で取り扱い中」（"currently available in the Microsoft Store"）であることと、公開ページ <https://apps.microsoft.com/detail/9P35BW61FN4W> が HTTP 200 を返し、タイトルが「md-peruse - Windows に無料でダウンロードしてインストールする \| Microsoft Store」であることを確認した |

提出時に分かったこと:

- Partner Center は、アップロードしたパッケージのハッシュを表示しない。提出物と検証済みの成果物の一致は、artifact から取り出したファイルを、再ビルドせずにそのままアップロードした手順で担保している。
- `.msixupload`（手作りのZIP、シンボル `.appxsym` 同梱）は、そのまま受理された（Validated）。シンボルが認識されたかの確認は、初回の公開後のクラッシュ分析で行う。
- Package details の Capabilities には、`runFullTrust` のほかに `Microsoft.storeFilter.core.notSupported_8wekyb3d8bbwe` が表示された。マニフェストにはない（Partner Center 側の表示と思われるが、出所は確認していない）。
- 「Restricted capabilities」の入力欄は、パッケージのアップロード後も、申請オプションに現れなかった。v0.1.0 の認定では、説明を求められなかった。求められたら、7.2 の英文を使う。
- 年齢区分の IARC 質問票は、アプリの種類を「その他のすべてのアプリの種類」にして全問「いいえ」とし、IARC 3+（ESRB 全年齢、PEGI 3+、USK 全年齢）になった。公開元の表示名とメールアドレスが IARC と共有される。
- プロパティの個人情報の質問には「はい」と答え、プライバシーポリシーの URL を入れた（Store 版がイベント名だけを Microsoft の計測基盤へ送るため）。

## 12. 初回の公開後に確認すること

- Store の掲載の表示、インストール、起動、ファイルの関連付け、アンインストールを、実機で確認する。2026-10-04に確認した範囲: インストール済みのパッケージは `SignatureKind: Store`（v0.1.0.0、x64、開発モードではない。実体は `C:\Program Files\WindowsApps\scottlz0310.md-peruse_0.1.0.0_x64__r99jq8jxntmym\md-peruse.exe`）。`.md` の関連付けで文書を開くと Store 版が起動し、本文、ツリー、タブ、Mermaid の図、表が表示された。2つ目の文書を開いても同じプロセスのタブで開いた（単一インスタンス）。パッケージ専用の領域が存在する。未確認: Store からのインストール操作そのもの、アンインストール（破壊的なため行っていない）、Store へ送るイベントの観測。
- Partner Center の Usage レポートで、カスタムイベント（5種類）と、パッケージのバージョン別の集計を確認し、反映の遅延と、バージョン別のフィルターの粒度を、計測の定義へ記録する（[design-decisions.md](./design-decisions.md) 11.4。[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）。
- Microsoft の資料で確かめられなかった、診断データの設定との関係（母集団の偏り）を、実データで確かめる。
