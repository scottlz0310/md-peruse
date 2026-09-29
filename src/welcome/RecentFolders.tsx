import { useMessages } from "../i18n/LanguageContext";
import type { RecentFolderView } from "../types/generated/RecentFolderView";

type Props = {
  folders: readonly RecentFolderView[];
  onOpen: (id: string) => void;
};

/**
 * ワークスペースを開いていないときの案内に並べる、最近使ったフォルダーの一覧
 * （design-decisions.md 9.2、11.1）。
 *
 * 項目は表示名（親フォルダー名とフォルダー名）で示し、開くときは不透明なIDをRustへ渡す。
 * 絶対パスはFrontendへ届かない（7.1）。一覧が空のときは何も描かない。
 */
export function RecentFolders({ folders, onOpen }: Props) {
  const messages = useMessages();
  if (folders.length === 0) return null;

  return (
    <section
      className="recent-folders"
      aria-labelledby="recent-folders-heading"
    >
      <h2 id="recent-folders-heading">{messages.recentFoldersHeading}</h2>
      <ul>
        {folders.map((folder) => (
          <li key={folder.id}>
            <button type="button" onClick={() => onOpen(folder.id)}>
              {folder.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
