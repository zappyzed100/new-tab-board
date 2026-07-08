// SnapshotScheduler.tsx — useSnapshotSchedulerを実行するだけの非表示コンポーネント
// (呼び出し側がkey={noteId}を指定して再マウントすることで、ノート切替時に
// スケジューラの内部状態(前回スナップショット時刻等)をリセットする設計)
import { useSnapshotScheduler } from "../../lib/useSnapshotScheduler";

export function SnapshotScheduler({ noteId, content }: { noteId: string; content: string }) {
  useSnapshotScheduler(noteId, content);
  return null;
}
