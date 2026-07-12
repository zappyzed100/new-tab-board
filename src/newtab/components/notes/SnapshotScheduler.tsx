// SnapshotScheduler.tsx — useSnapshotSchedulerを実行するだけの非表示コンポーネント
// (呼び出し側がkey={noteId}を指定して再マウントすることで、ノート切替時に
// スケジューラの内部状態(前回スナップショット時刻等)をリセットする設計)
import { useSnapshotScheduler } from "../../../lib/history/useSnapshotScheduler";

export function SnapshotScheduler({
  noteId,
  content,
  onSnapshot,
}: {
  noteId: string;
  content: string;
  /** スナップショットが実際に保存された直後に、その本文で呼ばれる(保存時の自動タグ付け用)。 */
  onSnapshot?: (content: string) => void;
}) {
  useSnapshotScheduler(noteId, content, onSnapshot);
  return null;
}
