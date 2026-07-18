// PastedImagesPanel.tsx — Ctrl+Vで貼り付けた画像の一次保存(ローカルのみ・NASへは出さない)と、
// 一覧表示/クリップボードへコピー/削除(ユーザー指示)。ノート類の下に線を引いて置く。
import { useEffect, useRef, useState } from "react";
import { Button, Card, Flex, Heading, IconButton, Text } from "@radix-ui/themes";
import { Copy, Images, Trash2 } from "lucide-react";
import { now as clockNow } from "../../../lib/runtime/clock";
import {
  deletePastedImage,
  getAllPastedImages,
  putPastedImage,
  type PastedImageRecord,
} from "../../../lib/storage/db";
import { logOp } from "../../../lib/runtime/log";

type View = { id: string; url: string; blob: Blob; createdAt: number };

/** blobをPNGへ変換する(ClipboardItemはpngが最も確実にコピーできるため)。失敗時は元のblob。 */
async function blobToPng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0);
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? blob), "image/png"),
    );
  } finally {
    // ImageBitmapはJSのGCだけではGPU/デコーダ資源の解放時期が保証されないため明示解放する。
    bmp.close();
  }
}

export function PastedImagesPanel() {
  const [images, setImages] = useState<View[]>([]);
  const [message, setMessage] = useState("");
  // 生成したobject URLを覚えておき、アンマウント時にまとめて解放する。
  const urlsRef = useRef<Set<string>>(new Set());

  function toView(rec: PastedImageRecord): View {
    const url = URL.createObjectURL(rec.blob);
    urlsRef.current.add(url);
    return { id: rec.id, url, blob: rec.blob, createdAt: rec.createdAt };
  }

  useEffect(() => {
    let cancelled = false;
    void getAllPastedImages().then((recs) => {
      if (!cancelled) setImages(recs.map(toView));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => () => {
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
    },
    [],
  );

  // Ctrl+Vの画像を捕まえて一次保存する。テキスト貼り付けは邪魔しない(画像itemのみ扱う)。
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const f = it.getAsFile();
          if (f) files.push(f);
        }
      }
      if (files.length === 0) return;
      const added: View[] = [];
      for (const f of files) {
        const rec: PastedImageRecord = {
          id: crypto.randomUUID(),
          blob: f,
          type: f.type,
          createdAt: clockNow(),
        };
        await putPastedImage(rec);
        added.push(toView(rec));
      }
      setImages((prev) => [...added, ...prev]);
      setMessage(`画像を${added.length}件保存しました`);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  async function copy(v: View) {
    try {
      const blob = v.blob.type === "image/png" ? v.blob : await blobToPng(v.blob);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setMessage("クリップボードにコピーしました");
    } catch (err) {
      logOp("pastedImages", "copy-error", String(err), { error: err });
      setMessage("コピーに失敗しました");
    }
  }

  function remove(v: View) {
    URL.revokeObjectURL(v.url);
    urlsRef.current.delete(v.url);
    setImages((prev) => prev.filter((i) => i.id !== v.id));
    void deletePastedImage(v.id);
  }

  return (
    <Card data-testid="pasted-images-panel" className="pasted-images-panel">
      <Flex align="center" gap="3" mb="2" wrap="wrap">
        <Heading as="h2" size="3">
          <Flex align="center" gap="1" as="span">
            <Images size={16} aria-hidden="true" />
            貼り付けた画像
          </Flex>
        </Heading>
        <Text size="1" color="gray">
          Ctrl+Vで貼り付けた画像がここに一次保存されます(NASには保存しません)
        </Text>
        {message ? (
          <Text size="1" color="gray" data-testid="pasted-images-message">
            {message}
          </Text>
        ) : null}
      </Flex>
      {images.length === 0 ? (
        <Text size="1" color="gray" data-testid="pasted-images-empty">
          まだありません
        </Text>
      ) : (
        <Flex gap="3" wrap="wrap" data-testid="pasted-images-list">
          {images.map((v) => (
            <div key={v.id} className="pasted-image-item" data-testid={`pasted-image-${v.id}`}>
              <img
                src={v.url}
                alt="貼り付け画像"
                className="pasted-image-thumb"
                loading="lazy"
                decoding="async"
              />
              <Flex gap="1" mt="1">
                <Button
                  type="button"
                  size="1"
                  variant="soft"
                  data-testid={`pasted-image-copy-${v.id}`}
                  onClick={() => void copy(v)}
                >
                  <Copy size={14} aria-hidden="true" />
                  コピー
                </Button>
                <IconButton
                  type="button"
                  size="1"
                  variant="soft"
                  color="red"
                  data-testid={`pasted-image-delete-${v.id}`}
                  title="この画像を削除する"
                  aria-label="この画像を削除する"
                  onClick={() => remove(v)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </IconButton>
              </Flex>
            </div>
          ))}
        </Flex>
      )}
    </Card>
  );
}
