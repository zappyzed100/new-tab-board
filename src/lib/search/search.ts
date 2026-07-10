// search.ts — 転置インデックスの構築・検索(SPEC.md §4.3 全文検索)
//
// 既知の制約: tokenize.tsは空白区切りの言語向けの近似であり、分かち書きの無い日本語の
// 文章は連続する文字列全体が1トークンになる(形態素解析は本フェーズのスコープ外)。
// #tagは単独の語として正しくマッチする。
import { getIndexEntry, putIndexEntry } from "../storage/db";
import { tokenize } from "./tokenize";

/** スナップショット本文をトークン化し、転置インデックスへ反映する。 */
export async function indexSnapshot(snapshotId: string, content: string): Promise<void> {
  const tokens = tokenize(content);
  for (const token of tokens) {
    const existing = await getIndexEntry(token);
    const refs = existing ? existing.refs : [];
    if (!refs.includes(snapshotId)) {
      await putIndexEntry({ token, refs: [...refs, snapshotId] });
    }
  }
}

/** クエリの全トークンを含むスナップショットIDの集合(AND検索)を返す。 */
export async function searchSnapshotIds(query: string): Promise<string[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const entries = await Promise.all(tokens.map((t) => getIndexEntry(t)));
  const refSets = entries.map((e) => new Set(e?.refs ?? []));
  if (refSets.some((s) => s.size === 0)) return [];
  const [first, ...rest] = refSets;
  return [...first].filter((id) => rest.every((s) => s.has(id)));
}
