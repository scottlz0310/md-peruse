import { splitPlainText } from "./plain-chunks";

type Props = {
  /** 改行はRust側でLFへ正規化済み（6.3）。 */
  text: string;
  /** 書式を付けずに表示している理由の案内。 */
  notice: string;
};

/**
 * 大きい・複雑な文書のソースを、書式を付けずにそのまま表示する（design-decisions.md 8.7）。
 *
 * パースしない。テキストとして1つの要素へ入れるだけであり、上限の10 MiBでも約2秒で表示できる。
 * 本文は数千文字ごとの隣り合うテキストノードに分ける（{@link splitPlainText}）。1つの巨大な
 * ノードは、アクセシビリティ木の更新とレイアウトが長さの二乗に近く伸びるためである。
 * 選択、コピー、文書内検索は書式ありの本文と同じく使える。Raw HTMLは文字列のまま出るため、
 * sanitizeも要らない。
 */
export function PlainDocument({ text, notice }: Props) {
  return (
    <>
      <p className="plain-notice" role="note">
        {notice}
      </p>
      <pre className="plain-source">{splitPlainText(text)}</pre>
    </>
  );
}
