# プライバシーポリシー / Privacy Policy

最終更新日 / Last updated: 2026-10-02

- [日本語](#日本語)
- [English](#english)

---

## 日本語

`md-peruse`（以下「本アプリ」）は、Windows 上で Markdown を閲覧するための、閲覧専用のアプリです。開発者は個人（GitHub: [scottlz0310](https://github.com/scottlz0310)）です。

本アプリは、あなたの Markdown、画像、フォルダーの内容を、開発者や第三者へ送信しません。このポリシーは、本アプリが扱う情報と、その扱いを説明します。

### 開発者が収集する情報

**開発者は、あなたの個人情報を収集しません。** 本アプリは、開発者が運営するサーバーへ通信しません。アカウント、広告、クラッシュレポートの送信、利用状況の解析サービスも、本アプリには含まれません。

### Microsoft Store 版が送る利用状況イベント

Microsoft Store から配布された版に限り、本アプリは、次の 5 種類のイベントを、Microsoft Store の計測基盤（Microsoft Store Services SDK のカスタムイベント）へ送ります。

| イベント名 | 送るとき |
| --- | --- |
| `session_start` | 本アプリを起動したとき |
| `open_md_ok` | Markdown を表示できたとき |
| `open_md_fail` | Markdown を表示できなかったとき |
| `open_folder` | あなたがフォルダーを開いたとき（前回のフォルダーの自動的な復元は含みません） |
| `launch_by_association` | エクスプローラーなどからファイルを開いて起動したとき |

- 送るのは**イベント名だけ**です。ファイルのパス、ファイル名、Markdown の本文、フォルダーの内容、ユーザー名、端末の識別子は、本アプリがイベントへ含めることはありません。
- 各イベントは、1 回の起動（セッション）につき、最大で 1 回だけ送ります。
- 開発ビルドと、Store 以外から入手したパッケージは、送信しません。
- 送信に失敗しても、本アプリの動作には影響しません。
- 目的は、本アプリが実際に使われ、機能しているかを、件数として把握することです。個人の識別には使いません。

イベントは Microsoft が受け取り、パッケージのバージョンごとの集計として、開発者が Microsoft Partner Center で見られます。Microsoft によるデータの取り扱いには、[Microsoft のプライバシーに関する声明](https://privacy.microsoft.com/privacystatement)が適用されます。

### あなたの端末に保存される情報

本アプリは、次の設定を、あなたの Windows ユーザーのアプリ専用の領域に保存します。この情報は、あなたの端末の外へ出ません。

- 表示の設定: 配色テーマ、表示言語、サイドバーの幅と表示状態、文字サイズ
- ウィンドウの位置、大きさ、最大化の状態
- 最近開いたフォルダー（最大 10 件）と、最後に開いたフォルダーの場所（パス）

Markdown と画像のファイルは、読み取るだけで、書き換えません。診断用のログファイルは、作りません。

本アプリを削除すると、これらの設定も削除されます。

### 外部のリンク

Markdown 内のリンクを、あなたが明示的に開いたときだけ、既定のブラウザーへ渡します。リンク先のサイトは、そのサイトのポリシーに従います。本アプリが、リンク先やリモートの画像を、自動で読み込むことはありません。

### 子どものプライバシー

本アプリは、個人情報を収集しません。年齢を問わずお使いいただけます。

### このポリシーの変更

収集する情報や送信するイベントを変えるときは、変更を反映したこのポリシーを、本アプリの更新より前に公開します。変更の履歴は、このファイルの [Git の履歴](https://github.com/scottlz0310/md-peruse/commits/main/docs/privacy-policy.md)で確認できます。

### 連絡先

質問や指摘は、[GitHub の Issue](https://github.com/scottlz0310/md-peruse/issues) へお寄せください。脆弱性は、公開の Issue ではなく、[Security Advisories](https://github.com/scottlz0310/md-peruse/security/advisories/new) から非公開で報告してください。

---

## English

`md-peruse` ("the app") is a read-only Markdown viewer for Windows. It is developed by an individual (GitHub: [scottlz0310](https://github.com/scottlz0310)).

The app does not send your Markdown files, images, or folder contents to the developer or any third party. This policy explains what the app handles and how.

### Information the developer collects

**The developer does not collect your personal information.** The app does not connect to any server operated by the developer. It has no accounts, no advertising, no crash-report upload, and no analytics service.

### Usage events sent by the Microsoft Store version

Only in the version distributed through the Microsoft Store, the app sends the following five events to the Microsoft Store measurement platform (custom events of the Microsoft Store Services SDK).

| Event name | Sent when |
| --- | --- |
| `session_start` | The app starts |
| `open_md_ok` | A Markdown file is displayed successfully |
| `open_md_fail` | A Markdown file cannot be displayed |
| `open_folder` | You open a folder (automatic restoration of the previous folder is not counted) |
| `launch_by_association` | The app starts because you opened a file from File Explorer or similar |

- **Only the event name is sent.** The app never includes file paths, file names, Markdown text, folder contents, your user name, or device identifiers in an event.
- Each event is sent at most once per launch (session).
- Development builds and packages obtained from outside the Store do not send events.
- If sending fails, the app keeps working normally.
- The purpose is to learn, as counts, whether the app is actually used and works. The events are not used to identify individuals.

Microsoft receives the events, and the developer can see them in Microsoft Partner Center as counts per package version. Microsoft's handling of the data is governed by the [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

### Information stored on your device

The app stores the following settings in the app-specific area of your Windows user profile. This information does not leave your device.

- Display settings: color theme, display language, sidebar width and visibility, text size
- Window position, size, and maximized state
- Recently opened folders (up to 10) and the location (path) of the last opened folder

The app only reads your Markdown and image files and never modifies them. It does not create diagnostic log files.

Uninstalling the app also removes these settings.

### External links

The app hands a link in a Markdown file to your default browser only when you explicitly open it. The linked site is governed by its own policy. The app never loads linked pages or remote images automatically.

### Children's privacy

The app does not collect personal information, and can be used regardless of age.

### Changes to this policy

Before changing the information collected or the events sent, the updated policy will be published ahead of the app update. The change history is available in the [Git history](https://github.com/scottlz0310/md-peruse/commits/main/docs/privacy-policy.md) of this file.

### Contact

Please send questions or comments through [GitHub Issues](https://github.com/scottlz0310/md-peruse/issues). Report vulnerabilities privately through [Security Advisories](https://github.com/scottlz0310/md-peruse/security/advisories/new), not through a public issue.
