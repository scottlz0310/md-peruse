import type { Language } from "../types/generated/Language";

type Section = {
  id: string;
  title: string;
  paragraphs: string[];
  steps?: string[];
  example?: string;
  diagram?: "layout" | "tabs" | "updates";
};
type HelpContent = {
  title: string;
  intro: string;
  contents: string;
  close: string;
  sections: Section[];
  shortcutsTitle: string;
  shortcuts: [string, string][];
  diagram: {
    folder: string;
    tree: string;
    tabs: string;
    breadcrumb: string;
    document: string;
    preview: string;
    pinned: string;
    click: string;
    doubleClick: string;
    editor: string;
    save: string;
    watch: string;
    refresh: string;
    captions: Record<"layout" | "tabs" | "updates", string>;
  };
};

export const HELP: Record<Language, HelpContent> = {
  ja: {
    title: "md-peruse の使い方",
    intro:
      "AIや外部エディターが更新するMarkdownを、編集せずに読み、確認するためのガイドです。このガイドと図解はアプリに同梱され、インターネット接続なしで使えます。",
    contents: "目次",
    close: "閉じる",
    sections: [
      {
        id: "start",
        title: "はじめに：最初の文書を開く",
        diagram: "layout",
        paragraphs: [
          "Markdownのあるフォルダーをワークスペースとして開きます。ツリーに表示するのはフォルダーと .md / .markdown のファイルです。",
        ],
        steps: [
          "「ファイル」→「フォルダーを開く…」（Ctrl+O）でフォルダーを選びます。",
          "左のツリーでフォルダーを展開し、文書を1回クリックしてプレビューします。",
          "読み続ける文書はダブルクリックしてタブを固定します。本文は選択・コピーできますが、編集できません。",
        ],
        example:
          "例：設計書フォルダーを開き、README.mdをクリックして概要を読み、docs/設計.mdをダブルクリックして確認用に残します。",
      },
      {
        id: "workspace",
        title: "ワークスペース・ツリー・パンくず",
        paragraphs: [
          "「ファイル」→「最近使ったフォルダー」や開始画面の一覧から、直近のフォルダーを開けます。最大10件です。起動時には最後のワークスペースを復元しますが、タブ・選択中の文書・スクロール位置は復元しません。",
          "ツリーは上下キーで移動、右キーで展開、左キーで折りたたみ・親へ移動します。Home / Endは先頭・末尾へ移動し、Spaceはプレビュー、Enterは固定タブで開きます。",
          "タブの下のパンくずで上位フォルダーを選ぶと、その場所をツリーに表示します。ワークスペース外の文書にはツリーを持ちません。「ファイル」→「ワークスペースを閉じる」はタブも閉じ、監視を止めます。",
          "隠し項目、reparse point、依存関係・ビルド成果物などのフォルダーはツリーに表示しません。表示されない文書の場所や権限を確認してください。",
        ],
      },
      {
        id: "open-files",
        title: "関連付け・ドロップ・ワークスペース外の文書",
        paragraphs: [
          "ExplorerでMarkdownをmd-peruseに関連付けて開くか、ファイルをアプリにドロップします。複数のMarkdownも開けます。フォルダーのドロップはワークスペースを切り替えます。",
          "ワークスペース外の文書は独立したタブ（loose tab）で開きます。所在フォルダーをリンクと画像の基準にし、そのフォルダーのツリーは表示しません。",
          "アプリの起動中に別の文書を関連付けから開くと、既存ウィンドウへ渡して前面化します。同じ文書を重複したタブで開きません。",
        ],
        example:
          "例：AIが書き出した別フォルダーの結果.mdをドロップし、設計書のワークスペースを残したまま比較します。",
      },
      {
        id: "tabs",
        title: "プレビュー・固定タブ・閉じ方",
        diagram: "tabs",
        paragraphs: [
          "シングルクリックやSpaceで開くプレビュータブは斜体です。次のプレビューはそのタブを差し替えます。固定タブはダブルクリック・Enter・タブのダブルクリックで作れます。文書内のリンクで移動したときも固定されます。",
          "タブをクリック、Ctrl+Tab / Ctrl+Shift+Tabで切り替えます。タブにフォーカスがあると左右キー、Home / Endでも切り替えます。×ボタン、中クリック、Ctrl+Wで閉じます。",
          "最大20タブです。上限を超えると、最も長く使っていない非アクティブタブを閉じます。フォルダーを開き直すと、通常タブとloose tabの両方を閉じます。",
        ],
        example:
          "例：候補を順に1回クリックして読み、比較したい2文書だけをダブルクリックで固定します。",
      },
      {
        id: "updates",
        title: "AI・外部エディターの更新を読む",
        diagram: "updates",
        paragraphs: [
          "md-peruseは閲覧専用です。AIや外部エディターで保存された変更を監視し、表示中の文書を自動更新します。タブを切り替えたときは必要な変更を反映します。",
          "「表示」→「再読み込み」（F5）で表示中の文書を読み直せます。監視停止の案内が出たら、ワークスペースを開き直してください。",
          "削除・移動されたファイルはタブに「削除済み」と表示し、最後に読めた本文があれば保持します。自動で移動先へ追従するとは限りません。移動先をツリーやドロップから開き直してください。",
        ],
        example:
          "例：仕様.mdを固定してAIに更新を依頼し、保存後の本文を確認します。期待した変更が見えなければF5で再読み込みします。",
      },
      {
        id: "reading",
        title: "検索・リンク・図・数式・コード",
        paragraphs: [
          "Ctrl+Fで文書内を検索します。F3 / Shift+F3で次／前の一致へ移動し、Escで検索を閉じます。検索対象は現在表示している本文で、ツリーのファイル名や他の文書ではありません。",
          "相対リンクは同じスコープのMarkdownへ移動します。見出しリンクは本文内を移動します。Alt+← / Alt+→、マウスのサイドボタンで戻る／進む操作を行います。HTTP / HTTPSリンクは既定ブラウザーで開きます。",
          "Mermaid図、数式、言語を指定したコードブロックを表示します。図や数式の構文エラーはその位置に表示されます。複雑すぎる文書は、書式を付けずに表示する場合があります。",
        ],
      },
      {
        id: "appearance",
        title: "テーマ・言語・文字サイズ・サイドバー",
        paragraphs: [
          "「表示」→「テーマ」でシステム・ライト・ダークを選びます。「表示」→「言語」でシステム・日本語・Englishを選びます。ヘルプも現在の表示言語に切り替わります。",
          "「表示」の文字サイズ項目やCtrl+= / Ctrl+- / Ctrl+0で本文の文字サイズを変更・リセットします。Ctrl++やテンキーの加減キーも使えます。",
          "Ctrl+Bでサイドバーの表示を切り替えます。境界をドラッグして幅を変え、境界にTabでフォーカスしたときは左右キー、Home / Endでも調整できます。表示設定は次回へ引き継ぎます。",
        ],
      },
      {
        id: "ai",
        title: "文書の場所をAIへ渡す",
        paragraphs: [
          "ツリーのファイル・フォルダー、または文書タブを右クリックし、「絶対パスをコピー」を選びます。フォーカスした対象ではShift+F10・メニューキーでも開けます。メニューの上下キーで選び、Enterでコピー、Escで閉じます。",
          "ワークスペース内では「ワークスペース相対パスをコピー」も選べます。loose tabは絶対パスだけです。引用符や改行を付けないプレーンテキストをコピーします。日本語と空白を保持し、相対パスは / 区切りです。",
          "右クリックした対象をコピーします。メニューを開くだけでは文書を開く・タブを切り替える・フォルダーを展開する操作は起きません。画面の「パスをコピーしました。」で成功を確認します。削除・移動された対象や使用中のクリップボードは失敗の理由を表示します。",
        ],
        example:
          "例：docs/設計.mdで相対パスをコピーし、AIへ「このリポジトリの docs/設計.md を読み、状態遷移を確認してください」と依頼します。別フォルダーの文書には絶対パスを使います。",
      },
      {
        id: "troubleshooting",
        title: "制約・読込エラーへの対処",
        paragraphs: [
          "本文の編集はできません。外部の画像は読み込みません。相対リンクや画像はワークスペース、またはloose tabの所在フォルダーの境界内に限ります。境界外のリンク先は関連付けやドロップで別のタブとして開いてください。",
          "読込エラーはファイルの実在・権限・他のアプリのロックを確認し、必要に応じて再読み込みします。本文はUTF-8、またはBOM付きUTF-16で保存してください。10 MiBを超えるMarkdownは開けません。",
          "文書全体を描画できない場合は表示された理由を確認し、外部エディターで構文や文書サイズを見直します。図・数式・画像だけのエラーは、その要素を確認してください。",
          "このヘルプは「ヘルプ」→「使い方」からいつでも開けます。アプリと同じバージョンの内容を同梱し、ネットワークから取得しません。外部リンクやStoreの更新には接続が必要です。",
        ],
      },
    ],
    shortcutsTitle: "主要ショートカット",
    shortcuts: [
      ["Ctrl+O", "フォルダーを開く"],
      ["Ctrl+W", "アクティブタブを閉じる"],
      ["Ctrl+Tab / Ctrl+Shift+Tab", "次／前のタブ"],
      ["F5", "文書の再読み込み"],
      ["Ctrl+F", "文書内検索"],
      ["F3 / Shift+F3", "次／前の一致"],
      ["Alt+← / Alt+→", "戻る／進む"],
      ["Ctrl+B", "サイドバー表示切り替え"],
      ["Ctrl+= / Ctrl+- / Ctrl+0", "本文の拡大／縮小／リセット"],
      ["Shift+F10 / メニューキー", "対象のパスコピーメニュー"],
      ["Esc", "検索・メニュー・ヘルプを閉じる"],
    ],
    diagram: {
      folder: "設計書",
      tree: "① ツリー",
      tabs: "② タブ",
      breadcrumb: "③ パンくず",
      document: "④ 本文",
      preview: "プレビュー（斜体）",
      pinned: "固定タブ",
      click: "1回クリック / Space",
      doubleClick: "ダブルクリック / Enter",
      editor: "AI・外部エディター",
      save: "保存",
      watch: "変更を監視",
      refresh: "本文を自動更新",
      captions: {
        layout:
          "画面構成の図解：左のツリーから文書を開くと、右側にタブ・パンくず・本文を表示します。",
        tabs: "操作の図解：1回クリックは差し替わるプレビュー、ダブルクリックは比較用に残す固定タブです。",
        updates:
          "更新の図解：外部で保存された変更を監視し、閲覧中の本文へ反映します。",
      },
    },
  },
  en: {
    title: "How to use md-peruse",
    intro:
      "Read and review Markdown updated by AI or an external editor without editing it. This guide and its diagrams are bundled with the app and work without an internet connection.",
    contents: "Contents",
    close: "Close",
    sections: [
      {
        id: "start",
        title: "Getting started: open your first document",
        diagram: "layout",
        paragraphs: [
          "Open a folder containing Markdown as your workspace. The tree shows folders and .md / .markdown files.",
        ],
        steps: [
          "Choose File → Open Folder... (Ctrl+O), then select a folder.",
          "Expand a folder in the tree on the left and click a document once to preview it.",
          "Double-click a document to keep it in a pinned tab. You can select and copy the text, but cannot edit it.",
        ],
        example:
          "Example: open your documentation folder, click README.md to read the overview, and double-click docs/design.md to keep it open for review.",
      },
      {
        id: "workspace",
        title: "Workspace, tree and breadcrumbs",
        paragraphs: [
          "Use File → Recent Folders or the list on the welcome screen to reopen a recent workspace (up to 10). The app restores your last workspace on startup, but does not restore tabs, the selected document or scroll positions.",
          "In the tree, use Up / Down to move, Right to expand, and Left to collapse or move to the parent. Home / End move to the first / last item. Space previews a document; Enter opens a pinned tab.",
          "Choose a parent folder in the breadcrumb below the tabs to reveal it in the tree. Documents outside the workspace have no tree. File → Close Workspace closes all tabs and stops watching the folder.",
          "Hidden items, reparse points, dependency folders and build outputs are excluded from the tree. If a document is missing, check its location and permissions.",
        ],
      },
      {
        id: "open-files",
        title: "File associations, dropping files and loose tabs",
        paragraphs: [
          "Open Markdown from Explorer using its md-peruse file association, or drop files onto the app. You can open multiple Markdown files. Dropping a folder switches the workspace.",
          "A document outside the workspace opens in a separate loose tab. Its containing folder is the boundary for links and images; no tree is shown for that folder.",
          "Opening another document through a file association while md-peruse is running forwards it to the existing window and brings that window to the front. The same document does not get duplicate tabs.",
        ],
        example:
          "Example: drop result.md from another folder to compare an AI output while keeping your documentation workspace.",
      },
      {
        id: "tabs",
        title: "Preview tabs, pinned tabs and closing",
        diagram: "tabs",
        paragraphs: [
          "A single click or Space opens an italic preview tab. The next preview replaces it. Double-click a document, press Enter, or double-click its tab to pin it. Following a link within the document also pins the tab.",
          "Click a tab, or use Ctrl+Tab / Ctrl+Shift+Tab to switch. With focus on a tab, Left / Right and Home / End also switch tabs. Close with ×, a middle click or Ctrl+W.",
          "Up to 20 tabs are kept. Opening another closes the least recently used inactive tab. Reopening a folder closes both workspace tabs and loose tabs.",
        ],
        example:
          "Example: single-click candidate documents to browse them, then double-click the two documents you want to compare.",
      },
      {
        id: "updates",
        title: "Read updates from AI or an external editor",
        diagram: "updates",
        paragraphs: [
          "md-peruse is read-only. It watches changes saved by AI or an external editor and refreshes the visible document. Other tabs reflect pending changes when you switch to them.",
          "Choose View → Reload (F5) to read the current document again. If watching stops, reopen the workspace.",
          "A deleted or moved file is marked Deleted. Its last readable content is kept when available. The app may not follow a moved file automatically: reopen its new location from the tree or by dropping it.",
        ],
        example:
          "Example: pin specification.md, ask AI to update it, and review the saved result. Press F5 if an expected update is missing.",
      },
      {
        id: "reading",
        title: "Search, links, diagrams, math and code",
        paragraphs: [
          "Ctrl+F searches the visible document. F3 / Shift+F3 move to the next / previous match; Esc closes search. Search does not include tree file names or other documents.",
          "Relative links open Markdown within the same scope. Heading links move within the document. Use Alt+Left / Alt+Right or mouse side buttons to go back / forward. HTTP / HTTPS links open in your default browser.",
          "Mermaid diagrams, math and code blocks with an explicit language are rendered. Diagram or math syntax errors appear in place. Very complex documents may be displayed as plain text.",
        ],
      },
      {
        id: "appearance",
        title: "Theme, language, text size and sidebar",
        paragraphs: [
          "Choose View → Theme to select System, Light or Dark. Choose View → Language for System, 日本語 or English. Help follows the current display language.",
          "Use the font-size items under View, or Ctrl+= / Ctrl+- / Ctrl+0, to enlarge, shrink or reset document text. Ctrl++ and the numeric keypad add / subtract keys also work.",
          "Ctrl+B toggles the sidebar. Drag its divider to adjust the width. When the divider has keyboard focus, use Left / Right or Home / End. Display settings are saved for the next launch.",
        ],
      },
      {
        id: "ai",
        title: "Give AI a document's location",
        paragraphs: [
          "Right-click a file or folder in the tree, or a document tab, and choose Copy absolute path. With focus on the target, Shift+F10 or the Menu key also opens the menu. Use Up / Down to select, Enter to copy and Esc to close.",
          "Inside the workspace, Copy workspace-relative path is also available. Loose tabs offer absolute paths only. The result is plain text without quotes or a newline. Japanese names and spaces are kept; relative paths use / separators.",
          "The right-clicked target is copied. Opening the menu does not open a document, switch tabs or expand a folder. Path copied. confirms success. Missing or moved targets and a busy clipboard display an error.",
        ],
        example:
          "Example: copy the relative path of docs/design.md and ask AI: ‘Read docs/design.md in this repository and check the state transitions.’ Use an absolute path for a document in another folder.",
      },
      {
        id: "troubleshooting",
        title: "Limits and troubleshooting",
        paragraphs: [
          "You cannot edit document text. Remote images are not loaded. Relative links and images must stay within the workspace or the containing folder of a loose tab. Open a document outside that boundary through a file association or by dropping it into a separate tab.",
          "For read errors, check that the file exists, you have permission and no other app is locking it. Reload after fixing the cause. Save text as UTF-8 or UTF-16 with a BOM. Markdown files larger than 10 MiB cannot be opened.",
          "If the whole document cannot render, check the displayed reason and review its syntax or size in an external editor. If only a diagram, formula or image fails, check that element.",
          "Open this guide at any time with Help → User Guide. It is bundled with the same app version and is not fetched from the network. External links and Store updates need a connection.",
        ],
      },
    ],
    shortcutsTitle: "Essential shortcuts",
    shortcuts: [
      ["Ctrl+O", "Open a folder"],
      ["Ctrl+W", "Close the active tab"],
      ["Ctrl+Tab / Ctrl+Shift+Tab", "Next / previous tab"],
      ["F5", "Reload the document"],
      ["Ctrl+F", "Find in document"],
      ["F3 / Shift+F3", "Next / previous match"],
      ["Alt+← / Alt+→", "Back / forward"],
      ["Ctrl+B", "Toggle sidebar"],
      ["Ctrl+= / Ctrl+- / Ctrl+0", "Increase / decrease / reset text size"],
      ["Shift+F10 / Menu key", "Open the target's path menu"],
      ["Esc", "Close search, a menu or help"],
    ],
    diagram: {
      folder: "Documentation",
      tree: "① Tree",
      tabs: "② Tabs",
      breadcrumb: "③ Breadcrumb",
      document: "④ Document",
      preview: "Preview (italic)",
      pinned: "Pinned tab",
      click: "Single click / Space",
      doubleClick: "Double click / Enter",
      editor: "AI / external editor",
      save: "Save",
      watch: "Watch changes",
      refresh: "Refresh the document",
      captions: {
        layout:
          "Layout diagram: opening a document from the left tree shows its tab, breadcrumb and text on the right.",
        tabs: "Interaction diagram: a single click opens a replaceable preview; a double click keeps a pinned tab for comparison.",
        updates:
          "Update diagram: changes saved externally are watched and reflected in the document you are reading.",
      },
    },
  },
};
