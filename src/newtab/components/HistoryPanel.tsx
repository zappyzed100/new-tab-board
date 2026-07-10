// HistoryPanel.tsx — 履歴一覧・プレビュー・diff比較・復元(SPEC.md §4.3)
import { useEffect, useState } from "react";
import { now as clockNow } from "../../lib/clock";
import { getSnapshotsByNote, putSnapshot } from "../../lib/db";
import { gzipCompress, gzipDecompress } from "../../lib/gzip";
import { getSnapshotBody } from "../../lib/nasArchive";
import type { Snapshot } from "../../types";
import { DiffView } from "./DiffView";

type Props = {
  noteId: string;
  currentContent: string;
  onRestore: (content: string) => void;
};

export function HistoryPanel({ noteId, currentContent, onRestore }: Props) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [decoded, setDecoded] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    getSnapshotsByNote(noteId).then((list) => {
      if (!cancelled) setSnapshots([...list].sort((a, b) => b.timestamp - a.timestamp));
    });
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  useEffect(() => {
    for (const id of selectedIds) {
      const snapshot = snapshots.find((s) => s.id === id);
      if (snapshot && decoded[id] === undefined) {
        void getSnapshotBody(snapshot).then((body) => {
          if (body === null) return; // NAS排出済みでオフライン等(degrade表示——diffは出さない)
          void gzipDecompress(body).then((text) => setDecoded((prev) => ({ ...prev, [id]: text })));
        });
      }
    }
  }, [selectedIds, snapshots, decoded]);

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  }

  async function handleRestore(snapshot: Snapshot) {
    const body = await getSnapshotBody(snapshot);
    if (body === null) return; // NAS排出済みでオフライン等、復元元の本文を取得できない
    const text = await gzipDecompress(body);
    // 復元前に現在の内容を保全する(SPEC.md §4.3「復元時は現在の本文を先にスナップショットしてから置き換える」)
    const compressedCurrent = await gzipCompress(currentContent);
    await putSnapshot({
      id: crypto.randomUUID(),
      noteId,
      timestamp: clockNow(),
      content: compressedCurrent,
      archived: false,
    });
    onRestore(text);
  }

  const [first, second] = selectedIds;
  const canShowDiff = first !== undefined && second !== undefined;

  return (
    <div data-testid="history-panel">
      <ul>
        {snapshots.map((snapshot) => (
          <li key={snapshot.id} data-testid={`history-item-${snapshot.id}`}>
            <label>
              <input
                type="checkbox"
                data-testid={`history-select-${snapshot.id}`}
                checked={selectedIds.includes(snapshot.id)}
                onChange={() => toggleSelect(snapshot.id)}
              />
              {new Date(snapshot.timestamp).toLocaleString()}
              {snapshot.archived ? (
                <span data-testid={`history-archived-${snapshot.id}`}> (NAS保管)</span>
              ) : null}
            </label>
            <button
              type="button"
              data-testid={`history-restore-${snapshot.id}`}
              onClick={() => void handleRestore(snapshot)}
            >
              復元
            </button>
          </li>
        ))}
      </ul>
      {canShowDiff && decoded[first] !== undefined && decoded[second] !== undefined ? (
        <DiffView before={decoded[second]} after={decoded[first]} />
      ) : null}
    </div>
  );
}
