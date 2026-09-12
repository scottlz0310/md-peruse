# 画像判定のテスト用サンプル

`format.rs` のテストが `include_bytes!` で読む。製品バイナリへは入らない（`#[cfg(test)]`）。

いずれも ffmpeg 8.0.1 の合成ソースから生成したものであり、第三者の著作物を含まない。
再生成する場合は次のコマンドを使う。

```powershell
# 許可形式のサンプル（6x4）と、許可形式ではない形式（TIFF）
foreach ($ext in 'png','jpg','gif','webp','avif','bmp','tiff') {
  ffmpeg -y -f lavfi -i "testsrc=size=6x4:duration=1:rate=1" -frames:v 1 "sample.$ext"
}
# 1辺の上限（16384 px）を超えるもの
ffmpeg -y -f lavfi -i "color=c=black:size=20000x2:duration=1:rate=1" -frames:v 1 wide.png
# 1辺は上限内で、総ピクセル数の上限（24 Mpx）を超えるもの（16000x1600 = 25.6 Mpx）
ffmpeg -y -f lavfi -i "color=c=black:size=16000x1600:duration=1:rate=1" -frames:v 1 -lossless 1 large.webp
```

実物のファイルを置くのは、形式の判定と寸法の取得がヘッダーの実際の並びに依存するためで
ある。手で組み立てたバイト列では、判定できたつもりのものが実ファイルで通らない。
