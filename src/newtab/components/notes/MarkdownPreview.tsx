// MarkdownPreview.tsx — Markdown→HTML変換+sanitizeのプレビュー表示(SPEC.md §4.2)
// [[ノート名]]リンクはクリック可能なspanとして描画し、onNavigateToNoteで遷移させる(§7)。
// 数式は KaTeX($…$ / $$…$$ / ```math。ユーザー指示・2026-07-23)。CDNは使わずバンドルするので
// Manifest V3のCSP(外部リソース禁止)に抵触しない——フォントもViteがassetsへ同梱する。
import { useMemo } from "react";
import type { MouseEvent } from "react";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";
import katexPluginModule from "@vscode/markdown-it-katex";
import DOMPurify from "dompurify";
import type { Config as SanitizeConfig } from "dompurify";
import { Box } from "@radix-ui/themes";
import "katex/dist/katex.min.css";

// @vscode/markdown-it-katex は `exports.__esModule = true` + `exports.default` のCJS。
// バンドラのinterop次第で default が名前空間オブジェクトのまま渡り、markdown-it の
// `plugin.apply(...)` が `e.apply is not a function` で落ちて**プレビュー全体が白画面**になる
// (2026-07-23に本番ビルドで実際に踏んだ——vitestのinteropでは再現しないためE2Eでしか出ない)。
const katexPlugin = (
  typeof katexPluginModule === "function"
    ? katexPluginModule
    : (katexPluginModule as { default: typeof katexPluginModule }).default
) as typeof katexPluginModule;

const md = new MarkdownIt()
  .use(taskLists, { enabled: true, label: true })
  // throwOnError:false = 書きかけの数式(打鍵の途中)でプレビュー全体を落とさず、その箇所だけ
  // KaTeXのエラー表示にする。enableFencedBlocks は ```math フェンスも数式として描画する。
  .use(katexPlugin, { throwOnError: false, enableFencedBlocks: true });
const WIKI_LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;

// KaTeXの出力はMathML(semantics/annotation)とインラインstyle付きspanを含む。DOMPurifyの既定
// プロファイルは semantics/annotation を許可しないため、そのままだと要素だけ剥がれて中身の
// LaTeXソースが本文として残る(スクリーンリーダーが数式を二重に読む)。明示的に許可する。
const SANITIZE_CONFIG: SanitizeConfig = {
  ADD_TAGS: ["semantics", "annotation"],
  ADD_ATTR: ["data-note-title", "encoding"],
};

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
    return DOMPurify.sanitize(withLinks, SANITIZE_CONFIG);
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
