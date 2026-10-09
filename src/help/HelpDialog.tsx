import { useEffect, useRef, useState } from "react";
import type { Language } from "../types/generated/Language";
import { HELP } from "./content";
import "./help.css";

export function HelpDialog({
  language,
  onClose,
}: {
  language: Language;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = HELP[language];
  const [contentsOpen, setContentsOpen] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement;
    if (!element.open) element.showModal();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  function goTo(id: string) {
    setContentsOpen(false);
    const section = dialog.current?.querySelector<HTMLElement>(`#help-${id}`);
    section?.scrollIntoView({ block: "start" });
    section?.focus({ preventScroll: true });
  }
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      aria-labelledby="help-title"
      lang={language}
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
      onAuxClick={(event) => event.stopPropagation()}
    >
      <header className="help-header">
        <div>
          <p className="help-eyebrow">md-peruse</p>
          <h2 id="help-title">{content.title}</h2>
        </div>
        <button type="button" onClick={onClose}>
          {content.close}
        </button>
      </header>
      <div className="help-layout">
        <nav aria-label={content.contents} className="help-contents">
          <h3 className="help-contents-title">{content.contents}</h3>
          <button
            type="button"
            className="help-contents-toggle"
            aria-expanded={contentsOpen}
            aria-controls="help-contents-items"
            onClick={() => setContentsOpen(!contentsOpen)}
          >
            {content.contents} {contentsOpen ? "▴" : "▾"}
          </button>
          <div
            id="help-contents-items"
            className={
              contentsOpen
                ? "help-contents-items is-open"
                : "help-contents-items"
            }
          >
            {content.sections.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => goTo(section.id)}
              >
                {section.title}
              </button>
            ))}
            <button type="button" onClick={() => goTo("shortcuts")}>
              {content.shortcutsTitle}
            </button>
          </div>
        </nav>
        <article className="help-article">
          <p className="help-intro">{content.intro}</p>
          {content.sections.map((section, index) => (
            <section key={section.id}>
              <h3 id={`help-${section.id}`} tabIndex={-1}>
                <span className="help-number">
                  {String(index + 1).padStart(2, "0")}
                </span>{" "}
                {section.title}
              </h3>
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
              {section.steps && (
                <ol>
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              )}
              {section.diagram && (
                <Diagram kind={section.diagram} language={language} />
              )}
              {section.example && (
                <p className="help-example">{section.example}</p>
              )}
            </section>
          ))}
          <section>
            <h3 id="help-shortcuts" tabIndex={-1}>
              {content.shortcutsTitle}
            </h3>
            <div className="help-table-scroll">
              <table>
                <caption>{content.shortcutsTitle}</caption>
                <tbody>
                  {content.shortcuts.map(([key, action]) => (
                    <tr key={key}>
                      <th scope="row">
                        <kbd>{key}</kbd>
                      </th>
                      <td>{action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </article>
      </div>
    </dialog>
  );
}

function Diagram({
  kind,
  language,
}: {
  kind: "layout" | "tabs" | "updates";
  language: Language;
}) {
  const text = HELP[language].diagram;
  const captionId = `help-diagram-${kind}`;
  return (
    <figure className="help-figure">
      <div
        role="img"
        aria-labelledby={captionId}
        className={`help-diagram help-diagram-${kind}`}
      >
        {kind === "layout" ? (
          <div className="help-mini-app" aria-hidden="true">
            <div className="help-mini-tree">
              <strong>{text.tree}</strong>
              <p>▾ {text.folder}</p>
              <p>　README.md</p>
              <p>　▾ docs</p>
              <p>　　design.md</p>
            </div>
            <div className="help-mini-preview">
              <div className="help-mini-tabs">
                <strong>{text.tabs}</strong>
                <span>README.md ×</span>
                <em>design.md ×</em>
              </div>
              <div className="help-mini-crumb">
                {text.breadcrumb}　docs / design.md
              </div>
              <div className="help-mini-body">
                <strong>{text.document}</strong>
                <h4>Markdown</h4>
                <div className="help-text-line" />
                <div className="help-text-line help-text-line-short" />
                <pre>state → review → done</pre>
              </div>
            </div>
          </div>
        ) : kind === "tabs" ? (
          <div className="help-flow" aria-hidden="true">
            <div>
              <span>{text.click}</span>
              <strong>
                <em>{text.preview}</em>
              </strong>
            </div>
            <span>→</span>
            <div>
              <span>{text.doubleClick}</span>
              <strong>{text.pinned}</strong>
            </div>
          </div>
        ) : (
          <div className="help-flow" aria-hidden="true">
            <div>
              <strong>{text.editor}</strong>
              <span>{text.save}</span>
            </div>
            <span>→</span>
            <div>
              <strong>md-peruse</strong>
              <span>{text.watch}</span>
            </div>
            <span>→</span>
            <div>
              <strong>{text.refresh}</strong>
              <span>Markdown</span>
            </div>
          </div>
        )}
      </div>
      <figcaption id={captionId}>{text.captions[kind]}</figcaption>
    </figure>
  );
}
