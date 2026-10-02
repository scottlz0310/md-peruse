# Microsoft Store 提出の手順書

`md-peruse` を Microsoft Store へ提出するための手順書である。初回は手動で提出し、審査に通ったあとは GitHub Release に連動した提出へ移る（方針の根拠は [design-decisions.md](./design-decisions.md) 13.7）。Store の画面名や項目は変わりうるため、画面上の最新の表示を優先する。

先行する2つのリポジトリの提出経験（[PhotoGeoExplorer](https://github.com/scottlz0310/PhotoGeoExplorer)、[cloud-migrator](https://github.com/scottlz0310/cloud-migrator)）に学んだ点は、該当する節に書く。

## 1. 方針

| 項目 | 方針 |
| --- | --- |
| 対象アーキテクチャ | x64 のみ。ARM64 は対応外（[design-decisions.md](./design-decisions.md) 3章） |
| 初回の提出 | 手動。Partner Center の画面で、あなたが入力し、あなたが提出する |
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
- 画像を含むときは、フォルダー単位でインポートする。CSV 内の画像の参照は、フォルダー名を含む相対パス（例: `store/screenshot1.png`）にする。
- Partner Center がエクスポートした CSV にある、一時的な絶対 URL や、申請の識別子は、リポジトリへコピーしない。

素材は、`docs/assets/store/`（Partner Center へそのまま渡せるフォルダー）へ置く。確定するまでは、リポジトリへ入れない。

## 7. 審査ノートと、制限付き Capability の申請

`runFullTrust` は制限付き（restricted）の Capability である。Partner Center の Submission options には、次の2つの別の入力欄があり、**両方を入力する**。

| 入力欄 | 役割 |
| --- | --- |
| Notes for certification | 審査員が、アプリを正しく試すための情報（7.1） |
| Restricted capabilities | 制限付き Capability ごとの、用途と必要性の説明。**審査員が承認するかを判断する**（7.2） |

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
2. **Pricing and availability**: 市場、価格（無料）、可視性、公開の予定（Schedule）を確認する。公開の方法（手動公開）は、7番の Submission options で選ぶ。
3. **Properties**: カテゴリ、年齢区分、サポートの情報、プライバシーポリシーの URL（5章）を入力する。
4. **Age ratings**: 質問票に答える。
5. **Packages**: 3章の `.msixupload` をアップロードする（受け付けられないときは `.msix`）。アップロード後の検証が終わるまで、先へ進まない。Package details で、Identity Name、Publisher、Version、x64、Capability（`runFullTrust` のみ）、警告とエラーを確認する。エラーや、確認できていない警告があれば、提出せず、パッケージを直して、タグを切り直す（10章）。
6. **Store listings**: 6章の内容を、日本語と英語で入力する。プレビューで、言語を切り替えて、画像のぼけ、切り抜き、文字化けを目で確認する。
7. **Submission options**: 次の3つを入力する。
   - **Publishing hold options**: 「Don't publish this submission until I select Publish now」を選ぶ（手動公開。審査に通っても自動で公開しない）
   - **Notes for certification**: 7.1 の審査ノート
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

## 12. 初回の公開後に確認すること

- Store の掲載の表示、インストール、起動、ファイルの関連付け、アンインストールを、実機で確認する。
- Partner Center の Usage レポートで、カスタムイベント（5種類）と、パッケージのバージョン別の集計を確認し、反映の遅延と、バージョン別のフィルターの粒度を、計測の定義へ記録する（[design-decisions.md](./design-decisions.md) 11.4。[#21](https://github.com/scottlz0310/md-peruse/issues/21) 段階4）。
- Microsoft の資料で確かめられなかった、診断データの設定との関係（母集団の偏り）を、実データで確かめる。
