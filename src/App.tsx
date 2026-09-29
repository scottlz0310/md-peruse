import type { UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useRef, useState } from "react";
import { Breadcrumb } from "./breadcrumb/Breadcrumb";
import { LanguageProvider } from "./i18n/LanguageContext";
import { DEFAULT_LANGUAGE, MESSAGES } from "./i18n/messages";
import {
  closeLooseScope,
  getUiSettings,
  getWorkspace,
  issueImageResources,
  openRecentFolder,
  readFile,
  scanDirectory,
  updateUiSettings,
} from "./ipc/commands";
import {
  onDragState,
  onFileChange,
  onImagesChanged,
  onLanguageChanged,
  onMenuCommand,
  onOpenDocument,
  onRecentFoldersChanged,
  onWatcherError,
  onWorkspaceClosed,
  onWorkspaceOpened,
} from "./ipc/events";
import { setWindowTitle } from "./ipc/window";
import { DragOverlay } from "./layout/DragOverlay";
import { SidebarLayout } from "./layout/SidebarLayout";
import { AboutDialog } from "./licenses/AboutDialog";
import { loadLicenses } from "./licenses/licenses";
import type { LinkTarget } from "./markdown/link-target";
import { DocumentFind } from "./preview/DocumentFind";
import { MarkdownDocument } from "./preview/MarkdownDocument";
import { currentEntry, updateCurrentScroll } from "./state/doc-history";
import {
  completeLoad,
  failLoad,
  type LoadIntent,
  navigateWithin,
  startLoad,
  stepHistory,
  type ViewTarget,
} from "./state/document-tab";
import {
  applyScanResult,
  beginScan,
  createFileTree,
  type FileTree,
  needsScan,
  pathChain,
  ROOT_PATH,
  refreshAllDirectories,
  refreshDirectory,
  setExpanded,
  type TreeRefresh,
} from "./state/file-tree";
import {
  DEFAULT_FONT_SCALE,
  decreaseFontScale,
  increaseFontScale,
  normalizeFontScale,
} from "./state/font-scale";
import { applyChangeToTabs } from "./state/tab-changes";
import {
  activateTab,
  activeTab,
  adjacentTabId,
  closeTab,
  EMPTY_TAB_SET,
  findTabByPath,
  type OpenTab,
  openTab,
  pendingPath,
  pinTab,
  type TabSet,
  updateTab,
} from "./state/tab-set";
import { windowTitle } from "./state/window-title";
import { TabBar, tabElementId } from "./tabs/TabBar";
import { type FocusRequest, TreeView } from "./tree/TreeView";
import type { DragState } from "./types/generated/DragState";
import type { FileChangeEvent } from "./types/generated/FileChangeEvent";
import type { FileContent } from "./types/generated/FileContent";
import type { ImagesChangedEvent } from "./types/generated/ImagesChangedEvent";
import type { IpcError } from "./types/generated/IpcError";
import type { LanguageChangedEvent } from "./types/generated/LanguageChangedEvent";
import type { MenuCommand } from "./types/generated/MenuCommand";
import type { OpenDocumentEvent } from "./types/generated/OpenDocumentEvent";
import type { RecentFolderView } from "./types/generated/RecentFolderView";
import type { UiSettings } from "./types/generated/UiSettings";
import type { UiSettingsUpdate } from "./types/generated/UiSettingsUpdate";
import type { WatcherErrorEvent } from "./types/generated/WatcherErrorEvent";
import type { WorkspaceOpenedEvent } from "./types/generated/WorkspaceOpenedEvent";
import { RecentFolders } from "./welcome/RecentFolders";

/**
 * 文書の読込の結果を、表示中の通知（`error`）へどう反映するか。
 *
 * - `replace`: 成功で消し、失敗の理由に置き換える。
 * - `keepOnSuccess`: 成功では消さない。失敗の理由には置き換える。
 * - `keep`: 成功でも失敗でも、いまの通知を書き換えない。
 */
type NoticePolicy = "replace" | "keepOnSuccess" | "keep";

/** アクティブタブに表示している本文。本文DOMはアクティブタブだけが持つ（9.1）。 */
type Shown = {
  tabId: string;
  content: FileContent;
  view: ViewTarget;
};

/**
 * WebView内で文字サイズの操作へ割り当てるキー（10.3）。
 *
 * `Ctrl+=` / `Ctrl+-` / `Ctrl+0` はメニューのアクセラレータとしてRust側が受け、ページへ
 * 届かない。1つの項目で表せない `Ctrl` + `+` とテンキーをここで扱う。
 *
 * `+` は物理キーではなく入力される文字で見る。US配列では `Shift` + `=`、JIS配列では
 * `Shift` + `;` のキーであり、`code` で判定するとどちらかの配列で効かない（実測）。
 * テンキーの `+` も同じ文字になる。
 */
function fontSizeCommandOf(event: KeyboardEvent): MenuCommand | null {
  if (event.key === "+") return "increaseFontSize";
  switch (event.code) {
    case "NumpadSubtract":
      return "decreaseFontSize";
    case "Numpad0":
      return "resetFontSize";
    default:
      return null;
  }
}

/**
 * Rust側のeventを1度だけ購読する。
 *
 * ハンドラーはrefだけを読み書きし、描画ごとの値に依存しない。StrictModeでは購読の完了前に
 * 片付けが走るため、そのときは直ちに解除する。
 */
function useTauriEvent(subscribe: () => Promise<UnlistenFn>) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: 購読は1度でよい。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    subscribe().then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
}

export default function App() {
  // 設定を読むまで描画しない。既定値で描いてから切り替えると、幅が一瞬変わって見える。
  const [ui, setUi] = useState<UiSettings | null>(null);
  // メニューコマンドのハンドラーは最初の描画のものが残るため、設定もrefで読む。
  const uiRef = useRef<UiSettings | null>(ui);
  // メニューから切り替えられた言語。設定の応答との前後を問わず、届いていれば設定より優先する。
  const [changedLanguage, setChangedLanguage] =
    useState<LanguageChangedEvent | null>(null);
  // UI言語は、切り替えがあればその言語、なければ設定の `effectiveLanguage`（OSの表示言語か、
  // 保存済みの選択。10.5）。設定を読むまで描画しないため、既定の言語が画面に出ることはない。
  const language =
    changedLanguage?.language ?? ui?.effectiveLanguage ?? DEFAULT_LANGUAGE;
  const messages = MESSAGES[language];
  // 最近使ったフォルダー。言語と同じく、一覧の変化のeventが届いていれば設定より優先する
  // （11.1）。IDは一覧が変わるたびに振り直されるため、届いた一覧で丸ごと置き換える。
  const [changedRecents, setChangedRecents] = useState<
    readonly RecentFolderView[] | null
  >(null);
  const recentFolders = changedRecents ?? ui?.recentFolders ?? [];
  const [startupError, setStartupError] = useState<string | null>(null);
  // 「md-peruse について」のダイアログ。ワークスペースを開いていなくても開ける。
  const [aboutOpen, setAboutOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceOpenedEvent | null>(null);
  const [tree, setTree] = useState<FileTree>(() => createFileTree(0));
  // パンくずで選んだフォルダー。ツリーが処理し終えたら片付ける。残すと、サイドバーを
  // 表示し直したときに作り直されたツリーが同じ要求をもう一度処理する。
  const [treeFocus, setTreeFocus] = useState<FocusRequest | null>(null);
  const [tabs, setTabs] = useState<TabSet>(EMPTY_TAB_SET);
  const [shown, setShown] = useState<Shown | null>(null);
  // ドラッグ中の受け入れ可否。パスは含まず、オーバーレイの表示だけに使う（10.4）。
  const [dragState, setDragState] = useState<DragState>("idle");
  // 発行済みの画像が書き換わるたびに進める。本文が同じでも、画像を発行し直して描き直す（5.4）。
  const [imageRevision, setImageRevision] = useState(0);
  // IPCの失敗は `IpcError` の文言を、Frontendで判定した失敗（解決できないリンク）は
  // Frontendの文言をそのまま表示する。
  const [error, setError] = useState<string | null>(null);
  // 文書の読込で監視スコープを添えるために持つ。
  const scopeRef = useRef<string | null>(null);
  // 走査と読込の応答は描画を待たずに最新の状態と照合するため、refにも持つ（5.3、6.5）。
  const treeRef = useRef<FileTree>(tree);
  const tabsRef = useRef<TabSet>(tabs);
  // プレビュー領域のDOMがどのタブの本文を表示しているか。タブを切り替えた直後の再描画前は、
  // アクティブタブと表示中の本文が一致しない。スクロール位置の読み取りはこちらで判定する。
  const shownRef = useRef<Shown | null>(shown);
  const tabSeqRef = useRef(0);
  const documentRef = useRef<HTMLElement>(null);
  // 本文のスクロール位置はプレビュー領域が持つ。ウィンドウ全体はスクロールしない。
  const previewRef = useRef<HTMLElement>(null);

  // 言語の切り替えと最近使ったフォルダーの変化を購読してから設定を読む（10.5、11.1）。読む前の
  // 変化は設定に含まれ、読んだ後の変化はeventで届くため、どの順序でも取りこぼさない。購読より先に
  // 読むと、その間の変化を逃す。購読の完了前に片付けが走ったときは、設定を読まずに解除する。
  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    Promise.all([
      onLanguageChanged(setChangedLanguage),
      onRecentFoldersChanged((changed) => setChangedRecents(changed.folders)),
    ])
      .then(([stopLanguage, stopRecents]) => {
        const stop = () => {
          stopLanguage();
          stopRecents();
        };
        if (disposed) {
          stop();
          return undefined;
        }
        unlisten = stop;
        return getUiSettings().then((loaded) => {
          uiRef.current = loaded;
          setUi(loaded);
        });
      })
      .catch((reason: unknown) => setStartupError(String(reason)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // ワークスペースの開閉を購読してから、いま開いているワークスペースを問い合わせる
  // （9.2、11.1）。起動時にRustが最後のワークスペースを開き直すと、その通知はWebViewの
  // 購読より先に送られうる。購読より先に問い合わせると、その間に開いたものを逃す。
  //
  // 購読後に通知が届いたときは、問い合わせの応答を使わない。応答はそれより前の状態であり、
  // 適用すると新しいワークスペースを古いもので上書きする。同じワークスペースが通知と応答の
  // 両方で届いたときは、スコープIDで見分けて二重に開かない。閉じると、切り替えと同じ破棄を行って
  // welcome状態へ戻す（6.1）。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 購読は1度でよい。
  useEffect(() => {
    let disposed = false;
    let notified = false;
    let unlisten: UnlistenFn | undefined;
    const open = (opened: WorkspaceOpenedEvent) => {
      if (scopeRef.current === opened.scopeId) return;
      resetWorkspace(opened);
      scan(ROOT_PATH);
    };
    Promise.all([
      onWorkspaceOpened((opened) => {
        notified = true;
        open(opened);
      }),
      onWorkspaceClosed(() => {
        notified = true;
        resetWorkspace(null);
      }),
    ])
      .then(([stopOpened, stopClosed]) => {
        const stop = () => {
          stopOpened();
          stopClosed();
        };
        if (disposed) {
          stop();
          return undefined;
        }
        unlisten = stop;
        return getWorkspace().then((current) => {
          if (current !== null && !notified) open(current);
        });
      })
      .catch((reason: unknown) => setStartupError(String(reason)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // メニューとアクセラレータで届く、Frontendが処理するコマンド（10.1）。
  useTauriEvent(() => onMenuCommand((command) => handleCommand(command)));

  // ファイル監視の通知（6.4、6.5、5.4）。ワークスペースを開く前に届くものは、スコープIDが
  // 一致しないため捨てられる。
  useTauriEvent(() => onFileChange((event) => handleFileChange(event)));
  useTauriEvent(() => onWatcherError((event) => handleWatcherError(event)));
  useTauriEvent(() => onImagesChanged((event) => handleImagesChanged(event)));

  // ドラッグの受け入れ可否と、ドロップされたファイルを開く指示（10.4）。
  useTauriEvent(() => onDragState(setDragState));
  useTauriEvent(() => onOpenDocument((event) => handleOpenDocument(event)));

  // loose tab（9.1）のスコープは、そのタブがある間だけ開いておく。タブを閉じたとき、上限で
  // 退避されたとき、ワークスペースの切り替えで破棄されたときに、Rust側のスコープと監視を
  // 閉じる（6.4）。Rust側は切り替えのときに自分で閉じるため、その場合は何も起きない。
  const looseScopesRef = useRef(new Set<string>());
  useEffect(() => {
    const current = new Set(
      tabs.tabs
        .map((tab) => tab.scopeId)
        .filter((scopeId) => scopeId !== workspace?.scopeId),
    );
    for (const scopeId of looseScopesRef.current) {
      if (!current.has(scopeId)) {
        closeLooseScope(scopeId).catch((reason: unknown) =>
          setError(String(reason)),
        );
      }
    }
    looseScopesRef.current = current;
  }, [tabs, workspace]);

  const activeScopeId = activeTab(tabs)?.scopeId ?? "";
  // 画像resource IDはスコープごとに発行する。スコープが変わらない間は同じ関数を渡し、
  // 変わらない参照で描き直しを起こさない（`MarkdownDocument`）。
  const issueImages = useCallback(
    (documentPath: string, references: string[]) =>
      issueImageResources(activeScopeId, documentPath, references),
    [activeScopeId],
  );

  // ウィンドウタイトルの「ワークスペース名」は、アクティブタブのルートの表示名にする。loose tabでは
  // 所在フォルダーである。タブがなければワークスペース名。
  const activeForTitle = activeTab(tabs);
  const title = windowTitle(
    activeForTitle
      ? (activeForTitle.rootLabel ?? workspace?.label ?? null)
      : (workspace?.label ?? null),
    activeForTitle?.path ?? null,
  );
  useEffect(() => {
    setWindowTitle(title).catch((reason: unknown) => setError(String(reason)));
  }, [title]);

  // スクリーンリーダーの読み上げや文字の選択（字形）が、UI言語に合うようにする。
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  function handleCommand(command: MenuCommand) {
    const current = uiRef.current;
    switch (command) {
      case "closeTab":
        closeActive();
        return;
      case "reloadDocument":
        reloadActive();
        return;
      case "toggleSidebar":
        if (current) saveUi({ sidebarVisible: !current.sidebarVisible });
        return;
      case "increaseFontSize":
        if (current) saveFontScale(increaseFontScale(current.fontScalePercent));
        return;
      case "decreaseFontSize":
        if (current) saveFontScale(decreaseFontScale(current.fontScalePercent));
        return;
      case "resetFontSize":
        saveFontScale(DEFAULT_FONT_SCALE);
        return;
      case "about":
        setAboutOpen(true);
        return;
    }
  }

  /** 表示の設定を変えて保存する。書込みのまとめはRust側が行う（11.1）。 */
  function saveUi(
    update: Pick<
      UiSettingsUpdate,
      "sidebarWidth" | "sidebarVisible" | "fontScalePercent"
    >,
  ) {
    const current = uiRef.current;
    if (current === null) return;
    const next = { ...current, ...update };
    uiRef.current = next;
    setUi(next);
    updateUiSettings(update).catch((reason: unknown) =>
      setError(String(reason)),
    );
  }

  /**
   * 最近使ったフォルダーの項目を開く。成功は `workspace-opened` で届く。失敗の理由は案内の下に
   * 示す。フォルダーが見つからなかったときは、Rust側がその項目を一覧から取り除き、新しい一覧が
   * eventで届く。
   */
  function openRecent(id: string) {
    setError(null);
    openRecentFolder(id).catch((reason: IpcError) => setError(reason.message));
  }

  function saveFontScale(percent: number) {
    if (uiRef.current?.fontScalePercent !== percent) {
      saveUi({ fontScalePercent: percent });
    }
  }

  /**
   * ワークスペースを替える。タブ、表示中の本文、ツリーを破棄する（6.1）。
   *
   * ツリーは世代を進めて作り直す。閉じる前や切り替える前に始めた走査・読込の応答は、
   * 世代とタブの照合で捨てられる（5.3、6.5）。
   */
  function resetWorkspace(next: WorkspaceOpenedEvent | null) {
    scopeRef.current = next?.scopeId ?? null;
    setWorkspace(next);
    updateShown(null);
    setError(null);
    updateTabs(EMPTY_TAB_SET);
    updateTree(createFileTree(treeRef.current.workspaceGeneration + 1));
    setTreeFocus(null);
  }

  function updateTree(next: FileTree) {
    treeRef.current = next;
    setTree(next);
  }

  function updateTabs(next: TabSet) {
    tabsRef.current = next;
    setTabs(next);
  }

  function updateShown(next: Shown | null) {
    shownRef.current = next;
    setShown(next);
  }

  /** フォルダーを走査し、陳腐化していなければ結果をツリーへ反映する。 */
  function scan(path: string) {
    const started = beginScan(treeRef.current, path);
    updateTree(started.tree);
    scanDirectory(path).then(
      (result) => {
        const next = applyScanResult(treeRef.current, started.token, result);
        if (next) updateTree(next);
      },
      (reason: IpcError) => {
        const next = applyScanResult(treeRef.current, started.token, {
          message: reason.message,
        });
        if (next) updateTree(next);
      },
    );
  }

  /** ツリーの更新の結果を反映し、取り直すフォルダーを走査する。 */
  function applyTreeRefresh(refresh: TreeRefresh) {
    updateTree(refresh.tree);
    for (const path of refresh.rescan) scan(path);
  }

  function toggleDirectory(path: string, expanded: boolean) {
    updateTree(setExpanded(treeRef.current, path, expanded));
    if (expanded && needsScan(treeRef.current, path)) scan(path);
  }

  /**
   * パンくずで選んだフォルダーをツリーで見せ、フォーカスを移す（10.1.1）。サイドバーが
   * 非表示なら表示する。祖先とそのフォルダーを展開し、未取得のものは並行して走査する。
   */
  function revealFolder(path: string) {
    if (uiRef.current?.sidebarVisible === false) {
      saveUi({ sidebarVisible: true });
    }
    for (const folder of pathChain(path)) toggleDirectory(folder, true);
    setTreeFocus({ path });
  }

  function scrollTop() {
    return previewRef.current?.scrollTop ?? 0;
  }

  /**
   * 通知を受けるスコープか。開いているワークスペースと、loose tabを持つスコープである。
   * 切り替えの直前に旧Watcherが送った通知や、閉じたloose tabの通知は、ここで捨てる（6.4）。
   */
  function isKnownScope(scopeId: string): boolean {
    return (
      scopeId === scopeRef.current ||
      tabsRef.current.tabs.some((tab) => tab.scopeId === scopeId)
    );
  }

  function findTab(tabId: string): OpenTab | undefined {
    return tabsRef.current.tabs.find((tab) => tab.tabId === tabId);
  }

  function isActive(tabId: string) {
    return tabsRef.current.activeTabId === tabId;
  }

  /** アクティブタブを離れる前に、本文のスクロール位置を履歴へ残す（9.3）。 */
  function saveActiveScroll() {
    const active = activeTab(tabsRef.current);
    if (!active || shownRef.current?.tabId !== active.tabId) return;
    const top = scrollTop();
    updateTabs(
      updateTab(tabsRef.current, active.tabId, (tab) => ({
        ...tab,
        history: updateCurrentScroll(tab.history, top),
      })),
    );
  }

  /**
   * タブへ文書を読み込む。読み込めなければ理由を示し、表示中の文書は保つ（7.2の
   * 「存在しない相対リンクは遷移せず、その場で理由を表示する」）。最初の読込に失敗した
   * タブは閉じる。
   */
  function load(
    tabId: string,
    path: string,
    intent: LoadIntent,
    // 表示中の通知を、読込の結果でどう扱うか。`keepOnSuccess` は、閉じたタブの失敗理由を、
    // 代わりに表示するタブの読込で消さないために使う。`keep` は、監視が追従できなくなった
    // 通知（6.4）を、その回復のための読み直しの結果で書き換えないために使う。
    notice: NoticePolicy = "replace",
  ) {
    const tab = findTab(tabId);
    if (tab === undefined) return;
    // 読むスコープはタブが持つ。ワークスペースのタブも、loose tabも同じ経路である（9.1）。
    const scopeId = tab.scopeId;
    const started = startLoad(tab, { tabId, scopeId }, path);
    updateTabs(
      updateTab(tabsRef.current, tabId, (current) => ({
        ...current,
        ...started.tab,
        pending: { path, generation: started.token.generation },
      })),
    );
    readFile(scopeId, path).then(
      (content) => {
        const current = findTab(tabId);
        if (current === undefined) return;
        // プレビュー領域がこのタブの本文を表示しているときだけ、いまのスクロール位置を
        // 読む。切り替えた直後や離れたタブでは、表示中なのは別のタブの本文である。
        const leftAt =
          shownRef.current?.tabId === tabId
            ? scrollTop()
            : (currentEntry(current.history)?.scrollTop ?? 0);
        const done = completeLoad(current, started.token, intent, leftAt);
        if (done === undefined) return;
        updateTabs(
          updateTab(tabsRef.current, tabId, (latest) => ({
            ...latest,
            ...done.tab,
            pending: null,
          })),
        );
        if (isActive(tabId)) {
          updateShown({ tabId, content, view: done.view });
          if (notice === "replace") setError(null);
        }
      },
      (reason: IpcError) => {
        const current = findTab(tabId);
        if (current === undefined) return;
        const failed = failLoad(current, started.token, intent);
        if (failed === undefined) return;
        const wasActive = isActive(tabId);
        if (failed.tab === null) {
          updateTabs(closeTab(tabsRef.current, tabId, Date.now()));
          if (wasActive) showActive(true);
        } else {
          const next = failed.tab;
          updateTabs(
            updateTab(tabsRef.current, tabId, (latest) => ({
              ...latest,
              ...next,
              pending: null,
            })),
          );
          // 読込中に切り替えてきたタブは、まだ本文を表示していない。元の文書を表示する。
          if (wasActive && shownRef.current?.tabId !== tabId) showActive(true);
        }
        if (wasActive && notice !== "keep") setError(reason.message);
      },
    );
  }

  /**
   * アクティブタブの現在の文書を表示する。非アクティブタブは本文を持たないため、切り替えの
   * たびに読み直し、離れたときのスクロール位置へ戻す（9.1、9.3）。
   */
  function showActive(keepError = false) {
    const notice: NoticePolicy = keepError ? "keepOnSuccess" : "replace";
    const active = activeTab(tabsRef.current);
    if (!active) {
      updateShown(null);
      return;
    }
    // 削除されたタブは読み直さない。離れていた間に削除されたタブには、最後に読めた内容も
    // 残っていない（9.1）。本文は空のまま、削除された旨を示す。
    if (active.status === "deleted") return;
    // 読込中のタブは、その完了で表示される。読み直すと進行中の遷移先を世代で捨ててしまう。
    if (pendingPath(active) !== null) return;
    const entry = currentEntry(active.history);
    if (entry === undefined) {
      // 履歴が空なのは、最初の読込が完了していないタブである。離れている間に変更やrenameで
      // その読込が無効になると、応答は捨てられ、履歴に読み込む項目がない。タブのパスから
      // 読み込み直す。renameを受けていれば、パスは新しいものへ追従している（6.5）。
      load(
        active.tabId,
        active.path,
        { kind: "push", path: active.path, anchor: null },
        notice,
      );
      return;
    }
    load(
      active.tabId,
      entry.path,
      { kind: "history", index: active.history.index },
      notice,
    );
  }

  function nextTabId() {
    tabSeqRef.current += 1;
    return `tab-${tabSeqRef.current}`;
  }

  /**
   * ツリーから文書を開く。シングルクリックはプレビュー、`Enter` とダブルクリックは固定。
   * ワークスペースの文書である。
   */
  function openFromTree(path: string, preview: boolean) {
    const scopeId = scopeRef.current;
    if (scopeId === null) return;
    openDocument({ scopeId }, path, preview);
  }

  /**
   * ドロップされたファイルを開く指示を受ける（10.4）。開き先（ワークスペースの通常タブか、
   * loose tab）はRust側が決めて、スコープIDとスコープ相対パスで知らせる。固定タブで開く。
   * 複数あれば届いた順に開き、最後の1つがアクティブになる。
   */
  function handleOpenDocument(event: OpenDocumentEvent) {
    openDocument(
      { scopeId: event.scopeId, rootLabel: event.label ?? undefined },
      event.path,
      false,
    );
  }

  /**
   * 文書をタブで開く。同じスコープの同じ文書が開いていれば、そのタブへ切り替える（9.1）。
   * `anchor` は、削除されたタブの本文のリンクから開くとき（`openLink`）の見出し。
   */
  function openDocument(
    scope: { scopeId: string; rootLabel?: string },
    path: string,
    preview: boolean,
    anchor?: string | null,
  ) {
    const before = tabsRef.current.activeTabId;
    saveActiveScroll();
    const result = openTab(tabsRef.current, {
      path,
      preview,
      now: Date.now(),
      fresh: { tabId: nextTabId(), ...scope },
    });
    updateTabs(result.set);
    setError(null);
    if (result.opened) {
      load(result.opened.tabId, path, {
        kind: "push",
        path,
        anchor: anchor ?? null,
      });
    } else if (result.set.activeTabId !== before) {
      showActive();
    }
  }

  function activate(tabId: string) {
    if (isActive(tabId)) return;
    saveActiveScroll();
    updateTabs(activateTab(tabsRef.current, tabId, Date.now()));
    setError(null);
    showActive();
  }

  function close(tabId: string) {
    const wasActive = isActive(tabId);
    updateTabs(closeTab(tabsRef.current, tabId, Date.now()));
    if (wasActive) {
      setError(null);
      showActive();
    }
  }

  /** アクティブタブを閉じる（メニューの「タブを閉じる」と `Ctrl+W`。10.1）。 */
  function closeActive() {
    const active = activeTab(tabsRef.current);
    if (active) close(active.tabId);
  }

  /**
   * 表示中の文書を読み直す（メニューの「再読み込み」。10.1）。読込中のタブは、その完了で
   * 最新の内容が表示されるため読み直さない。
   */
  function reloadActive() {
    reloadActiveTab("replace");
  }

  /**
   * アクティブタブを読み直す。削除されたタブは、以後の再読込を止めているため読み直さない（6.5）。
   * `notice` は、表示中の通知を読み直しの結果でどう扱うか（`load`）。
   */
  function reloadActiveTab(notice: NoticePolicy) {
    const active = activeTab(tabsRef.current);
    if (
      !active ||
      active.status === "deleted" ||
      pendingPath(active) !== null
    ) {
      return;
    }
    load(active.tabId, active.path, { kind: "reload" }, notice);
  }

  /**
   * ファイル変更の通知を、タブとツリーへ適用する（6.4、6.5）。
   *
   * 停止する前のWatcherが送った通知は、別のワークスペースの同じ相対パスへ当たりうる。
   * スコープIDが一致しないものは捨てる。
   */
  function handleFileChange(event: FileChangeEvent) {
    if (!isKnownScope(event.scopeId)) return;
    if (event.change.kind === "directoryChanged") {
      // ツリーを持つのはワークスペースだけである。loose tabのWatcherは送らない（6.4）。
      if (event.scopeId === scopeRef.current) {
        applyTreeRefresh(refreshDirectory(treeRef.current, event.change.path));
      }
      return;
    }
    const before = activeTab(tabsRef.current);
    const changed = applyChangeToTabs(tabsRef.current, event);
    if (changed.set === tabsRef.current) return;
    updateTabs(changed.set);
    const after = activeTab(changed.set);
    // renameで本文の基点が変わる。相対リンクと画像は新しいパスを基に解決し直す。
    const current = shownRef.current;
    if (
      before &&
      after &&
      before.tabId === after.tabId &&
      before.path !== after.path &&
      current?.tabId === after.tabId
    ) {
      updateShown({
        ...current,
        content: { ...current.content, path: after.path },
      });
    }
    const reloading =
      changed.reloadTabId === null ? undefined : findTab(changed.reloadTabId);
    if (reloading) load(reloading.tabId, reloading.path, { kind: "reload" });
  }

  /**
   * 監視が追従できなくなったとき（変更が多すぎる、監視が止まった）は、取得済みのフォルダーと
   * アクティブ文書を取り直し、原因を示す（6.4）。あふれでは画像のIDも作り直されている。
   */
  function handleWatcherError(event: WatcherErrorEvent) {
    if (!isKnownScope(event.scopeId)) return;
    // loose tabのWatcherが送るのは、監視を付け替えられなかったとき（6.4）だけである。
    // ツリーも画像の再発行も要らず、原因を示す。
    if (event.scopeId !== scopeRef.current) {
      setError(event.error.message);
      return;
    }
    applyTreeRefresh(refreshAllDirectories(treeRef.current));
    setImageRevision((revision) => revision + 1);
    // 読み直しの失敗（ルートが消えたときの「見つかりません」）で、監視の断念の通知を
    // 書き換えない。フォルダーを開き直す案内が、利用者の取れる行動だからである。
    reloadActiveTab("keep");
    setError(event.error.message);
  }

  /** 発行済みの画像が書き換わったときは、表示中の文書の画像を発行し直す（5.4）。 */
  function handleImagesChanged(event: ImagesChangedEvent) {
    if (!isKnownScope(event.scopeId)) return;
    setImageRevision((revision) => revision + 1);
  }

  /** タブの中で表示を変える操作は、プレビュータブを固定する。 */
  function pinActive() {
    const active = activeTab(tabsRef.current);
    if (active) updateTabs(pinTab(tabsRef.current, active.tabId));
  }

  /** 本文のリンクで別の文書を開く。既に別のタブで開いていればそのタブへ切り替える（9.3）。 */
  function openLink(path: string, anchor: string | null) {
    const active = activeTab(tabsRef.current);
    if (!active) return;
    const shownNow = shownRef.current;
    if (shownNow?.tabId === active.tabId && shownNow.content.path === path) {
      moveWithin(anchor);
      return;
    }
    // 削除されたタブは終端であり、別の文書へ移れない（6.5）。読み直さず、新しいタブで開く。
    if (active.status === "deleted") {
      openDocument(
        { scopeId: active.scopeId, rootLabel: active.rootLabel ?? undefined },
        path,
        false,
        anchor,
      );
      return;
    }
    const other = findTabByPath(tabsRef.current, active.scopeId, path);
    if (other && anchor === null) {
      activate(other.tabId);
      return;
    }
    if (other) {
      // 見出しを指すリンクは、切り替えた先のタブで読み直してから見出しへ移る。表示を変える
      // 操作なので、そのタブを固定する。
      saveActiveScroll();
      updateTabs(
        pinTab(
          activateTab(tabsRef.current, other.tabId, Date.now()),
          other.tabId,
        ),
      );
      setError(null);
      load(other.tabId, path, { kind: "push", path, anchor });
      return;
    }
    pinActive();
    load(active.tabId, path, { kind: "push", path, anchor });
  }

  function moveWithin(anchor: string | null) {
    const active = activeTab(tabsRef.current);
    const shown = shownRef.current;
    if (!active || shown?.tabId !== active.tabId) return;
    const moved = navigateWithin(active, anchor, scrollTop());
    updateTabs(
      pinTab(
        updateTab(tabsRef.current, active.tabId, (tab) => ({
          ...tab,
          ...moved.tab,
        })),
        active.tabId,
      ),
    );
    updateShown({ ...shown, view: moved.view });
    setError(null);
  }

  function step(direction: "back" | "forward") {
    const active = activeTab(tabsRef.current);
    const shown = shownRef.current;
    // 削除されたタブは終端であり、履歴をたどって別の文書を読み込めない（6.5）。
    if (!active || active.status === "deleted") return;
    if (shown?.tabId !== active.tabId) return;
    const result = stepHistory(active, direction, scrollTop());
    if (result === undefined) return;
    if (result.kind === "load") {
      load(active.tabId, result.path, result.intent);
      return;
    }
    const next = result.tab;
    updateTabs(
      updateTab(tabsRef.current, active.tabId, (tab) => ({ ...tab, ...next })),
    );
    updateShown({ ...shown, view: result.view });
    setError(null);
  }

  // WebViewの履歴は空のまま保ち、`Alt+←` とマウスのサイドボタンを自前の履歴へつなぐ（9.3）。
  // タブの移動（`Ctrl+Tab` / `Ctrl+Shift+Tab`）もメニュー項目を持たずWebView内で扱う（10.1）。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.key === "Tab") {
          event.preventDefault();
          const next = adjacentTabId(
            tabsRef.current,
            event.shiftKey ? "previous" : "next",
          );
          if (next) activate(next);
          return;
        }
        const command = fontSizeCommandOf(event);
        if (command) {
          event.preventDefault();
          handleCommand(command);
        }
        return;
      }
      if (!event.altKey || event.ctrlKey || event.shiftKey || event.metaKey) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step("back");
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step("forward");
      }
    }
    function onAuxClick(event: MouseEvent) {
      if (event.button === 3) {
        event.preventDefault();
        step("back");
      } else if (event.button === 4) {
        event.preventDefault();
        step("forward");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("auxclick", onAuxClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("auxclick", onAuxClick);
    };
  });

  function navigate(target: LinkTarget) {
    switch (target.kind) {
      case "anchor":
        moveWithin(target.elementId);
        return;
      case "document":
        openLink(target.path, target.elementId);
        return;
      case "external":
        // opener の権限は `http` と `https` に限ってある（5.5）。
        openUrl(target.url).catch((reason: unknown) => {
          setError(String(reason));
        });
        return;
      case "rejected":
        setError(messages.linkRejection[target.reason]);
        return;
    }
  }

  if (startupError !== null) {
    return (
      <main className="app">
        <p role="alert">{startupError}</p>
      </main>
    );
  }
  if (ui === null) return null;

  const aboutDialog = aboutOpen && (
    <AboutDialog load={loadLicenses} onClose={() => setAboutOpen(false)} />
  );

  // ワークスペースがなくても、loose tab（9.1）があれば文書を表示する。welcome状態は、
  // ワークスペースもタブもないときだけである（9.2）。
  if (!workspace && tabs.tabs.length === 0) {
    return (
      <LanguageProvider language={language}>
        <main className="app">
          <h1>md-peruse</h1>
          <p>{messages.welcome}</p>
          {error && <p role="alert">{error}</p>}
          <RecentFolders folders={recentFolders} onOpen={openRecent} />
        </main>
        <DragOverlay state={dragState} />
        {aboutDialog}
      </LanguageProvider>
    );
  }

  const active = activeTab(tabs);
  // 本文の文字サイズはCSSカスタムプロパティで渡す。CSPが `style` 属性を許可しない（5.5）。
  const fontScale = normalizeFontScale(ui.fontScalePercent);
  const visible =
    shown !== null && shown.tabId === active?.tabId ? shown : null;
  // 削除の通知は、タブの状態から導く。本文を保っているかで文言を分ける（6.5）。
  const deletedNotice =
    active?.status === "deleted"
      ? visible
        ? messages.fileDeleted.keepingContent
        : messages.fileDeleted.withoutContent
      : null;

  return (
    <LanguageProvider language={language}>
      <SidebarLayout
        savedWidth={ui.sidebarWidth}
        // ワークスペースがなければツリーがない。サイドバーは出さない。
        sidebarVisible={ui.sidebarVisible && workspace !== null}
        onWidthCommit={(sidebarWidth) => saveUi({ sidebarWidth })}
        previewRef={previewRef}
        sidebar={
          workspace && (
            <>
              <h1>{workspace.label}</h1>
              <TreeView
                tree={tree}
                // ツリーはワークスペースの文書だけを選択する。loose tabの文書は、同じ相対パスの
                // ワークスペースの文書とは別物である（6.4）。
                selectedPath={
                  active?.scopeId === workspace.scopeId ? active.path : null
                }
                onToggle={toggleDirectory}
                onOpen={openFromTree}
                focusRequest={treeFocus}
                onFocusRequestSettled={(request) =>
                  setTreeFocus((current) =>
                    current === request ? null : current,
                  )
                }
              />
            </>
          )
        }
        previewHeader={
          active && (
            <>
              <TabBar
                set={tabs}
                onActivate={activate}
                onClose={close}
                onPin={(tabId) => updateTabs(pinTab(tabsRef.current, tabId))}
              />
              <Breadcrumb
                rootLabel={active.rootLabel ?? workspace?.label ?? ""}
                path={active.path}
                // loose tabはツリーを持たないため、フォルダーを選んでも見せる先がない（9.1）。
                onSelect={active.rootLabel === null ? revealFolder : undefined}
              />
            </>
          )
        }
        previewLabelledBy={active ? tabElementId(active.tabId) : undefined}
      >
        <style>{`.markdown-body { --font-scale: ${fontScale / 100}; }`}</style>
        {error && <p role="alert">{error}</p>}
        {deletedNotice && <p role="status">{deletedNotice}</p>}
        {visible && (
          <>
            <DocumentFind root={documentRef} />
            <MarkdownDocument
              ref={documentRef}
              text={visible.content.text}
              path={visible.content.path}
              view={visible.view}
              onNavigate={navigate}
              issueImages={issueImages}
              imageRevision={imageRevision}
              scroller={previewRef}
            />
          </>
        )}
      </SidebarLayout>
      <DragOverlay state={dragState} />
      {aboutDialog}
    </LanguageProvider>
  );
}
