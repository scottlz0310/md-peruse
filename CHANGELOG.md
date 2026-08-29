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

### Changed

- Renovateの自動マージを再開。required status checkが揃ったため、`presets/options/automerge` を `extends` へ戻し、`renovate.json` のautomerge打ち消しを削除した。レビューの必須範囲（人が作成する変更とRenovateの定型更新の区別）を [design-decisions.md](./docs/design-decisions.md) 4.12 に定義した
- アプリアイコンをTauriテンプレートの既定から暫定デザインへ差し替え。原本を `assets/app-icon.svg` の1点とし、各サイズは `tauri icon` で生成する
- MSIX環境での動作をスパイクで実測し、設計判断を確定。設定の保存先はLocalStateへリダイレクトされずRoamingへ解決されるため、11.1の想定を実測に合わせて訂正した（[design-decisions.md](./docs/design-decisions.md) 5.4、5.5、6.4、11.1、13.4）

[Unreleased]: https://github.com/scottlz0310/md-peruse/commits/main
