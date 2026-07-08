// DiffView.tsx — 2スナップショット間の差分を色分け表示(表示時に算出。SPEC.md §4.3)
import { computeDiff } from "../../lib/diff";

export function DiffView({ before, after }: { before: string; after: string }) {
  const parts = computeDiff(before, after);
  return (
    <div data-testid="diff-view">
      {parts.map((part, i) => {
        if (part.type === "insert") {
          return (
            <ins key={i} data-testid={`diff-insert-${i}`}>
              {part.text}
            </ins>
          );
        }
        if (part.type === "delete") {
          return (
            <del key={i} data-testid={`diff-delete-${i}`}>
              {part.text}
            </del>
          );
        }
        return <span key={i}>{part.text}</span>;
      })}
    </div>
  );
}
