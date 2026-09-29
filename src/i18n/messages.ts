import type { LinkRejectionReason } from "../markdown/link-target";
import type { Language } from "../types/generated/Language";

/**
 * WebView内のUI文言（design-decisions.md 10.5）。
 *
 * ネイティブメニューとネイティブダイアログの文言、`IpcError.message` はRust側が持つ。ここに
 * 置くのは、Frontendだけが知る文言である。外部のi18nライブラリは使わない。対象は2言語であり、
 * 複数形や語順の入れ替えを要する文言も持たない。
 *
 * 言語ごとの表を `Record<Language, Messages>` で持つのは、言語を足したときの不足を
 * `tsc --noEmit` で検出するためである。文言を足したときの書き漏らしは、`Messages` の型が
 * 両方の言語に要求する。
 *
 * 開発者向けの例外（不変条件の違反など）の文言は、利用者へ見せないためここへ置かない。
 */
export type Messages = {
  /** ワークスペースを開いていないときの案内。 */
  welcome: string;
  breadcrumbLabel: string;
  explorerLabel: string;
  sidebarWidthLabel: string;
  tabListLabel: string;
  closeTab: (title: string) => string;
  treeLabel: string;
  treeLoading: string;
  /** 「md-peruse について」のダイアログ（バージョンとサードパーティライセンス。11.3）。 */
  about: {
    title: string;
    version: (version: string) => string;
    loading: string;
    loadFailed: (detail: string) => string;
    thirdPartyHeading: (count: number) => string;
    filterLabel: string;
    filterResult: (shown: number, total: number) => string;
    noMatches: string;
    sourceCode: string;
    close: string;
  };
  find: {
    inputLabel: string;
    previous: string;
    next: string;
    close: string;
    noMatches: string;
  };
  /** リンクを解決できなかった理由の表示文言。理由を増やしたときの漏れを型が検出する。 */
  linkRejection: Record<LinkRejectionReason, string>;
  highlightLoadFailed: (language: string) => string;
  mermaid: {
    tooManyInDocument: string;
    tooLarge: string;
    timeout: string;
    loadFailed: (detail: string) => string;
    renderFailed: (detail: string) => string;
  };
  math: {
    loadFailed: (detail: string) => string;
    tooLarge: string;
    invalid: (detail: string) => string;
  };
};

/**
 * 設定を読み込む前や、言語を与えない場面（テスト）で使う言語。
 *
 * 製品では、Appが設定の `effectiveLanguage` を読み込むまで描画しないため、この値は画面に
 * 出ない。
 */
export const DEFAULT_LANGUAGE: Language = "ja";

const ja: Messages = {
  welcome: "メニューの「ファイル」から「フォルダーを開く」を選んでください。",
  breadcrumbLabel: "パンくずリスト",
  explorerLabel: "エクスプローラー",
  sidebarWidthLabel: "サイドバーの幅",
  tabListLabel: "開いている文書",
  closeTab: (title) => `${title} を閉じる`,
  treeLabel: "ファイル",
  treeLoading: "読み込み中…",
  about: {
    title: "md-peruse について",
    version: (version) => `バージョン ${version}`,
    loading: "読み込み中…",
    loadFailed: (detail) => `ライセンス一覧を読み込めません（${detail}）。`,
    thirdPartyHeading: (count) => `サードパーティのライセンス（${count}件）`,
    filterLabel: "名前で絞り込む",
    filterResult: (shown, total) => `${shown} / ${total} 件`,
    noMatches: "一致する項目はありません。",
    sourceCode: "ソースコード",
    close: "閉じる",
  },
  find: {
    inputLabel: "文書内を検索",
    previous: "前の一致",
    next: "次の一致",
    close: "検索を閉じる",
    noMatches: "一致なし",
  },
  linkRejection: {
    emptyTarget: "リンク先が指定されていません。",
    malformedEncoding: "リンク先の表記を解釈できません。",
    invalidFileName: "リンク先のファイル名に使えない文字が含まれています。",
    schemeRelative: "この形式のリンクは開けません。",
    outsideRoot: "開いているフォルダーの外は表示できません。",
    notMarkdown: "Markdown以外のファイルへのリンクは開けません。",
  },
  highlightLoadFailed: (language) =>
    `${language} のハイライトを読み込めませんでした。プレーンなテキストで表示しています。`,
  mermaid: {
    tooManyInDocument: "1つの文書に図が多すぎるため描画していません。",
    tooLarge: "図が大きすぎるため描画していません。",
    timeout: "図の描画に時間がかかりすぎたため中断しました。",
    loadFailed: (detail) => `図の描画機能を読み込めませんでした（${detail}）。`,
    renderFailed: (detail) => `図を描画できません（${detail}）。`,
  },
  math: {
    loadFailed: (detail) =>
      `数式の描画機能を読み込めませんでした（${detail}）。`,
    tooLarge: "数式が大きすぎるため描画していません。",
    invalid: (detail) => `数式を解釈できません（${detail}）。`,
  },
};

/** 英語の書き方は、Rust側の英語の文言（`ipc/message.rs`、`menu.rs`）に揃える。 */
const en: Messages = {
  welcome: 'Choose "Open Folder..." from the "File" menu.',
  breadcrumbLabel: "Breadcrumbs",
  explorerLabel: "Explorer",
  sidebarWidthLabel: "Sidebar width",
  tabListLabel: "Open documents",
  closeTab: (title) => `Close ${title}`,
  treeLabel: "Files",
  treeLoading: "Loading...",
  about: {
    title: "About md-peruse",
    version: (version) => `Version ${version}`,
    loading: "Loading...",
    loadFailed: (detail) => `Cannot load the license list (${detail}).`,
    thirdPartyHeading: (count) => `Third-party licenses (${count})`,
    filterLabel: "Filter by name",
    filterResult: (shown, total) => `${shown} of ${total}`,
    noMatches: "No matching items.",
    sourceCode: "Source code",
    close: "Close",
  },
  find: {
    inputLabel: "Find in document",
    previous: "Previous match",
    next: "Next match",
    close: "Close find",
    noMatches: "No matches",
  },
  linkRejection: {
    emptyTarget: "The link has no target.",
    malformedEncoding: "The link target could not be parsed.",
    invalidFileName:
      "The link target contains characters that cannot be used in a file name.",
    schemeRelative: "This kind of link cannot be opened.",
    outsideRoot: "Cannot show anything outside the open folder.",
    notMarkdown: "Links to files other than Markdown cannot be opened.",
  },
  highlightLoadFailed: (language) =>
    `Could not load highlighting for ${language}. Showing plain text.`,
  mermaid: {
    tooManyInDocument:
      "Too many diagrams in one document. This diagram is not rendered.",
    tooLarge: "The diagram is too large and was not rendered.",
    timeout: "Rendering the diagram took too long and was stopped.",
    loadFailed: (detail) => `Could not load the diagram renderer (${detail}).`,
    renderFailed: (detail) => `Cannot render the diagram (${detail}).`,
  },
  math: {
    loadFailed: (detail) => `Could not load the math renderer (${detail}).`,
    tooLarge: "The formula is too large and was not rendered.",
    invalid: (detail) => `Cannot parse the formula (${detail}).`,
  },
};

export const MESSAGES: Record<Language, Messages> = { ja, en };
