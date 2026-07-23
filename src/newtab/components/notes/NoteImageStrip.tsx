// NoteImageStrip.tsx — ノート下部に並べる添付画像のサムネイル帯(ユーザー指示・2026-07-23)
//
// 「貼り付けた画像内容を確認できるようにしたい。ノートの下部に表示」への対応。編集中は本文に
// `![](nas:…)` という参照テキストしか見えず、中身を見るにはプレビューへ切り替える必要があった。
//
// 表示するのは**そのノートの保存先フォルダ(`images/<noteId>/`)にある画像**で、本文の参照有無では
// 選ばない(参照テキストを消しても画像は残るため——詳細は attachedImagesForNote)。実体はNASにしか
// 無く、ここで使うのは起動時に読み込んだ揮発キャッシュのobject URL。NASが未登録/未接続なら
// キャッシュが空になり、この帯ごと描画されない。
import { useMemo } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { attachedImagesForNote } from "../../../lib/images/noteImages";

type Props = {
  noteId: string;
  content: string;
  /** ノート添付画像の揮発キャッシュ(NAS相対パス → object URL)。 */
  imageUrls?: ReadonlyMap<string, string>;
};

export function NoteImageStrip({ noteId, content, imageUrls }: Props) {
  const attached = useMemo(
    () => (imageUrls ? attachedImagesForNote(noteId, content, imageUrls) : []),
    [noteId, content, imageUrls],
  );
  if (attached.length === 0) return null;

  return (
    <Flex direction="column" gap="1" data-testid={`note-images-${noteId}`}>
      <Text size="1" color="gray">
        添付画像 {attached.length}枚
      </Text>
      <Flex gap="2" wrap="wrap">
        {attached.map((relPath) => (
          // 別タブで開くと原寸で確認できる(object URLは拡張機能のオリジンなのでそのまま開ける)。
          <a
            key={relPath}
            className="note-image-thumb-link"
            href={imageUrls?.get(relPath)}
            target="_blank"
            rel="noreferrer"
            title={`${relPath}(クリックで原寸表示)`}
            data-image-path={relPath}
          >
            <img className="note-image-thumb" src={imageUrls?.get(relPath)} alt={relPath} />
          </a>
        ))}
      </Flex>
    </Flex>
  );
}
