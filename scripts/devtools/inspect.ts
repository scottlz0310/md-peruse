/**
 * 起動済みのアプリ（`app-session.ps1 start -Cdp`）の状態を、CDP で読む・少しだけ動かす。
 * 実機をキーボードで操作して確認するときの、操作の結果の照合に使う（フォーカスの順序、スクロール位置）。
 *
 * 使い方:
 *   bun scripts/devtools/inspect.ts active          # フォーカスのある要素（タグ、role、名前、href）
 *   bun scripts/devtools/inspect.ts scroll <top>    # プレビューの scrollTop を設定する（長い文書の途中を見るため）
 */
import { connect } from "../perf/cdp";

const [command, argument] = process.argv.slice(2);
const cdp = await connect();

if (command === "active") {
  console.log(
    await cdp.evaluate<string | null>(`(() => {
      const e = document.activeElement;
      if (!e) return null;
      const text = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40);
      const role = e.getAttribute('role') || '';
      const cls = typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '';
      return e.tagName.toLowerCase() + cls + ' role=' + role + ' [' + text + '] href=' + (e.getAttribute('href') || '');
    })()`),
  );
} else if (command === "scroll") {
  console.log(
    await cdp.evaluate<string>(`(() => {
      let e = document.querySelector('.markdown-body');
      while (e && !['auto', 'scroll'].includes(getComputedStyle(e).overflowY)) e = e.parentElement;
      if (!e) return 'スクロール領域が無い';
      e.scrollTop = ${Number(argument ?? 0)};
      return e.scrollTop + ' / ' + e.scrollHeight;
    })()`),
  );
} else {
  console.error(
    "使い方: bun scripts/devtools/inspect.ts active | scroll <top>",
  );
  process.exitCode = 1;
}
cdp.close();
process.exit(process.exitCode ?? 0);
