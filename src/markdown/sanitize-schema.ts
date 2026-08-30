import type { Options as SanitizeSchema } from "rehype-sanitize";

/**
 * 画像用custom protocolのURL。Phase 1のスパイクで実測したオリジンに固定する
 * （design-decisions.md 5.4、13.4）。resource IDはBase64URLの文字種とする。
 */
const IMAGE_RESOURCE_URL = /^http:\/\/mdperuse-img\.localhost\/[A-Za-z0-9_-]+$/;

/** コードブロックの言語クラス。lowlightへ渡す言語名を伝える。 */
const LANGUAGE_CLASS = /^language-[a-z0-9+#-]+$/;

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
 * KaTeXが生成しうるMathMLノードの列挙に基づく。
 *
 * `hast-util-sanitize` はschemaを `{...defaultSchema, ...options}` として浅くマージするため、
 * 指定しないキーには既定値が入る。暗黙の継承を残さないよう全キーを明示する。
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
    // MathML（rehype-katexのmathml出力）
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
    th: [["align", "left", "center", "right"]],
    td: [["align", "left", "center", "right"]],
    // MathML
    math: ["display", "xmlns"],
    annotation: ["encoding"],
    mi: ["mathvariant"],
    mo: ["stretchy"],
    mover: ["accent"],
    munder: ["accentunder"],
    mstyle: ["displaystyle", "scriptlevel"],
    mtable: ["columnalign", "columnspacing", "rowspacing"],
  },
  // 相対リンクとアンカーはプロトコルを持たないため、ここへ書かずに通る。
  // `javascript:`、`data:`、`file:`、`ms-*` は列挙にないため除去される（7.2）。
  protocols: {
    href: ["http", "https"],
  },
  // 既定のclobber対策を明示する。`id` と `name` の衝突でDOM APIを汚染させない。
  clobber: ["ariaDescribedBy", "ariaLabelledBy", "id", "name"],
  clobberPrefix: "user-content-",
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
  // 列挙外の要素は中身ごと落とす。
  strip: ["script", "style"],
  allowComments: false,
  allowDoctypes: false,
};
