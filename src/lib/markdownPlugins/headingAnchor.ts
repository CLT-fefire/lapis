import type MarkdownIt from "markdown-it";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import type Token from "markdown-it/lib/token.mjs";

/** 문서 아웃라인(TOC) 항목 — heading 1건. */
export interface HeadingInfo {
  /** 1(h1) ~ 6(h6). */
  level: number;
  /** 표시용 평문(마크다운 인라인 마크업 제거). */
  text: string;
  /** 프리뷰 헤딩 `id` 앵커 = TOC 클릭 시 스크롤 대상. */
  slug: string;
  /** 0-based 소스 라인 (parseNote가 frontmatter 줄 수만큼 보정). */
  line: number;
}

/** GitHub 스타일 slug — 한글 등 유니코드 글자/숫자는 보존. */
export function slugify(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

/** inline 토큰의 자식에서 평문만 추출 (`**bold**` → `bold`). */
function inlinePlainText(inline: Token): string {
  if (!inline.children || inline.children.length === 0) {
    return inline.content ?? "";
  }
  let out = "";
  for (const child of inline.children) {
    if (child.type === "text" || child.type === "code_inline") {
      out += child.content;
    } else if (child.type === "softbreak" || child.type === "hardbreak") {
      out += " ";
    }
  }
  out = out.trim();
  // wikilink 등 텍스트 토큰이 없는 헤딩은 raw content로 폴백.
  return out || (inline.content ?? "").trim();
}

/**
 * markdown-it core 룰: heading_open 토큰에 `id` 앵커를 부여하고
 * 헤딩 목록을 `env.headings`로 수집한다 (양방향 동기 TOC용).
 */
export function headingAnchorPlugin(md: MarkdownIt): void {
  md.core.ruler.push("lapis_heading_anchor", (state: StateCore) => {
    const tokens = state.tokens;
    const env = state.env as { headings?: HeadingInfo[] };
    const headings: HeadingInfo[] = [];
    const seen = new Map<string, number>();

    for (let i = 0; i < tokens.length; i++) {
      const open = tokens[i];
      if (open.type !== "heading_open") continue;

      const inline = tokens[i + 1];
      const text = inline ? inlinePlainText(inline) : "";

      let slug = slugify(text);
      const dup = seen.get(slug) ?? 0;
      seen.set(slug, dup + 1);
      if (dup > 0) slug = `${slug}-${dup}`;

      open.attrSet("id", slug);
      headings.push({
        level: Number(open.tag.slice(1)) || 1,
        text: text || slug,
        slug,
        line: open.map ? open.map[0] : 0,
      });
    }

    env.headings = headings;
  });
}
