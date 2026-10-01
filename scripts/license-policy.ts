// 同梱する依存のライセンスが、許容リストに収まっているかを判定する。
// 許容リストの正本は src-tauri/about.toml の `accepted` で、Rust（cargo-about）とJavaScriptが
// 共有する。片方だけに足して食い違う状態を作らないため、別の一覧は持たない
// （design-decisions.md 11.3）。

/** about.toml の `accepted = [...]` からSPDX識別子を取り出す。 */
export function parseAcceptedLicenses(toml: string): string[] {
  const block = /^accepted\s*=\s*\[([\s\S]*?)\]/m.exec(toml);
  if (block === null) {
    throw new Error("about.toml に accepted の一覧が見つかりません");
  }
  // コメント行（# から行末）を除いてから、引用符で囲まれた識別子を集める。
  const body = (block[1] ?? "").replace(/#.*$/gm, "");
  const identifiers = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
  if (identifiers.length === 0) {
    throw new Error("about.toml の accepted が空です");
  }
  return identifiers;
}

type Token = "(" | ")" | "AND" | "OR" | "WITH" | { id: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  for (const part of expression.replace(/[()]/g, " $& ").split(/\s+/)) {
    if (part === "") {
      continue;
    }
    const upper = part.toUpperCase();
    if (part === "(" || part === ")") {
      tokens.push(part);
    } else if (upper === "AND" || upper === "OR" || upper === "WITH") {
      tokens.push(upper);
    } else {
      tokens.push({ id: part });
    }
  }
  return tokens;
}

/**
 * SPDXのライセンス式が、許容リストだけで満たせるかを返す。
 * - `A OR B` は、どちらか一方が許容されていればよい（利用者が選べるため）。
 * - `A AND B` は、両方が許容されていなければならない。
 * - `A WITH 例外` は、例外が権利を足すだけなので、`A` が許容されていればよい。
 * - 式として読めないもの（`SEE LICENSE IN ...` など）は、許容しない。
 * 識別子は大文字小文字を区別しない（SPDXの規則）。
 */
export function isLicenseAccepted(
  expression: string,
  accepted: readonly string[],
): boolean {
  const allowed = new Set(accepted.map((id) => id.toLowerCase()));
  const tokens = tokenize(expression);
  let position = 0;

  // 優先順位は WITH > AND > OR。構文が崩れたときは例外にして、呼び出し側で不許容とする。
  const parseOr = (): boolean => {
    let result = parseAnd();
    while (tokens[position] === "OR") {
      position += 1;
      const right = parseAnd();
      result = result || right;
    }
    return result;
  };
  const parseAnd = (): boolean => {
    let result = parseTerm();
    while (tokens[position] === "AND") {
      position += 1;
      const right = parseTerm();
      result = result && right;
    }
    return result;
  };
  const parseTerm = (): boolean => {
    const token = tokens[position];
    if (token === "(") {
      position += 1;
      const inner = parseOr();
      if (tokens[position] !== ")") {
        throw new Error("括弧が閉じていません");
      }
      position += 1;
      return inner;
    }
    if (typeof token === "object") {
      position += 1;
      // `MIT+` のような「以降の版」の表記は、`+` を除いた識別子でも判定する。
      const id = token.id.toLowerCase();
      const ok = allowed.has(id) || allowed.has(id.replace(/\+$/, ""));
      if (tokens[position] === "WITH") {
        position += 1;
        if (typeof tokens[position] !== "object") {
          throw new Error("WITH の後に例外の識別子がありません");
        }
        position += 1;
      }
      return ok;
    }
    throw new Error("ライセンス式を読めません");
  };

  try {
    const result = parseOr();
    return position === tokens.length && result;
  } catch {
    return false;
  }
}
