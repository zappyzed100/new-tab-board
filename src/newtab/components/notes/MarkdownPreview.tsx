// MarkdownPreview.tsx — Markdown→HTML変換+sanitizeのプレビュー表示(SPEC.md §4.2)
// [[ノート名]]リンクはクリック可能なspanとして描画し、onNavigateToNoteで遷移させる(§7)。
import { useMemo } from "react";
import type { MouseEvent } from "react";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import DOMPurify from "dompurify";
import { Box } from "@radix-ui/themes";

const md = new MarkdownIt().use(taskLists, { enabled: true, label: true });
const WIKI_LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

type Props = {
  content: string;
  onNavigateToNote?: (title: string) => void;
};

export function MarkdownPreview({ content, onNavigateToNote }: Props) {
  const html = useMemo(() => {
    const rendered = md.render(content);
    const withLinks = rendered.replace(WIKI_LINK_PATTERN, (_match, title: string) => {
      const trimmed = title.trim();
      return `<span class="wiki-link" data-note-title="${escapeAttr(trimmed)}" role="button" tabindex="0">${trimmed}</span>`;
    });
    return DOMPurify.sanitize(withLinks, { ADD_ATTR: ["data-note-title"] });
  }, [content]);

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const title = (event.target as HTMLElement).dataset.noteTitle;
    if (title && onNavigateToNote) onNavigateToNote(title);
  }

  return (
    <Box
      data-testid="markdown-preview"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
