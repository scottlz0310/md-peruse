// 記録（ログ、証跡、Step Summary、エラーのメッセージ）から、資格情報と署名つき URL を取り除く。
//
// 証跡は、リポジトリが公開のため、ログインしている誰でも取得できる artifact になる。GitHub のログは、
// secret の値を自動で隠すが、artifact の中身は隠さない。だから、書き出す側で取り除く。
//
// 文字列の中に埋まった値（API の応答の本文に含まれる値など）は、キー名では見つけられない。
// 既知の秘密値（実行時に分かる値）の完全一致と、形で分かるもの（`sig=`、`Bearer …`、JWT）を、
// どちらも取り除く。このモジュールは、ほかのモジュールに依存しない（循環を避けるため）。

export const REDACTED = "<記録しない>";

/** 値に含めてはならないキー。申請の JSON には、通常は無い（防御のため）。 */
const SECRET_KEY = /token|secret|authorization|password|fileUploadUrl/i;

/** 完全一致で取り除く値の最小の長さ。短い値は、無関係な文字列まで巻き込む。 */
const MIN_SECRET_LENGTH = 4;

/** 形で分かる秘密。（パターン, 置き換え） */
const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // 署名つき URL（SAS）の署名。
  [/(sig=)[^&\s"'<>]+/gi, `$1${REDACTED}`],
  [/(client_secret=)[^&\s"'<>]+/gi, `$1${REDACTED}`],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`],
  // JWT（アクセス トークン）。
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, REDACTED],
];

/**
 * 文字列から、既知の秘密値（`secrets`。未定義と短い値は無視する）と、形で分かる秘密を取り除く。
 * 長い値から先に置き換える（短い値が、長い値の一部に当たって、取り残しを作らないように）。
 */
export function redactText(
  text: string,
  secrets: ReadonlyArray<string | undefined> = [],
): string {
  const known = [
    ...new Set(
      secrets.filter(
        (secret): secret is string =>
          secret !== undefined && secret.length >= MIN_SECRET_LENGTH,
      ),
    ),
  ].sort((a, b) => b.length - a.length);

  let result = text;
  for (const secret of known) result = result.split(secret).join(REDACTED);
  for (const [pattern, replacement] of PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * 資格情報と署名つき URL を取り除いた、JSON の複製を返す。キー名が資格情報を示す値は、値ごと取り除く。
 * 文字列の値は、`redactText` を通す（API の応答の本文などに埋まった秘密値のため）。
 */
export function redact(
  value: unknown,
  secrets: ReadonlyArray<string | undefined> = [],
): unknown {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((entry) => redact(entry, secrets));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        SECRET_KEY.test(key) ? REDACTED : redact(entry, secrets),
      ]),
    );
  }
  return value;
}
