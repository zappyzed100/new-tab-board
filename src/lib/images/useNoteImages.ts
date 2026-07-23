// useNoteImages.ts — ノート添付画像の揮発キャッシュ(NAS相対パス → object URL)を配るReact hook
//
// 起動時に一度だけNASから全画像を読み(ユーザー指示)、以後はメモリ上のobject URLで描画する。
// 永続化はしない——タブを閉じればキャッシュは消え、次の起動でまたNASから取り直す。
// NASが未登録/未接続なら空のまま=ノートに画像は表示されない(参照テキストは本文に残る)。
import { useCallback, useEffect, useRef, useState } from "react";
import { logOp } from "../runtime/log";
import { loadAllNoteImagesFromNas, saveNoteImageToNas, type NasImageDeps } from "./nasImageStore";

export type NoteImageCache = {
  /** NAS相対パス → object URL。未読み込み/NAS未登録なら空。 */
  urls: ReadonlyMap<string, string>;
  /** 画像をNASへ保存し、本文へ書くNAS相対パスを返す(失敗はnull)。 */
  attach: (noteId: string, blob: Blob) => Promise<string | null>;
  /** 起動時の一括読み込みが終わったか(描画の出し分けには使わない——単に観測用)。 */
  loaded: boolean;
};

export function useNoteImages(deps: NasImageDeps = {}): NoteImageCache {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(new Map());
  const [loaded, setLoaded] = useState(false);
  // 生成したobject URLはアンマウント時にまとめて解放する(タブを開き続けても漏らさない)。
  const createdRef = useRef<Set<string>>(new Set());

  const remember = useCallback((relPath: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    createdRef.current.add(url);
    setUrls((prev) => new Map(prev).set(relPath, url));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const created = createdRef.current;
    void (async () => {
      const images = await loadAllNoteImagesFromNas(deps);
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const [relPath, blob] of images) {
        const url = URL.createObjectURL(blob);
        created.add(url);
        next.set(relPath, url);
      }
      setUrls(next);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
      created.clear();
    };
    // 起動時の一度だけ。depsはテスト用の注入口で、実行中に差し替えない。
  }, []);

  const attach = useCallback(
    async (noteId: string, blob: Blob) => {
      const relPath = await saveNoteImageToNas(noteId, blob, deps);
      if (relPath === null) return null;
      remember(relPath, blob); // 保存直後はNASを読み直さずローカルのblobをそのまま見せる
      logOp("note-image", "attach", `note=${noteId} path=${relPath}`);
      return relPath;
    },
    // deps は注入口(実行中に変わらない)。remember は安定。
    [remember],
  );

  return { urls, attach, loaded };
}
