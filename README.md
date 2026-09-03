# md-peruse

AI駆動開発で更新される設計書・仕様書・タスクリストの観測とレビューに特化した、Windows向けの閲覧専用Markdownビューワー。

> **開発状況**: Phase 1。アプリケーションのスケルトンを配置した段階で、Markdownの閲覧機能はまだ実装していない。MSIXパッケージングも未検証。進捗は [tasks.md](./tasks.md) を参照。

## コアバリュー

| 価値 | 内容 |
| --- | --- |
| 完全Read-only | 本文の編集手段を持たず、閲覧対象のファイルを変更しない |
| 低負荷 | 常駐プロセス、バックグラウンドインデックス、定期的なディスクI/Oを持たない |
| 高速な起動 | WebView2とRustの構成で、コールドスタートからの操作受付を短く保つ |
| 確実な可視化 | Mermaid、GFM、数式、シンタックスハイライトを安全に描画する |

## 主な機能

- フォルダーをワークスペースとして開き、ツリーから `.md` / `.markdown` を閲覧する
- ファイル変更を検知してプレビューを自動更新する（AIエージェントのatomic replaceに追従する）
- Mermaid図、GFMテーブル、タスクリスト、KaTeX数式、コードブロックのハイライトを表示する
- 複数文書をタブで切り替え、パンくずリストで階層を把握する
- ダーク／ライト／OS追従のテーマ、キーボード操作、ハイコントラストに対応する

編集機能とファイル書き込みは実装対象外とする。アプリ独自のネットワーク通信も行わない。

利用状況の計測は、Microsoft Store版に限り、イベント名だけを送る5種類のカスタムイベントを送信する（[design-decisions.md](./docs/design-decisions.md) 11.4）。ファイルパス、ファイル名、本文、ワークスペース情報、個人情報のいずれも送らない。Store版以外（開発ビルド、開発用に署名したパッケージ）では送信しない。クラッシュレポートの送信と、これ以外のテレメトリは実装対象外とする。

## 対象環境

- Windows 11（x64 / ARM64）
- Microsoft Edge WebView2 Runtime
- 配布形式: MSIX（Microsoft Store）

## 技術スタック

| レイヤー | 採用技術 |
| --- | --- |
| デスクトップシェル | Tauri v2 |
| Backend | Rust |
| Frontend | React + TypeScript + Vite |
| ツールチェーン | Bun |
| Markdown | unified（remark + rehype） |
| コード品質 | Biome、`tsc --noEmit`、Lefthook |
| パッケージング | MSIX、winapp CLI |

選定理由と却下理由は [design-decisions.md](./docs/design-decisions.md) の第4章に記載する。

## ドキュメント

| 文書 | 役割 | 更新責務 |
| --- | --- | --- |
| [docs/spec.md](./docs/spec.md) | プロダクト要件、機能要件、非機能要件、配布方針 | 要件が変わったときに更新する |
| [docs/design-decisions.md](./docs/design-decisions.md) | 設計判断と未決事項の**正本** | 設計判断を下したとき、未決事項の状態が変わったときに更新する |
| [docs/dev-flow.md](./docs/dev-flow.md) | 実装順序、フェーズごとの作業と完了条件の**正本** | フェーズの構成、着手順、完了条件が変わったときに更新する |
| [docs/uimock.html](./docs/uimock.html) | 画面構成の視覚参考（要件は定義しない） | 参考資料のため随時 |
| [tasks.md](./tasks.md) | 進捗とタスクの**正本** | タスクの着手・完了ごとに更新する |
| [CHANGELOG.md](./CHANGELOG.md) | 利用者から見た変更履歴 | リリースに影響する変更ごとに更新する |
| [SECURITY.md](./SECURITY.md) | 脆弱性の報告経路と想定する脅威 | 報告経路やサポート対象が変わったときに更新する |

記述が競合する場合は、設計判断について `design-decisions.md`、要件について `spec.md`、実装順序と完了条件について `dev-flow.md`、進捗について `tasks.md` を優先する。

## 開発

### 前提ツール

| ツール | バージョン | 用途 |
| --- | --- | --- |
| [Bun](https://bun.com/) | 1.4.0 | JavaScript依存関係の管理、Frontendのビルドとテスト |
| [Rust](https://www.rust-lang.org/) | 1.98.0 | Tauri backendのビルド（`rust-toolchain.toml` で固定） |
| [Tauri v2 の前提条件](https://v2.tauri.app/start/prerequisites/) | — | Visual Studio Build Tools、WebView2 Runtime |
| winapp CLI | 0.6.1 | MSIXの生成と署名（WinGet `Microsoft.WinAppCli`） |
| Windows SDK | 10.0.26100.0 | `makeappx`、`signtool`、Windows App Certification Kit |

各依存の初期バージョンは [design-decisions.md](./docs/design-decisions.md) の4.10に記載する。

### セットアップ

```sh
bun install
```

### コマンド

| コマンド | 内容 |
| --- | --- |
| `bun run tauri dev` | 開発用にアプリを起動する |
| `bun run tauri build` | Releaseビルドを生成する（MSIX生成は別工程） |
| `bun run build` | 型検査とFrontendのビルドを実行する |
| `bun run check` | BiomeでLintとFormattingを検査する |
| `bun run check:fix` | Biomeの自動修正を適用する |
| `bun run typecheck` | `tsc --noEmit` で型検査する |
| `bun test` | Frontendのテストを実行する |
| `bun run test:coverage` | テストを実行し、`coverage/lcov.info` を生成する |
| `bun run generate:licenses` | サードパーティライセンス一覧を生成する（`cargo-about` が必要） |
| `bun run check:icons` | `src-tauri/icons` が原本 `assets/app-icon.png` と一致するか検査する |

`bun test` はReactコンポーネントのDOMテストを含む。`bunfig.toml` のpreloadで `test/setup.ts` を読み込み、happy-domをグローバルへ登録したうえでTesting Libraryを使用する（[design-decisions.md](./docs/design-decisions.md) 14.5）。

Rust側は `src-tauri` で実行する。

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`tauri::generate_context!` が `frontendDist`（`dist/`）を埋め込むため、Rust側の検査を実行する前に一度 `bun run build` を実行しておく必要がある。

CIはカバレッジ計測を兼ねて `cargo test` の代わりに `cargo llvm-cov --lcov --output-path lcov.info` を実行する。ローカルで同じ計測を再現する場合は `cargo install cargo-llvm-cov` で導入する。

### MSIXパッケージング

MSIXは Tauri CLI ではなく winapp CLI で生成する。`tauri.conf.json` の `bundle.active` を `false` としているため、`tauri build` は実行ファイルのみを生成し、NSIS や MSI のインストーラーは作らない。

前提として winapp CLI を導入する。

```powershell
winget install --id Microsoft.WinAppCli --version 0.6.1 --exact
```

`scripts/build-msix.ps1` は実行前に `winapp --version` を照合し、`$requiredWinappVersion`（現在は 0.6.1）と一致しなければ失敗する。マニフェスト検証、PRI生成、署名の挙動がバージョンで変わり得るため、生成経路では常に同じバージョンを使う。

ARM64版をビルドする場合はRustのターゲットを追加する。

```sh
rustup target add aarch64-pc-windows-msvc
```

`scripts/build-msix.ps1` がReleaseビルドからパッケージレイアウトを組み立て、MSIXを生成する。

```powershell
./scripts/build-msix.ps1 -Architecture x64 -Sign
./scripts/build-msix.ps1 -Architecture arm64 -Sign
```

| オプション | 内容 |
| --- | --- |
| `-Architecture` | `x64` または `arm64`。ARM64はx64ホストからのクロスコンパイルで生成する |
| `-SkipBuild` | Releaseビルドを省略し、既存の成果物からパッケージだけを作り直す |
| `-Sign` | 開発用自己署名証明書で署名する。証明書がなければ生成する |

成果物は `build/msix/` に出力する。`-Sign` で生成する `devcert.pfx` はローカル検証とWACK専用で、Store配布には使えない。署名済みMSIXをインストールするには、証明書を一度だけ信頼ストアへ登録する（管理者権限が必要）。

```powershell
winapp cert install .\devcert.pfx
Add-AppxPackage .\build\msix\md-peruse_0.1.0.0_x64.msix
```

`Package.appxmanifest` は `packaging/Package.appxmanifest.template` から生成し、`ProcessorArchitecture` と `Version` をビルド時に置換する。Identity と PublisherDisplayName はPartner Centerの登録値と一致させること。

### アイコン

正方形アイコンの原本は `assets/app-icon.png`（1024x1024）の1点とし、各サイズは生成する。

```sh
bun run tauri icon assets/app-icon.png
```

Windows以外の生成物（`src-tauri/icons/android`、`ios`、`icon.icns`）は使用しないため削除する。

コミットしたアイコンが原本と一致することは `bun run check:icons` が検査する。CIの `Frontend` ジョブとpre-commitで自動実行されるため、原本を差し替えて生成を忘れた場合は検出される（[design-decisions.md](./docs/design-decisions.md) 13.1）。

横長タイル（`Wide310x150Logo`）は `tauri icon` が生成しないため、`scripts/generate-wide-logo.ps1` で生成する。原本は `assets/wide-logo.png`（3100x1500、比率2.0667）とする。

このスクリプトは `build-msix.ps1` がパッケージレイアウトへ直接出力するために呼ぶ。生成物をリポジトリへ置かないため、原本を更新したあとに生成を忘れて古いロゴを梱包することがない。原本の比率が2.0667から外れている場合、スクリプトは生成せず失敗する。

### Git Hooks

`bun install` の `prepare` スクリプトでLefthookがGit Hooksへ導入される。`lefthook.yml` に定義したpre-commitで、CIと同じ検査をコミット前に実行する。

| ジョブ | 対象 | 内容 |
| --- | --- | --- |
| `biome` | ステージした JS/TS/JSON/CSS/HTML | `biome check` |
| `typecheck` | ステージした TS/TSX | `tsc --noEmit` |
| `frontend-test` | ステージした TS/TSX | `bun test` |
| `rust-types` | ステージした Rust | `cargo test` の後に `src/types/generated` の差分を検査 |
| `icons` | ステージした `assets/app-icon.png` と `src-tauri/icons` | `bun run check:icons` |
| `rust-fmt` | ステージした Rust | `cargo fmt --check` |
| `rust-clippy` | ステージした Rust | `cargo clippy --all-targets -- -D warnings` |

### CI

`.github/workflows/ci.yml` がPull Requestと `main` へのpushで動作する。

| ジョブ | ランナー | 内容 |
| --- | --- | --- |
| `Frontend` | `ubuntu-latest` | `bun run check`、`bun run typecheck`、`bun run test:coverage`、`bun run build`、`bun run check:icons` |
| `Rust` | `windows-latest` | `cargo fmt --check`、`cargo clippy`、`cargo llvm-cov`（lcovをartifactへ保存） |
| `Coverage` | `ubuntu-latest` | Rustのlcovをダウンロードし、Codecovへアップロードする |
| `Licenses` | `ubuntu-latest` | ライセンス一覧を生成し、条文を取得できないパッケージがないことを検査する |

依存関係は `bun install --frozen-lockfile` で導入し、`bun.lock` と不整合があれば失敗させる。Rustのツールチェーンは `rust-toolchain.toml` の指定をrustupが解決する。

ライセンス一覧 `src/generated/third-party-licenses.json` はリポジトリへコミットせず、`bun.lock` と `Cargo.lock` から都度生成する。`Licenses` ジョブは `bun run generate:licenses` の実行を検査し、条文を取得できないパッケージがあれば失敗する。バージョンの正本をlockfileへ寄せることで、Renovateの依存更新で生成物が取り残されないようにしている（[design-decisions.md](./docs/design-decisions.md) 11.3）。

上流が条文を同梱していないパッケージは `licenses/overrides/<パッケージ名>/` に本文を配置する。配置がない場合は生成が失敗する。

カバレッジはFrontendとRustの両方でlcovを生成し、`codecov/codecov-action` でCodecovへアップロードする。認証はGitHub ActionsのOIDCを使い、upload tokenをリポジトリのsecretへ置かない。RustのlcovはWindowsのRustジョブがartifactとして保存し、`Coverage` ジョブ（ubuntu）がアップロードする（理由は [design-decisions.md](./docs/design-decisions.md) 4.11）。集計方針は `codecov.yml` に定義し、flagsを `frontend` と `rust` に分ける。Rustのテストは Phase 4 のコア実装と併せて追加するため、それまではステータスを `informational` としてPull Requestをブロックしない。

## 貢献

- コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) 形式とする。
- Pull Requestは300行程度を目安に分割する。分解が難しい場合は超えてよい。
- 変更内容に応じて `CHANGELOG.md` と `tasks.md` を更新する。
- `main` は保護されており、直接pushできない。CIの `Frontend`、`Rust`、`Coverage`、`Licenses` を通過し、レビュースレッドをすべて解決したPull Requestのみマージできる。
- 人が作成する変更は、CIの通過に加えてthread-owlのレビューとVerdictコメントを必須とする。マージ方式はsquashのみ。
- Renovateによる定型依存更新は、CIの通過をもってゲートとし自動マージする（独立レビューは求めない）。範囲と根拠は [design-decisions.md](./docs/design-decisions.md) 4.12「レビューの適用範囲」を参照。

## ライセンス

[MIT License](./LICENSE)
