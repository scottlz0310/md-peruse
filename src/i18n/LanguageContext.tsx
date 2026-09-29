import { createContext, type ReactNode, useContext } from "react";
import type { Language } from "../types/generated/Language";
import { DEFAULT_LANGUAGE, MESSAGES, type Messages } from "./messages";

const MessagesContext = createContext<Messages>(MESSAGES[DEFAULT_LANGUAGE]);

/** 子孫のコンポーネントへ、現在のUI言語の文言を渡す（design-decisions.md 10.5）。 */
export function LanguageProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}) {
  return (
    <MessagesContext.Provider value={MESSAGES[language]}>
      {children}
    </MessagesContext.Provider>
  );
}

/** 現在のUI言語の文言。`LanguageProvider` の外では既定の言語になる。 */
export function useMessages(): Messages {
  return useContext(MessagesContext);
}
