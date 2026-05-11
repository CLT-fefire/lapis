/**
 * 노트 rename / move 시 vault 내 다른 노트들의 인용을 자동 갱신.
 * 4종 패턴 처리 — 모두 코드 펜스/인라인 코드 안은 무시.
 *
 * 1. Wikilink:        [[oldStem]]            → [[newStem]]
 * 2. Wikilink alias:  [[oldStem|alias]]      → [[newStem|alias]]
 * 3. MD link:         [text](oldStem.md)     → [text](newStem.md)
 *                     [text](path/oldStem.md)→ [text](path/newStem.md) (경로 보존)
 * 4. Related (YAML):  frontmatter related 안의 oldStem 항목
 */

import { splitFrontmatter } from "$lib/frontmatter";

export interface RewriteResult {
  changed: boolean;
  newContent: string;
  occurrences: number;
}

/**
 * 한 노트 본문에서 oldStem → newStem 치환.
 * - body는 처음에 frontmatter 포함된 raw 텍스트.
 * - frontmatter의 `related` 항목 + 본문의 wikilink/md link 모두 처리.
 */
export function rewriteLinksInNote(
  raw: string,
  oldStem: string,
  newStem: string,
): RewriteResult {
  if (oldStem === newStem) {
    return { changed: false, newContent: raw, occurrences: 0 };
  }

  const { frontmatter, body, hasFrontmatter } = splitFrontmatter(raw);
  let totalOccurrences = 0;

  // 1) frontmatter related 갱신 (단순 라인 매칭 — YAML 정밀 파싱 X)
  let newFrontmatter = frontmatter;
  if (hasFrontmatter) {
    const result = rewriteRelatedInFrontmatter(frontmatter, oldStem, newStem);
    newFrontmatter = result.text;
    totalOccurrences += result.count;
  }

  // 2) 본문 wikilink + md link 갱신
  const bodyResult = rewriteLinksInBody(body, oldStem, newStem);
  totalOccurrences += bodyResult.count;

  if (totalOccurrences === 0) {
    return { changed: false, newContent: raw, occurrences: 0 };
  }

  const newContent = hasFrontmatter
    ? `---\n${newFrontmatter}\n---\n${bodyResult.text}`
    : bodyResult.text;
  return { changed: true, newContent, occurrences: totalOccurrences };
}

/**
 * frontmatter의 `related:` 항목에서 oldStem을 newStem으로.
 * 인라인 `related: [a, b]` 또는 멀티라인 `related:\n  - a\n  - b` 모두 처리.
 */
function rewriteRelatedInFrontmatter(
  yaml: string,
  oldStem: string,
  newStem: string,
): { text: string; count: number } {
  const lines = yaml.split("\n");
  let count = 0;
  let inRelatedBlock = false;
  const newLines = lines.map((line) => {
    // related: [...]
    const inlineMatch = /^related:\s*\[(.*)\]\s*$/.exec(line);
    if (inlineMatch) {
      const items = inlineMatch[1].split(",").map((item) => {
        const trimmed = item.trim();
        const stripped = trimmed.replace(/^['"]|['"]$/g, "");
        if (stripped === oldStem) {
          count++;
          return trimmed.startsWith('"') || trimmed.startsWith("'")
            ? trimmed.replace(oldStem, newStem)
            : newStem;
        }
        return trimmed;
      });
      return `related: [${items.join(", ")}]`;
    }
    // related: (시작 — 멀티라인 진입)
    if (/^related:\s*$/.test(line)) {
      inRelatedBlock = true;
      return line;
    }
    if (inRelatedBlock) {
      const itemMatch = /^(\s+-\s+)(.*)$/.exec(line);
      if (itemMatch) {
        const [, prefix, value] = itemMatch;
        const stripped = value.trim().replace(/^['"]|['"]$/g, "");
        if (stripped === oldStem) {
          count++;
          return `${prefix}${value.replace(oldStem, newStem)}`;
        }
        return line;
      } else {
        // 들여쓰기 해제 — related 블록 종료
        inRelatedBlock = false;
        return line;
      }
    }
    return line;
  });
  return { text: newLines.join("\n"), count };
}

/**
 * 본문에서 wikilink + md link 갱신.
 * 코드 펜스(```) / 인라인 코드(`...`) 안은 무시.
 */
function rewriteLinksInBody(
  body: string,
  oldStem: string,
  newStem: string,
): { text: string; count: number } {
  let count = 0;
  const lines = body.split("\n");
  let inFence = false;

  // 정규식 escape
  const escapedOld = escapeRegex(oldStem);
  // Wikilink: [[oldStem]] or [[oldStem|alias]] — alias 보존
  const wikilinkRe = new RegExp(`\\[\\[(${escapedOld})(\\|[^\\]\\n]*)?\\]\\]`, "g");
  // MD link: [text](oldStem.md) or [text](path/oldStem.md) or [text](oldStem.md#anchor)
  const mdlinkRe = new RegExp(
    `(\\]\\(\\s*)([^)\\n]*?\\/)?${escapedOld}(\\.md)(#[^)\\n]*)?(\\s*\\))`,
    "gi",
  );

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    // 인라인 코드 영역 보호: backtick 사이는 그대로 두기 위해 split
    const segments = splitByInlineCode(line);
    const replaced = segments
      .map((seg) => {
        if (seg.isCode) return seg.text;
        let s = seg.text;
        s = s.replace(wikilinkRe, (_match, _stem, aliasPart) => {
          count++;
          return `[[${newStem}${aliasPart ?? ""}]]`;
        });
        s = s.replace(mdlinkRe, (_match, prefix, pathPart, _ext, anchor, suffix) => {
          count++;
          return `${prefix}${pathPart ?? ""}${newStem}.md${anchor ?? ""}${suffix}`;
        });
        return s;
      })
      .join("");
    return replaced;
  });

  return { text: newLines.join("\n"), count };
}

interface Segment {
  text: string;
  isCode: boolean;
}

/** 한 줄을 backtick 기준으로 [code, plain, code, plain, ...] 세그먼트로. */
function splitByInlineCode(line: string): Segment[] {
  const segments: Segment[] = [];
  let current = "";
  let inCode = false;
  for (const c of line) {
    if (c === "`") {
      if (current.length > 0) {
        segments.push({ text: current, isCode: inCode });
        current = "";
      }
      // backtick 자체는 어디로 갈까 — 모드 전환만, 본문엔 유지
      segments.push({ text: "`", isCode: inCode });
      inCode = !inCode;
    } else {
      current += c;
    }
  }
  if (current.length > 0) {
    segments.push({ text: current, isCode: inCode });
  }
  return segments;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
