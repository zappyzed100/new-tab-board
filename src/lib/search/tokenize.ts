// tokenize.ts — 全文検索用のトークナイザ(単語単位・大文字小文字を無視。SPEC.md §4.3)
const WORD_PATTERN = /[\p{L}\p{N}_]+/gu;

export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(WORD_PATTERN);
  return matches ? [...new Set(matches)] : [];
}
