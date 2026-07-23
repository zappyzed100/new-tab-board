// noteImages.ts — ノートに添付した画像の保存先解決と本文参照(`![alt](nas:…)`)の純粋ロジック
//
// 設計(ユーザー指示・2026-07-23):
// - 画像は **NASにだけ** 置く。`chrome.storage.local` の10MBクォータに一切載せない
//   (ノート本文はテキスト参照だけを持つ)。
// - ブラウザ側の実体は**揮発**——起動時にNASから読み直すメモリ上のキャッシュしか持たない。
// - NASが未登録/未接続なら画像は表示しない(参照テキストはそのまま本文に残る)。
//
// 本文に書く参照は Markdown 標準の画像記法に独自スキームを載せた `![alt](nas:images/<noteId>/<file>)`。
// 素のMarkdownとして壊れないため、NASの .md/.txt をそのまま他のエディタで開いても
// 「ここに画像がある」ことが読み取れる(ユーザー選択)。

/** 本文中の画像参照に使うスキーム。 */
export const NAS_IMAGE_SCHEME = "nas:";
/** NASルート直下の画像置き場。native-host の list-images と同じ約束。 */
export const NAS_IMAGES_DIR = "images";

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

/** MIMEから拡張子を決める(未知の型はpng — 貼り付け画像はPNGへ正規化してから渡すため)。 */
export function imageExtensionFor(mimeType: string): string {
  return EXT_BY_MIME[mimeType.toLowerCase()] ?? "png";
}

/** 画像のNAS相対パス。ノートidでフォルダを切り、ノートを消したときに人が辿れるようにする。 */
export function nasImageRelPath(noteId: string, imageId: string, extension: string): string {
  return `${NAS_IMAGES_DIR}/${noteId}/${imageId}.${extension}`;
}

/** 本文へ挿入する参照テキスト。前後の改行は呼び出し側(挿入位置を知っている側)が足す。 */
export function markdownImageReference(relPath: string, alt = ""): string {
  return `![${alt}](${NAS_IMAGE_SCHEME}${relPath})`;
}

/** `nas:` 参照ならNAS相対パスを返す。それ以外(http/dataなど)はnull=このモジュールの管轄外。 */
export function nasRelPathFromSrc(src: string): string | null {
  if (!src.startsWith(NAS_IMAGE_SCHEME)) return null;
  const rel = src.slice(NAS_IMAGE_SCHEME.length).replace(/^\/+/, "");
  // `..` を含む参照は受け付けない(本文は人が編集できるテキストなので、ここでも塞ぐ——
  // native-host 側の _safe_target と二重の門にする)。
  if (rel === "" || rel.split("/").some((part) => part === "..")) return null;
  return rel;
}

/** そのノートに属する画像の置き場(`images/<noteId>/`)。 */
export function noteImagePathPrefix(noteId: string): string {
  return `${NAS_IMAGES_DIR}/${noteId}/`;
}

/** ノートの下部に並べる添付画像を、揮発キャッシュの中から選んで返す(2026-07-23・ユーザー指示
 * 「貼り付けた画像内容を確認できるようにしたい。ノートの下部に表示」)。
 *
 * 選ぶ基準は**本文の参照ではなく保存先フォルダ**(`images/<noteId>/`)——本文から参照テキストを
 * 消しても画像自体は残るため、参照だけを見ると「貼ったのに確認できない」画像が生まれる。
 * 並びは本文で参照している順を先にし、本文に出てこないものを相対パス順で後ろへ置く
 * (書いた順に見えるのが自然で、消し忘れ・貼り直しの残骸も末尾で確認できる)。
 * NASが未登録/未接続ならキャッシュが空なので結果も空=何も表示されない。 */
export function attachedImagesForNote(
  noteId: string,
  content: string,
  available: ReadonlyMap<string, string>,
): string[] {
  const prefix = noteImagePathPrefix(noteId);
  const owned = new Set([...available.keys()].filter((rel) => rel.startsWith(prefix)));
  const ordered: string[] = [];
  for (const rel of referencedNasImages(content)) {
    if (owned.delete(rel)) ordered.push(rel);
  }
  return [...ordered, ...[...owned].sort()];
}

/** 本文が参照しているNAS画像の相対パスを重複無く列挙する(未使用画像の判定などに使う)。 */
export function referencedNasImages(content: string): string[] {
  const found = new Set<string>();
  for (const match of content.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)[^)]*\)/g)) {
    const rel = nasRelPathFromSrc(match[1]);
    if (rel !== null) found.add(rel);
  }
  return [...found];
}
