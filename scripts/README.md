# scripts

開発と保守の道具。CI へは載せない（実機の Release とユーザーの画面を使うため）。

| 道具 | 用途 |
| --- | --- |
| `build-msix.ps1`、`generate-licenses.ts`、`check-icons.ts`、`generate-wide-logo.ps1` | ビルドとパッケージ（README の各節を参照） |
| `capture-screen.ps1` | Store の掲載用スクリーンショットの撮影（ディスプレイの領域を PNG で保存する。手順は [docs/store-submission.md](../docs/store-submission.md) 6章） |
| [`perf/`](#perf性能測定) | 描画に関わる性能目標（spec.md 5.1）の測定 |
| [`devtools/`](#devtools実機の確認) | 実機での確認（ハイコントラスト、WebView2 の失敗、キーボード操作の照合） |

どの道具も、利用者の設定ファイルを退避し、終了後にバイト単位で戻して、ハッシュで確かめる。アプリの Release
（`bun run tauri build --no-bundle`。cargo のために、vcvars を通した PowerShell で実行する）と、Windows が前提である。`.ps1` は、PowerShell 7（`pwsh`）で実行する（文字コードが UTF-8 で BOM なしのため、Windows PowerShell 5.1 では日本語の文字列を読み違える）。

## perf（性能測定）

1. 測定用のワークスペースを、リポジトリの外に生成する（数百 MB になる。出力先は作り直される）。

   ```powershell
   bun scripts/perf/gen-workspace.ts $env:TEMP\md-peruse-ws
   ```

2. Release を作り、`run.ps1` で測る。`run.ps1` は、最後のワークスペースを測定用へ向けて、CDP 付きでアプリを起動し、
   指定のスクリプトを実行し、終了後に設定を戻す。

   ```powershell
   bun run tauri build --no-bundle
   scripts/perf/run.ps1 -Workspace $env:TEMP\md-peruse-ws -Script scripts/perf/measure.ts -ScriptArgs '--samples','10'
   scripts/perf/run.ps1 -Workspace $env:TEMP\md-peruse-ws -Script scripts/perf/measure.ts -ScriptArgs '--only','change','--out',"$env:TEMP\change.json"
   ```

| スクリプト | 内容 |
| --- | --- |
| `gen-workspace.ts` | 測定用の文書とフォルダーを生成する（サイズ別の文書、リスト主体、書式なしへ切り替わる上限の内外、1000項目のフォルダー） |
| `measure.ts` | 文書切り替え（`switch`）、ツリー展開（`tree`）、変更反映（`change`）を測る。`layout`（強制レイアウト。目標の判定に使う）と `frame`（次のフレーム）の中央値、95パーセンタイルを表示する |
| `trace.ts` | 文書の切り替えで、描画のメインスレッドの時間が、どの段階（レイアウト、ペイント、アクセシビリティ木の更新など）に使われたかを、Chromium のトレースで集計する。`--accessibility` で、アクセシビリティを有効にして測る |
| `cdp.ts` | 上のスクリプトが共有する、CDP への接続と、測定の式の組み立て |

測るときの注意（[design-decisions.md](../docs/design-decisions.md) 13.6）:

- アプリのウィンドウを前面に出し、ほかの操作をしない。無人・バックグラウンドでは、変更反映が約6秒遅れることがある。
- 判定は、同じ条件で連続して測った中央値で行う。高性能コアと効率コアが混在する CPU では、効率コアで動いた回が約1.8倍かかり、
  外れ値になる。原因を調べるときは、`run.ps1 -Affinity` で実行先を固定して比べる（Core i7-12700K は、Pコア `FFFF`、Eコア `F0000`）。
- 「次のフレームまで」は、アクセシビリティ木が有効な環境では、その更新が乗る。`trace.ts --accessibility` で内訳を見る。

## devtools（実機の確認）

| 道具 | 用途 |
| --- | --- |
| `app-session.ps1 start -Workspace <フォルダー> [-Cdp]` / `stop` | Release のアプリを、最後のワークスペースを指定して起動したままにし、止めるときに設定を戻す。ウィンドウの操作は、windows-mcp などで行う |
| `inspect.ts active` / `scroll <top>` | `-Cdp` で起動したアプリの、フォーカスのある要素（フォーカスの順序の照合）と、プレビューのスクロール位置 |
| `high-contrast.ps1 get\|on\|off` | OS のハイコントラストを、セッションの間だけ切り替える。**画面の色が変わるため、実行の前にユーザーの了承を得る**。確認後は必ず `off` にして、`get` で元のフラグに戻ったことを確かめる |
| `webview2-failure.ps1 -Case missing\|userdata [-DismissDialogs]` | 環境変数で、WebView2 が使えない状況（Runtime が見つからない、利用者データのフォルダーを使えない）を再現し、案内のダイアログの文言と、閉じた後の終了を確かめる |

キーボードだけでの操作を確認するときは、入力欄のクリックを使わない（文字は1文字ずつのキー入力で入れる）。フォルダー選択の
ダイアログで長いパスを打たないよう、ダイアログが開くフォルダーの下に短い名前の一時フォルダー（ジャンクション）を置き、
確認後に消す（Phase 4 の確認の手順。tasks.md）。

## store（Store への提出）

`scripts/store/` は、Microsoft Store へのパッケージの提出と、掲載情報の更新を、Submission API で行う。方針と使い方は [docs/store-submission.md](../docs/store-submission.md) 9章、判断の理由は [docs/design-decisions.md](../docs/design-decisions.md) 13.7。

```text
bun run store:submit --listing docs/assets/store
```

- 既定は dry-run（読み取りだけ）。`--apply` を付けたときだけ書き込む。`--apply --clone-only` は、申請（下書き）を作って複製の違いを表示するだけで止まり、`--no-commit` は更新まで行って commit しない（どちらも初回の確認用。作った下書きはあなたが「送信の削除」で消す）。
- GitHub Actions の Store Submit（`.github/workflows/store-submit.yml`）から呼ぶ。手動起動で、Environment `store-production` の承認を通ってから資格情報を使う。
- 認証の値は環境変数（`STORE_PRODUCT_ID`、`AZURE_AD_TENANT_ID`、`AZURE_AD_APPLICATION_CLIENT_ID`、`AZURE_AD_APPLICATION_SECRET`）で渡す。値はログに出さない。
- `--evidence-dir <フォルダー>` で、実走の証跡（呼び出しのトレース、申請の JSON、PUT の本文と応答、失敗の内容）を保存する。資格情報と署名つき URL は取り除く。ワークフローは、これを artifact にする（失敗しても残す。保存期間 90 日）。ファイルの一覧と読み方は、[docs/store-submission.md](../docs/store-submission.md) 9.8。
- API で作った申請は、以後 Partner Center の画面で変更しない。
- テストは `bun test scripts/store`。`fetch` とファイルの読み込みは注入式で、ネットワークには出ない。
