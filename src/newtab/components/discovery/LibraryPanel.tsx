// LibraryPanel.tsx — NASの library/ 配下の階層mdを一覧・開いて編集・保存し直す(作業ノートとは別レーン)。
// 作業ノート(chrome.storage・自動ミラー)と違い、これは人間が名前とフォルダを付けて“保管する文書”。
import { lazy, Suspense, useEffect, useState } from "react";
import { Button, Card, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { getNasFolderPath } from "../../../lib/storage/db";
import {
  listNasTree,
  readFileFromNas,
  writeFileToNas,
} from "../../../lib/externalIO/nasNativeHost";

const Notepad = lazy(() => import("../notes/Notepad").then((m) => ({ default: m.Notepad })));

const LIBRARY_SUBDIR = "library";

export function LibraryPanel() {
  const [files, setFiles] = useState<string[] | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const path = await getNasFolderPath();
    if (!path) {
      setMsg("NASフォルダが未設定です(データ管理の「NASフォルダを設定」)");
      setFiles([]);
      return;
    }
    setBusy(true);
    const list = await listNasTree(path, LIBRARY_SUBDIR);
    setBusy(false);
    if (list === null) {
      setMsg("一覧の取得に失敗しました(NASブリッジ未導入/到達不可)");
      setFiles([]);
      return;
    }
    setFiles(list);
    setMsg(list.length === 0 ? "library/ はまだ空です。「＋新規」で作れます" : `${list.length}件`);
  }

  useEffect(() => {
    // 初回のみ。以降は「🔄 更新」で明示的に読み直す(refreshは毎回getNasFolderPathを引くので依存不要)。
    void refresh();
  }, []);

  async function open(rel: string) {
    if (dirty && !window.confirm("未保存の変更があります。破棄して開きますか?")) return;
    const path = await getNasFolderPath();
    if (!path) return;
    setBusy(true);
    const body = await readFileFromNas(path, `${LIBRARY_SUBDIR}/${rel}`);
    setBusy(false);
    if (body === null) {
      setMsg(`読み込みに失敗: ${rel}`);
      return;
    }
    setSelectedPath(rel);
    setContent(body);
    setDirty(false);
    setMsg(`開いた: ${rel}`);
  }

  async function save() {
    if (!selectedPath) return;
    const path = await getNasFolderPath();
    if (!path) return;
    setBusy(true);
    const ok = await writeFileToNas(path, `${LIBRARY_SUBDIR}/${selectedPath}`, content);
    setBusy(false);
    setMsg(ok ? `保存しました: ${selectedPath}` : "保存に失敗しました");
    if (ok) setDirty(false);
  }

  async function createNew() {
    let rel = newPath.trim();
    if (!rel) {
      setMsg("新規ファイルのパスを入力してください(例: 仕事/2026/計画.md)");
      return;
    }
    if (!rel.endsWith(".md")) rel += ".md";
    const path = await getNasFolderPath();
    if (!path) {
      setMsg("NASフォルダが未設定です");
      return;
    }
    setBusy(true);
    const ok = await writeFileToNas(path, `${LIBRARY_SUBDIR}/${rel}`, "");
    setBusy(false);
    if (!ok) {
      setMsg("作成に失敗しました");
      return;
    }
    setNewPath("");
    await refresh();
    await open(rel);
  }

  return (
    <Card data-testid="library-panel">
      <Flex align="center" gap="3" wrap="wrap" mb="2">
        <Heading as="h2" size="3">
          📁 ライブラリ(NAS)
        </Heading>
        <Text size="1" color="gray">
          作業ノートとは別に、フォルダ階層でmdを保管・編集します
        </Text>
        <Button
          size="1"
          variant="soft"
          data-testid="library-refresh"
          disabled={busy}
          onClick={() => void refresh()}
        >
          🔄 更新
        </Button>
      </Flex>

      <Flex gap="2" wrap="wrap" mb="2" align="center">
        <TextField.Root
          size="1"
          placeholder="新規: 仕事/2026/計画.md"
          data-testid="library-new-path"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void createNew();
          }}
        />
        <Button
          size="1"
          variant="soft"
          data-testid="library-create"
          disabled={busy}
          onClick={() => void createNew()}
        >
          ＋新規
        </Button>
        {msg ? (
          <Text size="1" color="gray" data-testid="library-message">
            {msg}
          </Text>
        ) : null}
      </Flex>

      <Flex gap="3" align="start" wrap="wrap">
        <Flex direction="column" gap="1" style={{ minWidth: 220 }} asChild>
          <ul data-testid="library-tree">
            {(files ?? []).map((f) => (
              <li key={f}>
                <Button
                  size="1"
                  variant={selectedPath === f ? "solid" : "ghost"}
                  data-testid={`library-file-${f}`}
                  onClick={() => void open(f)}
                >
                  {f}
                </Button>
              </li>
            ))}
          </ul>
        </Flex>
        {selectedPath ? (
          <Flex direction="column" gap="2" style={{ flex: 1, minWidth: 280 }}>
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="1" weight="medium">
                {selectedPath}
                {dirty ? " *(未保存)" : ""}
              </Text>
              <Button
                size="1"
                variant="solid"
                data-testid="library-save"
                disabled={busy}
                onClick={() => void save()}
              >
                💾 保存
              </Button>
            </Flex>
            <Suspense
              fallback={<div data-testid="library-editor-loading">エディタ読み込み中…</div>}
            >
              <Notepad
                key={selectedPath}
                content={content}
                autoFocus
                onContentChange={(c) => {
                  setContent(c);
                  setDirty(true);
                }}
              />
            </Suspense>
          </Flex>
        ) : null}
      </Flex>
    </Card>
  );
}
