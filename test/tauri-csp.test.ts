import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

/**
 * 実アプリのCSP（design-decisions.md 5.5）を固定する。
 *
 * CSPの文字列は `src-tauri/tauri.conf.json` が正本で、Tauriは書き換えを検査しない。
 * `data:` を足した理由（印刷用の図の背景。10.7）以外の緩和が、気付かれずに入らないよう、
 * ディレクティブごとの許可元を並べて比較する。
 */
const conf = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
) as { app: { security: { csp: string } } };

function parse(csp: string): Record<string, string[]> {
  const directives: Record<string, string[]> = {};
  for (const part of csp.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives[name] = sources;
  }
  return directives;
}

test("CSPのディレクティブと許可元は、5.5の記録と一致する", () => {
  expect(parse(conf.app.security.csp)).toEqual({
    "default-src": ["'none'"],
    "script-src": ["'self'"],
    "style-src-elem": ["'self'", "'unsafe-inline'"],
    "style-src-attr": ["'none'"],
    // `data:` は、印刷用の図の背景（`<style>` 要素の `url(data:...)`）のために許可する（10.7）。
    // 本文の画像は、sanitize が専用プロトコルの形だけを通す（7.3）。
    "img-src": ["'self'", "data:", "http://mdperuse-img.localhost"],
    "font-src": ["'none'"],
    "connect-src": ["'self'", "ipc:", "http://ipc.localhost"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
  });
});

test("`data:` を許可するのは img-src だけである", () => {
  const withData = Object.entries(parse(conf.app.security.csp))
    .filter(([, sources]) => sources.includes("data:"))
    .map(([name]) => name);
  expect(withData).toEqual(["img-src"]);
});
