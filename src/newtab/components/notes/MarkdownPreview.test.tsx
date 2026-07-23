// MarkdownPreview.test.tsx — Markdownプレビュー(KaTeX数式 + sanitize)の単体テスト
// DOMPurifyがDOMを要求するためjsdom環境で走らせる。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MarkdownPreview } from "./MarkdownPreview";

// globals:false のため自動クリーンアップが効かない——明示的に消さないと前のテストの
// markdown-preview が残り、getByTestId が複数一致で落ちる。
afterEach(cleanup);

function preview(content: string, imageUrls?: ReadonlyMap<string, string>): HTMLElement {
  const { container } = render(<MarkdownPreview content={content} imageUrls={imageUrls} />);
  const el = container.querySelector<HTMLElement>('[data-testid="markdown-preview"]');
  if (el === null) throw new Error("markdown-preview が描画されていない");
  return el;
}

describe("MarkdownPreview の数式(KaTeX)", () => {
  it("インライン数式 $…$ をKaTeXで描画する", () => {
    const el = preview("解は $x^2 + 1$ です");
    expect(el.querySelector(".katex")).not.toBeNull();
    // 上付き文字がMathMLの msup として構造化されている(生のLaTeXがそのまま出ていない)
    expect(el.querySelector("msup")).not.toBeNull();
    expect(el.textContent).not.toContain("$x^2 + 1$");
  });

  it("ブロック数式 $$…$$ をKaTeXで描画する", () => {
    const el = preview("$$\n\\frac{a}{b}\n$$");
    expect(el.querySelector(".katex-display")).not.toBeNull();
    expect(el.querySelector("mfrac")).not.toBeNull();
  });

  it("```math フェンスも数式として描画する", () => {
    const el = preview("```math\n\\sqrt{2}\n```");
    expect(el.querySelector(".katex")).not.toBeNull();
    expect(el.querySelector("msqrt")).not.toBeNull();
  });

  // ここが本命の回帰: DOMPurifyの既定プロファイルは semantics/annotation を許可しないため、
  // ADD_TAGS を外すと要素だけ剥がれて中のLaTeXソースが本文テキストとして残る。
  it("sanitizeでMathMLの semantics/annotation が剥がれない", () => {
    const el = preview("$a+b$");
    const annotation = el.querySelector("annotation");
    expect(el.querySelector("semantics")).not.toBeNull();
    expect(annotation).not.toBeNull();
    expect(annotation?.getAttribute("encoding")).toBe("application/x-tex");
  });

  it("数式のレイアウトに必要なインラインstyleが残る", () => {
    const el = preview("$\\frac{1}{2}$");
    const styled = [...el.querySelectorAll<HTMLElement>(".katex-html [style]")];
    expect(styled.length).toBeGreaterThan(0);
  });

  it("壊れた数式でもプレビュー全体を落とさない(throwOnError:false)", () => {
    const el = preview("書きかけ $\\frac{1$ の続き");
    expect(el.textContent).toContain("書きかけ");
    expect(el.textContent).toContain("の続き");
  });

  it("コードブロック内の $ は数式にしない", () => {
    const el = preview("```sh\necho $HOME\n```");
    expect(el.querySelector(".katex")).toBeNull();
    expect(el.textContent).toContain("$HOME");
  });
});

describe("MarkdownPreview のsanitize(数式追加で緩めていないこと)", () => {
  it("scriptタグを除去する", () => {
    const el = preview("<script>window.__pwned = 1;</script>普通の本文");
    expect(el.querySelector("script")).toBeNull();
    expect(el.textContent).toContain("普通の本文");
  });

  it("生HTMLのイベントハンドラ属性が要素として生きない", () => {
    // markdown-it の html:false(既定)が第1の門、DOMPurify が第2の門。どちらの段でも
    // onerror を持つ実要素はDOMへ現れない。
    const el = preview('<img src="x" onerror="window.__pwned = 1">');
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelectorAll("[onerror]").length).toBe(0);
  });
});

describe("MarkdownPreview の[[リンク]]", () => {
  it("[[ノート名]]をクリック可能なspanにする", () => {
    const el = preview("参照: [[線形代数]]");
    const link = el.querySelector<HTMLElement>(".wiki-link");
    expect(link?.dataset.noteTitle).toBe("線形代数");
  });
});

describe("MarkdownPreview のノート添付画像(nas: 参照)", () => {
  it("揮発キャッシュにあれば object URL へ差し替えて描画する", () => {
    const urls = new Map([["images/n1/a.png", "blob:chrome-extension://x/abc"]]);
    const el = preview("板書\n\n![黒板](nas:images/n1/a.png)", urls);
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toBe("blob:chrome-extension://x/abc");
    expect(img?.getAttribute("alt")).toBe("黒板");
  });

  it("NASが未登録(キャッシュが空)なら画像を出さない — 壊れた画像アイコンを出さない", () => {
    const el = preview("板書\n\n![黒板](nas:images/n1/a.png)", new Map());
    expect(el.querySelector("img")).toBeNull();
    // altテキストだけは残す(そこに画像があることは分かる)
    expect(el.textContent).toContain("黒板");
  });

  it("キャッシュを渡していない場合も画像を出さない", () => {
    const el = preview("![](nas:images/n1/a.png)");
    expect(el.querySelector("img")).toBeNull();
  });

  it("`..` を含む nas: 参照は解決しない(パス脱出を本文から作れない)", () => {
    const urls = new Map([["../secret.png", "blob:chrome-extension://x/leak"]]);
    const el = preview("![x](nas:../secret.png)", urls);
    expect(el.querySelector("img")).toBeNull();
  });

  it("nas: 以外の画像参照は従来どおり(sanitizeの判断に委ねる)", () => {
    const el = preview("![外部](https://example.com/a.png)", new Map());
    expect(el.querySelector("img")?.getAttribute("src")).toBe("https://example.com/a.png");
  });

  it("blob: を許可しても javascript: は通らない(URI許可を広げすぎていないこと)", () => {
    const el = preview("[link](javascript:alert(1))", new Map());
    expect(el.querySelectorAll('a[href^="javascript"]').length).toBe(0);
    expect(el.textContent).toContain("link");
  });
});
