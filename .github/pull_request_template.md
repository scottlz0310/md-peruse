## 概要

<!-- 何を、なぜ変更したかを1〜3行で記述する -->

## 変更内容

-

## 設計上の判断

<!--
設計上の選択を伴う場合に記述する。該当しない場合は「なし」と書く。
docs/design-decisions.md の記述を変更した場合は、その差分をここで説明する。
-->

## 関連

- Issue:
- tasks.md:

## 確認事項

- [ ] Conventional Commits 形式でコミットしている
- [ ] `CHANGELOG.md` を更新した（または記載方針の対象外である）
- [ ] `tasks.md` の関連タスクを更新した（または該当なし）
- [ ] フェーズ最後のタスクを閉じる場合、進捗サマリと `dev-flow.md` の完了条件も更新した（または該当なし）
- [ ] `bun run check` と `tsc --noEmit` が通る（Frontend変更時）
- [ ] `cargo fmt --check`、`cargo clippy -- -D warnings`、`cargo test` が通る（Rust変更時）
- [ ] 設計判断を変更した場合、`docs/design-decisions.md` へ反映した

## 影響範囲

<!-- Frontend / Rust / パッケージング / CI / ドキュメント のどこに影響するか -->

## 動作確認

<!-- 手元での確認手順と結果。UI変更がある場合はスクリーンショットを添付する -->
