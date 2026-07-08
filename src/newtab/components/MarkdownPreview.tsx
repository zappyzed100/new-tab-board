// MarkdownPreview.tsx — Markdown→HTML変換+sanitizeのプレビュー表示(SPEC.md §4.2)
import { useMemo } from "react";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";

const md = new MarkdownIt().use(taskLists, { enabled: true, label: true });

export function MarkdownPreview({ content }: { content: string }) {
  const html = useMemo(() => DOMPurify.sanitize(md.render(content)), [content]);
  // biome-ignore/eslint的な注意: contentは常にDOMPurify.sanitizeを通してからのみ挿入する
  return <div data-testid="markdown-preview" dangerouslySetInnerHTML={{ __html: html }} />;
}
