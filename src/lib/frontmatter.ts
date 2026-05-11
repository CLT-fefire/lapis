/**
 * frontmatter 분리 — markdown.ts의 FRONTMATTER_RE 패턴 재사용하되,
 * frontmatter 자체를 텍스트로 보존 (linkRewrite에서 수정 필요).
 */

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

export interface SplitResult {
  hasFrontmatter: boolean;
  frontmatter: string; // YAML 본문 (--- 제외)
  body: string;
}

export function splitFrontmatter(raw: string): SplitResult {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { hasFrontmatter: false, frontmatter: "", body: raw };
  }
  const [, fm, body] = match;
  return { hasFrontmatter: true, frontmatter: fm, body };
}
