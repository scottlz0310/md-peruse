/** 描画中の図に付ける属性。印刷の前に、描画が終わるのを待つ目印にする。 */
export const PENDING_ATTRIBUTE = "data-print-pending";

/** 図と画像の描画を待つ上限（ミリ秒）。超えたら、その時点の表示で印刷する。 */
export const SETTLE_TIMEOUT_MS = 10_000;

const POLL_INTERVAL_MS = 50;

/**
 * 印刷の前に、図と画像の描画が終わるのを待つ。
 *
 * 画像は `loading="lazy"` で描くため、画面外の画像は読み込まれていない。印刷では全文を
 * 出すので、先に読み込ませる。待つ対象は、描画中のMermaidの図（`PENDING_ATTRIBUTE`）と、
 * 読み込み中の画像である。読み込みに失敗した画像は待たない。
 *
 * 上限までに終わらなければ `false` を返す。待ち続けると、描画できない図や応答しない
 * 画像で印刷を始められなくなるため、その時点の表示で進める。
 */
export async function waitForSettled(
  root: ParentNode,
  timeoutMs: number = SETTLE_TIMEOUT_MS,
): Promise<boolean> {
  for (const image of root.querySelectorAll("img")) image.loading = "eager";
  const deadline = Date.now() + timeoutMs;
  while (!isSettled(root)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return true;
}

function isSettled(root: ParentNode): boolean {
  if (root.querySelector(`[${PENDING_ATTRIBUTE}]`) !== null) return false;
  for (const image of root.querySelectorAll("img")) {
    // 読み込みに失敗した画像は `complete` が真になる。
    if (!image.complete) return false;
  }
  return true;
}

/**
 * 表示中の文書を、WebView2の標準印刷プレビューで印刷する。
 *
 * 図と画像の描画を待ってから `window.print()` を呼ぶ。印刷用の図は、画面のテーマによらず
 * ライトの配色で描いてあるため（10.7）、印刷の状態へ切り替える処理は要らない。
 */
export async function printDocument(
  root: ParentNode,
  print: () => void = () => window.print(),
): Promise<void> {
  await waitForSettled(root);
  print();
}
