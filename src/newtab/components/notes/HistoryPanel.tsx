// HistoryPanel.tsx — 履歴一覧・プレビュー・diff比較・復元(SPEC.md §4.3)
import { useEffect, useState } from "react";
import { Button, Card, Checkbox, Flex, Heading, Text } from "@radix-ui/themes";
import { History } from "lucide-react";
import { now as clockNow } from "../../../lib/runtime/clock";
import { getSnapshotsByNote, putSnapshot } from "../../../lib/storage/db";
import { summarizeSnapshot } from "../../../lib/history/history";
import { gzipCompress, gzipDecompress } from "../../../lib/history/gzip";
import { getSnapshotBody } from "../../../lib/externalIO/nasArchive";
import type { Snapshot } from "../../../types";
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
      summary: summarizeSnapshot(currentContent, null),
    });
    onRestore(text);
  }

  const [first, second] = selectedIds;
  const canShowDiff = first !== undefined && second !== undefined;

  return (
    <Card data-testid="history-panel">
      <Heading as="h2" size="3" mb="1">
        <Flex align="center" gap="1" as="span">
          <History size={15} aria-hidden="true" />
          履歴(自動保存されたスナップショット)
        </Flex>
      </Heading>
      <Text as="p" size="2" color="gray" className="hint">
        2件チェックすると差分(diff)を下に表示します
      </Text>
      <ul>
        {snapshots.map((snapshot) => (
          <li key={snapshot.id} data-testid={`history-item-${snapshot.id}`}>
            <Flex asChild align="center" gap="2">
              <Text as="label">
                <Checkbox
                  data-testid={`history-select-${snapshot.id}`}
                  checked={selectedIds.includes(snapshot.id)}
                  onCheckedChange={() => toggleSelect(snapshot.id)}
                />
                {new Date(snapshot.timestamp).toLocaleString()}
                {snapshot.archived ? (
                  <span data-testid={`history-archived-${snapshot.id}`}> (NAS保管)</span>
                ) : null}
              </Text>
            </Flex>
            {snapshot.summary ? (
              // 本文を展開せずに中身を判別できるよう、変更箇所(or 本文の最初)の一文を出す。
              <Text
                as="p"
                size="1"
                color="gray"
                className="history-summary"
                data-testid={`history-summary-${snapshot.id}`}
              >
                {snapshot.summary}
              </Text>
            ) : null}
            <Button
              type="button"
              variant="soft"
              data-testid={`history-restore-${snapshot.id}`}
              title="この時点の内容に復元する(復元前に現在の内容も保存されます)"
              onClick={() => void handleRestore(snapshot)}
            >
              ⏮️ 復元
            </Button>
          </li>
        ))}
      </ul>
      {canShowDiff && decoded[first] !== undefined && decoded[second] !== undefined ? (
        <DiffView before={decoded[second]} after={decoded[first]} />
      ) : null}
    </Card>
  );
}
