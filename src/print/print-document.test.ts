import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  PENDING_ATTRIBUTE,
  printDocument,
  waitForSettled,
} from "./print-document";
import { setPrinting } from "./print-state";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  root.remove();
  setPrinting(false);
});

test("図と画像が描画済みなら、待たずに終わる", async () => {
  root.innerHTML = `<p>text</p>`;
  expect(await waitForSettled(root, 100)).toBe(true);
});

test("描画中の図が残ったまま上限に達したら、false を返す", async () => {
  root.innerHTML = `<pre ${PENDING_ATTRIBUTE}></pre>`;
  expect(await waitForSettled(root, 120)).toBe(false);
});

test("描画中の図が終わるのを待つ", async () => {
  root.innerHTML = `<pre ${PENDING_ATTRIBUTE}></pre>`;
  setTimeout(
    () => root.querySelector("pre")?.removeAttribute(PENDING_ATTRIBUTE),
    80,
  );
  expect(await waitForSettled(root, 2000)).toBe(true);
});

test("画面外の画像も先に読み込ませる", async () => {
  root.innerHTML = `<img loading="lazy" alt="a">`;
  await waitForSettled(root, 50);
  expect(root.querySelector("img")?.loading).toBe("eager");
});

test("印刷は描画を待ってから呼び、afterprint で状態を戻す", async () => {
  const calls: string[] = [];
  await printDocument(root, () => calls.push("print"));
  expect(calls).toEqual(["print"]);
  window.dispatchEvent(new Event("afterprint"));
});

test("印刷の呼び出しが失敗したら状態を戻して例外を伝える", async () => {
  await expect(
    printDocument(root, () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
});
