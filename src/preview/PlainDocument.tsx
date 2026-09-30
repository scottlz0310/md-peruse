type Props = {
  /** 改行はRust側でLFへ正規化済み（6.3）。 */
  text: string;
  /** 書式を付けずに表示している理由の案内。 */
  notice: string;
};

/**
 * 大きい・複雑な文書のソースを、書式を付けずにそのまま表示する（design-decisions.md 8.7）。
 *
 * パースしない。テキストとして1つの要素へ入れるだけであり、文書の大きさによらず、上限の
 * 10 MiBでも約1秒で表示できる。選択、コピー、文書内検索は書式ありの本文と同じく使える。
 * Raw HTMLは文字列のまま出るため、sanitizeも要らない。
 */
export function PlainDocument({ text, notice }: Props) {
  return (
    <>
      <p className="plain-notice" role="note">
        {notice}
      </p>
      <pre className="plain-source">{text}</pre>
    </>
  );
}
