import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "../i18n/LanguageContext";
import {
  filterPackages,
  type LicensePackage,
  type LicensesFile,
} from "./licenses";

type Loaded =
  | { status: "loading" }
  | { status: "loaded"; file: LicensesFile }
  | { status: "failed"; detail: string };

type Props = {
  load: () => Promise<LicensesFile>;
  onClose: () => void;
};

/**
 * 「md-peruse について」。バージョンと、同梱するサードパーティのライセンスを示す
 * （design-decisions.md 11.3）。
 *
 * モーダルの `<dialog>` で開く。フォーカスの閉じ込めと `Esc` で閉じる操作はブラウザーが担い、
 * 閉じたときは開く前にフォーカスのあった要素へ戻す。
 */
export function AboutDialog({ load, onClose }: Props) {
  const messages = useMessages().about;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const opener = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (file) => {
        if (!cancelled) setLoaded({ status: "loaded", file });
      },
      (reason: unknown) => {
        if (!cancelled) setLoaded({ status: "failed", detail: String(reason) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [load]);

  return (
    <dialog
      ref={dialogRef}
      className="about-dialog"
      aria-labelledby="about-title"
      onClose={onClose}
    >
      <h2 id="about-title">{messages.title}</h2>
      {loaded.status === "loading" && <p>{messages.loading}</p>}
      {loaded.status === "failed" && (
        <p role="alert">{messages.loadFailed(loaded.detail)}</p>
      )}
      {loaded.status === "loaded" && <Licenses file={loaded.file} />}
      <div className="about-actions">
        <button type="button" onClick={onClose}>
          {messages.close}
        </button>
      </div>
    </dialog>
  );
}

function Licenses({ file }: { file: LicensesFile }) {
  const messages = useMessages().about;
  const [query, setQuery] = useState("");
  const shown = useMemo(
    () => filterPackages(file.packages, query),
    [file.packages, query],
  );
  const total = file.packages.length;

  return (
    <>
      <p>{messages.version(file.application.version)}</p>
      <PackageEntry pkg={file.application} texts={file.licenseTexts} />
      <h3>{messages.thirdPartyHeading(total)}</h3>
      <label className="license-filter">
        {messages.filterLabel}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p role="status">{messages.filterResult(shown.length, total)}</p>
      {shown.length === 0 ? (
        <p>{messages.noMatches}</p>
      ) : (
        <ul className="license-list">
          {shown.map((pkg) => (
            <li key={`${pkg.name}@${pkg.version}`}>
              <PackageEntry pkg={pkg} texts={file.licenseTexts} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * 依存1件の行。本文は開いたときにだけ描く。同じ本文を多数のパッケージが共有し、全件を
 * 描くとDOMの文字が数MBになるためである。
 */
function PackageEntry({
  pkg,
  texts,
}: {
  pkg: LicensePackage;
  texts: readonly string[];
}) {
  const messages = useMessages().about;
  const [open, setOpen] = useState(false);

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="license-name">{pkg.name}</span> {pkg.version}{" "}
        <span className="license-id">{pkg.license}</span>
      </summary>
      {open && (
        <div className="license-body">
          {pkg.sourceUrl !== undefined && (
            <p>
              {messages.sourceCode}: <code>{pkg.sourceUrl}</code>
            </p>
          )}
          {pkg.texts.map((source) => (
            <section key={`${source.label}:${source.index}`}>
              {pkg.texts.length > 1 && <h4>{source.label}</h4>}
              <pre className="license-text">{texts[source.index]}</pre>
            </section>
          ))}
        </div>
      )}
    </details>
  );
}
