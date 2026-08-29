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

[Unreleased]: https://github.com/scottlz0310/md-peruse/commits/main
