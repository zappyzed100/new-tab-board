// MarkdownPreview.tsx — Markdown→HTML変換+sanitizeのプレビュー表示(SPEC.md §4.2)
// [[ノート名]]リンクはクリック可能なspanとして描画し、onNavigateToNoteで遷移させる(§7)。
// 数式は KaTeX($…$ / $$…$$ / ```math。ユーザー指示・2026-07-23)。CDNは使わずバンドルするので
// Manifest V3のCSP(外部リソース禁止)に抵触しない——フォントもViteがassetsへ同梱する。
import { useMemo } from "react";
import type { MouseEvent } from "react";
import MarkdownIt from "markdown-it";
import type { RenderRule } from "markdown-it/lib/renderer.mjs";
import taskLists from "markdown-it-task-lists";
import katexPluginModule from "@vscode/markdown-it-katex";
import DOMPurify from "dompurify";
import type { Config as SanitizeConfig } from "dompurify";
import { Box } from "@radix-ui/themes";
import { NAS_IMAGE_SCHEME, nasRelPathFromSrc } from "../../../lib/images/noteImages";
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
installNasImageRenderer(md);
const WIKI_LINK_PATTERN = /\[\[([^[\]]+)\]\]/g;

// KaTeXの出力はMathML(semantics/annotation)とインラインstyle付きspanを含む。DOMPurifyの既定
// プロファイルは semantics/annotation を許可しないため、そのままだと要素だけ剥がれて中身の
// LaTeXソースが本文として残る(スクリーンリーダーが数式を二重に読む)。明示的に許可する。
// 添付画像は blob: の object URL(揮発キャッシュ)として差し込む。DOMPurifyの既定の
// ALLOWED_URI_REGEXP は blob: を通さないため、明示的に許可する——値を作っているのは
// このアプリ自身(URL.createObjectURL)なので、本文由来の任意URLが通るわけではない。
const SANITIZE_CONFIG: SanitizeConfig = {
  ADD_TAGS: ["semantics", "annotation"],
  ADD_ATTR: ["data-note-title", "encoding"],
  ALLOWED_URI_REGEXP:
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i,
};

/** `nas:` 参照を揮発キャッシュのobject URLへ差し替えるレンダラ。解決できない画像
 * (NAS未登録・未接続・まだ読み込めていない)は**描画しない**——壊れた画像アイコンを出さず、
 * alt テキストだけを残す(ユーザー指示: NASが未登録ならノートに表示しない)。 */
function installNasImageRenderer(instance: MarkdownIt): void {
  const renderImage: RenderRule =
    instance.renderer.rules.image ??
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  instance.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src") ?? "";
    // `nas:` 以外(http/data等)は従来どおりレンダラへ委ね、sanitizeの判断に任せる。
    if (!src.startsWith(NAS_IMAGE_SCHEME)) return renderImage(tokens, idx, options, env, self);
    const rel = nasRelPathFromSrc(src);
    const resolved = rel === null ? undefined : (env as PreviewEnv | undefined)?.imageUrls?.get(rel);
    if (resolved === undefined) {
      const alt = instance.utils.escapeHtml(token.content);
      return alt === "" ? "" : `<span class="nas-image-missing">${alt}</span>`;
    }
    token.attrSet("src", resolved);
    return renderImage(tokens, idx, options, env, self);
  };
}

/** md.render に渡す環境。画像解決だけに使う。 */
type PreviewEnv = { imageUrls?: ReadonlyMap<string, string> };

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

type Props = {
  content: string;
  onNavigateToNote?: (title: string) => void;
  /** ノート添付画像の揮発キャッシュ(NAS相対パス → object URL)。未指定/未解決なら画像は出さない。 */
  imageUrls?: ReadonlyMap<string, string>;
};

export function MarkdownPreview({ content, onNavigateToNote, imageUrls }: Props) {
  const html = useMemo(() => {
    const env: PreviewEnv = { imageUrls };
    const rendered = md.render(content, env);
    const withLinks = rendered.replace(WIKI_LINK_PATTERN, (_match, title: string) => {
      const trimmed = title.trim();
      return `<span class="wiki-link" data-note-title="${escapeAttr(trimmed)}" role="button" tabindex="0">${trimmed}</span>`;
    });
    return DOMPurify.sanitize(withLinks, SANITIZE_CONFIG);
  }, [content, imageUrls]);

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
