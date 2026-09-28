/**
 * ウィンドウタイトルの組み立て（design-decisions.md 10.1.2）。
 *
 * 具体的なものから順に並べる。タスクバーとAlt+Tabでは先頭しか見えないことがあるため、
 * 文書名を先頭に置き、同名の文書（`README.md` など）はワークスペース名で区別する。
 */

const APP_NAME = "md-peruse";

const SEPARATOR = " - ";

/**
 * ワークスペースの表示名と、アクティブタブのワークスペース相対パスからタイトルを作る。
 *
 * 表示名はRust側が絶対パスの末尾2コンポーネントに限って渡すため（11.1）、タイトルにも
 * 絶対パスは現れない（7.1）。
 */
export function windowTitle(
  workspaceLabel: string | null,
  documentPath: string | null,
): string {
  if (workspaceLabel === null) return APP_NAME;
  const parts = [workspaceLabel, APP_NAME];
  if (documentPath !== null)
    parts.unshift(documentPath.split("/").at(-1) ?? "");
  return parts.join(SEPARATOR);
}
