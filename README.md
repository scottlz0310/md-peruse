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

編集機能、ファイル書き込み、ネットワークアクセス、テレメトリは実装対象外とする。

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

`bun test` はテスト構成をPhase 2で確立するまでテストファイルを持たないため、現時点ではテストファイルが見つからず失敗する。CIへ組み込むのはテスト追加後とする。

Rust側は `src-tauri` で実行する。

```sh
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`tauri::generate_context!` が `frontendDist`（`dist/`）を埋め込むため、Rust側の検査を実行する前に一度 `bun run build` を実行しておく必要がある。

MSIXは Tauri CLI ではなく winapp CLI で生成する。`tauri.conf.json` の `bundle.active` を `false` としているため、`tauri build` は実行ファイルのみを生成し、NSIS や MSI のインストーラーは作らない。

### Git Hooks

`bun install` の `prepare` スクリプトでLefthookがGit Hooksへ導入される。`lefthook.yml` に定義したpre-commitで、CIと同じ検査をコミット前に実行する。

| ジョブ | 対象 | 内容 |
| --- | --- | --- |
| `biome` | ステージした JS/TS/JSON/CSS/HTML | `biome check` |
| `typecheck` | ステージした TS/TSX | `tsc --noEmit` |
| `rust-fmt` | ステージした Rust | `cargo fmt --check` |
| `rust-clippy` | ステージした Rust | `cargo clippy --all-targets -- -D warnings` |

### CI

`.github/workflows/ci.yml` がPull Requestと `main` へのpushで動作する。

| ジョブ | ランナー | 内容 |
| --- | --- | --- |
| `Frontend` | `ubuntu-latest` | `bun run check`、`bun run typecheck`、`bun run build` |
| `Rust` | `windows-latest` | `cargo fmt --check`、`cargo clippy`、`cargo test` |

依存関係は `bun install --frozen-lockfile` で導入し、`bun.lock` と不整合があれば失敗させる。Rustのツールチェーンは `rust-toolchain.toml` の指定をrustupが解決する。

カバレッジの集計方針は `codecov.yml` に定義する。テスト構成をPhase 2で確立するまでCIからのアップロードは行わないため、ステータスは `informational` としてPull Requestをブロックしない。

## 貢献

- コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/) 形式とする。
- Pull Requestは300行程度を目安に分割する。分解が難しい場合は超えてよい。
- 変更内容に応じて `CHANGELOG.md` と `tasks.md` を更新する。
- `main` は保護されており、直接pushできない。CIの `Frontend` と `Rust` を通過し、レビュースレッドをすべて解決したPull Requestのみマージできる。
- マージ方式はsquashのみ。依存関係の更新はRenovateが自動マージする（CIの通過が前提）。

## ライセンス

[MIT License](./LICENSE)
