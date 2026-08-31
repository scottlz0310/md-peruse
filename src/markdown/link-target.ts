import { anchorElementId } from "./heading-id";

/**
 * リンクを解決できなかった理由。表示する文言はFrontendが呼び出しの文脈から決める
 * （design-decisions.md 12章）。
 */
export type LinkRejectionReason =
  /** 遷移先が空。`[a]()`、`[a](#)`、`[a](?x=1)` など。 */
  | "emptyTarget"
  /** パーセントエンコードが不正で復号できない。 */
  | "malformedEncoding"
  /** 復号したセグメントがWindowsのファイル名に使えない文字を含む。 */
  | "invalidFileName"
  /** `//host/share` 形式。スキーム相対URLであり、UNCパスにも見える。 */
  | "schemeRelative"
  /** `..` がルートを越える。ルート外のMarkdownは開かない（design-decisions.md 7.2）。 */
  | "outsideRoot"
  /** 対象拡張子（`.md`、`.markdown`）ではない。 */
  | "notMarkdown";

/** リンクの遷移先。 */
export type LinkTarget =
  /** 同一文書内の移動。 */
  | { readonly kind: "anchor"; readonly elementId: string }
  /** 別のMarkdown文書。`elementId` があれば描画完了後に移動する。 */
  | {
      readonly kind: "document";
      readonly path: string;
      readonly elementId: string | null;
    }
  /** OS既定ブラウザーで開く外部URL。 */
  | { readonly kind: "external"; readonly url: string }
  | { readonly kind: "rejected"; readonly reason: LinkRejectionReason };

export interface LinkContext {
  /**
   * リンクを含む文書のルート相対パス。区切りは `/` とし、ルート直下は `a.md` の形で表す
   * （IPCのパス表現と同じ。design-decisions.md 5.3、7.1）。
   */
  readonly documentPath: string;
}

/** ワークスペースルート基準のリンク（`/docs/a.md`）を示す接頭辞。 */
const ROOT_RELATIVE_PREFIX = "/";

/** スキーム相対URL。 */
const SCHEME_RELATIVE_PREFIX = "//";

/** `rehype-sanitize` が通すのは `http` と `https` だけである（design-decisions.md 8.2）。 */
const EXTERNAL_URL = /^https?:\/\//i;

/** 対象とするMarkdownの拡張子（design-decisions.md 6.3）。 */
const MARKDOWN_EXTENSION = /\.(?:md|markdown)$/i;

/**
 * Windowsのファイル名に使えない文字。
 *
 * `\` と `/` は、`%5C` や `%2F` を復号したセグメントにだけ現れる。パス区切りとして
 * 扱わずここで弾くことで、エンコードで区切りを隠したトラバーサルを断つ。`:` は
 * 代替データストリーム表記（`file.md:stream`）を兼ねて拒否する（design-decisions.md 7.1）。
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御文字を含む名前を拒否するための範囲指定である
const INVALID_FILE_NAME = /[\\/:*?"<>|\x00-\x1f]/;

/**
 * sanitizeを通過した `href` を遷移先へ解決する。
 *
 * 解決はワークスペース内の位置を論理的に求めるだけであり、パスの実在とファイル
 * システム上の境界はRust側が検証する（design-decisions.md 7.1）。ここでの拒否は、
 * IPCの往復を待たずに理由を示すためのものである。
 *
 * `data-footnote-ref` と `data-footnote-backref` を持つ脚注の相互参照リンクは、
 * IDが前置済みで対応しているため、この関数ではなく `footnoteElementId` で解決する。
 */
export function resolveLinkTarget(
  href: string,
  context: LinkContext,
): LinkTarget {
  if (href === "") return rejected("emptyTarget");
  if (href.startsWith(SCHEME_RELATIVE_PREFIX))
    return rejected("schemeRelative");
  if (EXTERNAL_URL.test(href)) return { kind: "external", url: href };

  const { path: rawPath, fragment } = split(href);
  if (rawPath === "") {
    const elementId = anchorElementId(fragment);
    if (elementId === null) {
      return rejected(fragment === "" ? "emptyTarget" : "malformedEncoding");
    }
    return { kind: "anchor", elementId };
  }

  const segments = rawPath.startsWith(ROOT_RELATIVE_PREFIX)
    ? []
    : parentSegments(context.documentPath);

  for (const segment of rawPath.split("/")) {
    // 先頭の `/`、連続する `/`、末尾の `/` は空のセグメントになる。
    if (segment === "") continue;

    const decoded = decodeSegment(segment);
    if (decoded === null) return rejected("malformedEncoding");
    if (decoded === ".") continue;
    if (decoded === "..") {
      if (segments.length === 0) return rejected("outsideRoot");
      segments.pop();
      continue;
    }
    if (INVALID_FILE_NAME.test(decoded)) return rejected("invalidFileName");
    segments.push(decoded);
  }

  const name = segments.at(-1);
  if (name === undefined || !MARKDOWN_EXTENSION.test(name)) {
    return rejected("notMarkdown");
  }

  if (fragment === "") {
    return { kind: "document", path: segments.join("/"), elementId: null };
  }
  const elementId = anchorElementId(fragment);
  if (elementId === null) return rejected("malformedEncoding");
  return { kind: "document", path: segments.join("/"), elementId };
}

/**
 * `href` をパスと断片へ分ける。
 *
 * クエリは捨てる。ファイルシステムにクエリの概念はなく、`?` はWindowsのファイル名に
 * 使えないため、`./a.md?x=1` は `./a.md` を指しているとみなせる。
 */
function split(href: string): { path: string; fragment: string } {
  const hashIndex = href.indexOf("#");
  const beforeHash = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf("?");
  const path = queryIndex === -1 ? beforeHash : beforeHash.slice(0, queryIndex);
  return { path, fragment };
}

/** リンクを含む文書があるディレクトリのセグメント列を返す。 */
function parentSegments(documentPath: string): string[] {
  const segments = documentPath.split("/").filter((segment) => segment !== "");
  segments.pop();
  return segments;
}

/**
 * パスのセグメントを1回だけ復号する。
 *
 * 復号はセグメントへ分けたあとに行う。パス全体を一括で復号すると、`..%2F..%2Fetc.md`
 * のように区切りをエンコードで隠したトラバーサルが成立する（design-decisions.md 7.2）。
 */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function rejected(reason: LinkRejectionReason): LinkTarget {
  return { kind: "rejected", reason };
}
