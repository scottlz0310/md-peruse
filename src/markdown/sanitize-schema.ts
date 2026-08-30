import type { Options as SanitizeSchema } from "rehype-sanitize";

/**
 * 画像用custom protocolのURL。Phase 1のスパイクで実測したオリジンに固定する
 * （design-decisions.md 5.4、13.4）。resource IDはBase64URLの文字種とする。
 */
const IMAGE_RESOURCE_URL = /^http:\/\/mdperuse-img\.localhost\/[A-Za-z0-9_-]+$/;

/** コードブロックの言語クラス。lowlightへ渡す言語名を伝える。 */
const LANGUAGE_CLASS = /^language-[a-z0-9+#-]+$/;

/** MathMLの色。LaTeXの `\color` などで指定された値が入る。 */
const MATHML_COLOR = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)$/;

/** MathMLの長さ。LaTeXの `\hspace` などで指定された値が入る。 */
const MATHML_LENGTH = /^[+-]?[0-9]*\.?[0-9]+(em|ex|px|pt|pc|cm|mm|in|%)?$/;

/**
 * MathML要素へ共通で許可する属性。
 *
 * KaTeX 0.16 が `setAttribute` で設定しうる属性から、`style`、`href`、`src`、`d`、
 * `alt`、`title` を除いて列挙する。`style` は8.2の方針で許可せず、`href` は `trust`
 * 無効化により生成されず（8.5）、`src` と `alt` は `mglyph` 専用でその要素自体を
 * 許可しない。`d` はSVGの `path` 用で、MathML出力では現れない。
 *
 * 色と長さは値のパターンで制限する。利用者はLaTeXへ任意の文字列を書けるため、
 * 属性名を許可するだけでは値を絞れない。
 */
const MATHML_ATTRIBUTES: Array<string | [string, RegExp]> = [
  "accent",
  "accentunder",
  "columnalign",
  "columnlines",
  "columnspacing",
  ["depth", MATHML_LENGTH],
  "display",
  "displaystyle",
  "encoding",
  "fence",
  ["height", MATHML_LENGTH],
  "largeop",
  "linebreak",
  ["linethickness", MATHML_LENGTH],
  ["lspace", MATHML_LENGTH],
  ["mathbackground", MATHML_COLOR],
  ["mathcolor", MATHML_COLOR],
  "mathsize",
  "mathvariant",
  ["maxsize", MATHML_LENGTH],
  ["minsize", MATHML_LENGTH],
  "notation",
  "rowlines",
  "rowspacing",
  ["rspace", MATHML_LENGTH],
  "scriptlevel",
  "separator",
  "stretchy",
  "valign",
  ["voffset", MATHML_LENGTH],
  ["width", MATHML_LENGTH],
  "xmlns",
];

/** `rehype-katex` の `output: "mathml"` が生成しうる要素。 */
const MATHML_TAGS = [
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "mspace",
  "mfrac",
  "msqrt",
  "mroot",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mstyle",
  "mpadded",
  "mphantom",
  "menclose",
  "mtable",
  "mtr",
  "mtd",
];

/** 表の桁揃え。`remark-gfm` が生成する値に限る。 */
const TABLE_ALIGN: [string, string, string, string] = [
  "align",
  "left",
  "center",
  "right",
];

/**
 * 本文描画に使う `rehype-sanitize` のschema。
 *
 * 既定schema（GitHub相当）を出発点とせず、パイプラインが実際に生成する要素だけを
 * 列挙する。既定schemaは53タグと66個のグローバル属性を許可し、`action` のように
 * Raw HTMLを前提とした到達しない許可を含む。本アプリはRaw HTMLをテキストとして
 * 出力するため（8.1）、それらは不要であり、「暗黙の許可を作らない」方針（8.2）に
 * 沿って全列挙する。
 *
 * 列挙はremark-gfm、remark-math、rehype-katex（`output: "mathml"`）を通した実測と、
 * KaTeXが生成しうるMathMLノードおよび属性の列挙に基づく。
 *
 * `hast-util-sanitize` はschemaを `{...defaultSchema, ...options}` として浅くマージ
 * するため、指定しないキーには既定値が入る。暗黙の継承を残さないよう全キーを明示する。
 */
export const sanitizeSchema: SanitizeSchema = {
  // 明示した要素以外はすべて除去される。
  tagNames: [
    // 見出しと段落
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    // 強調とインライン
    "strong",
    "em",
    "del",
    "code",
    "span",
    "sup",
    // リンクと画像
    "a",
    "img",
    // リスト
    "ul",
    "ol",
    "li",
    "input",
    // 引用とコードブロック
    "blockquote",
    "pre",
    // 表
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    // 脚注（remark-gfm）
    "section",
    ...MATHML_TAGS,
  ],
  attributes: {
    a: [
      "href",
      "id",
      "className",
      // 脚注の相互参照（remark-gfm）
      "ariaDescribedBy",
      "ariaLabel",
      "dataFootnoteRef",
      "dataFootnoteBackref",
    ],
    // 見出しアンカーの移動先（8.2）
    h1: ["id"],
    h2: ["id"],
    h3: ["id"],
    h4: ["id"],
    h5: ["id"],
    h6: ["id"],
    // ハイライト対象言語の伝達（8.2）
    code: [["className", LANGUAGE_CLASS]],
    // 画像はcustom protocolのURLに限る。リモート画像と `data:` を遮断する（7.3）
    img: [["src", IMAGE_RESOURCE_URL], "alt", "title"],
    // GFMタスクリスト。操作不可の表示に限る（8.2）
    input: [["type", "checkbox"], "checked", "disabled"],
    li: ["id", "className"],
    ul: ["className"],
    // 脚注セクション
    section: ["className", "dataFootnotes"],
    // KaTeXのMathMLラッパ
    span: ["className"],
    // 表の桁揃え
    th: [TABLE_ALIGN],
    td: [TABLE_ALIGN],
    ...Object.fromEntries(MATHML_TAGS.map((tag) => [tag, MATHML_ATTRIBUTES])),
  },
  // 相対リンクとアンカーはプロトコルを持たないため、ここへ書かずに通る。
  // `javascript:`、`data:`、`file:`、`ms-*` は列挙にないため除去される（7.2）。
  protocols: {
    href: ["http", "https"],
  },
  // 祖先を要求する要素。表の構成要素が単独で現れた場合に除去する。
  ancestors: {
    tbody: ["table"],
    td: ["table"],
    th: ["table"],
    thead: ["table"],
    tr: ["table"],
  },
  // タスクリストのcheckboxは常に操作不可とする（8.2）。
  // ここを指定しないと既定schemaの `required` が暗黙に適用される。
  required: {
    input: { type: "checkbox", disabled: true },
  },
  // idへの前置は行わない。`mdast-util-to-hast` が脚注の `id` と `href` の双方へ
  // 既に `user-content-` を付けており、ここで再度前置すると `id` だけが
  // `user-content-user-content-fn-1` となって参照が壊れる。sanitizeは `href` を
  // 書き換えないため、前置の担当は上流へ一本化する（design-decisions.md 8.2）。
  clobber: [],
  clobberPrefix: "",
  // 列挙外の要素は中身ごと落とす。
  strip: ["script", "style"],
  allowComments: false,
  allowDoctypes: false,
};
