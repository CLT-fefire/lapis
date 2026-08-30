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
import { NOTE_EXTENSIONS } from "$lib/notePath";
import { codeBlockLines } from "$lib/codeLines";

// ⚠️ 이 규칙은 예전에 **여기 비공개로** 있었다. 그래서 같은 교훈이 이 파일 밖으로
//    나가지 못했고, `openTasks` 와 `maskNonProse` 가 각자 naive 사본을 갖게 됐다.
//    지금은 `$lib/codeLines` 하나가 주인이고 `check:arch` 가 사본을 막는다.

export interface RewriteResult {
  changed: boolean;
  newContent: string;
  occurrences: number;
}

/** dry-run 결과의 affected 노트 1건. */
export interface LinkRewritePreviewItem {
  path: string;
  occurrences: number;
  /** rewrite 적용 결과 본문 — confirm 시 이걸 그대로 쓸 수 있어 read를 두 번 안 함. */
  newContent: string;
}

export interface LinkRewritePreview {
  oldStem: string;
  newStem: string;
  items: LinkRewritePreviewItem[];
  /** items 전체 occurrences 합. */
  totalOccurrences: number;
}

/**
 * 모든 노트(path → raw) 맵을 받아 affected 목록을 미리 계산.
 *
 * Pure function — vault IO나 Tauri 의존성 없음 → vitest로 단위 테스트 가능.
 * 호출자는 사전에 모든 노트의 raw를 읽어 `notes` 맵으로 넘겨야 함.
 */
export function computeLinkRewritePreview(
  notes: Map<string, string>,
  oldStem: string,
  newStem: string,
): LinkRewritePreview {
  const items: LinkRewritePreviewItem[] = [];
  let total = 0;
  if (oldStem === newStem) {
    return { oldStem, newStem, items, totalOccurrences: 0 };
  }
  for (const [path, raw] of notes) {
    const r = rewriteLinksInNote(raw, oldStem, newStem);
    if (r.changed) {
      items.push({ path, occurrences: r.occurrences, newContent: r.newContent });
      total += r.occurrences;
    }
  }
  // path 사전순(읽기 편하게)
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { oldStem, newStem, items, totalOccurrences: total };
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
 * 코드 펜스(``` 또는 ~~~) / 인라인 코드(`...`, ``...``, ```...``` 등) 안은 무시.
 */
function rewriteLinksInBody(
  body: string,
  oldStem: string,
  newStem: string,
): { text: string; count: number } {
  let count = 0;
  const lines = body.split("\n");
  // 코드 블록(fence / 들여쓰기 코드블록) 라인을 markdown-it 블록 파스로 정확히 식별.
  // 기존 naive ``` 라인 토글이 놓치던 들여쓰기 코드블록·인용 내부 펜스 등도 보호.
  const codeLines = codeBlockLines(body);

  // 정규식 escape
  const escapedOld = escapeRegex(oldStem);
  // Wikilink: [[oldStem]] · [[oldStem#anchor]] · [[oldStem|alias]] · [[oldStem#anchor|alias]]
  // ⚠️ 앵커와 별칭을 **둘 다 보존**한다. 마크다운 링크는 처음부터 앵커를 보존했는데
  //    위키링크만 안 했다 — 앵커가 해소되게 된 뒤로는 여기가 이름 바꾸기가 링크를
  //    조용히 깨는 경로가 된다. 앵커 안의 `#`은 그대로 두되 `|`에서 멈춘다.
  const wikilinkRe = new RegExp(
    `\\[\\[(${escapedOld})(#[^\\]\\n|]*)?(\\|[^\\]\\n]*)?\\]\\]`,
    "g",
  );
  // MD link: [text](oldStem.md) or [text](path/oldStem.md) or [text](oldStem.md#anchor)
  //
  // 🔴 **확장자를 잡아서 그대로 되쓴다.** 예전엔 `(\.md)` 만 잡고 치환에서 `.md` 를
  //    하드코딩했다. 그래서 `.mmd` 노트는 링크가 **아예 안 잡히거나**(못 바꿈),
  //    바꾸면 없는 `.md` 를 가리켰다 — 둘 다 조용히 끊긴다.
  //
  // ⚠️ 목록은 `notePath.ts` 것을 쓴다. 여기 다시 적으면 그게 갈린다.
  const extAlt = NOTE_EXTENSIONS.join("|");
  const mdlinkRe = new RegExp(
    `(\\]\\(\\s*)([^)\\n]*?\\/)?${escapedOld}(\\.(?:${extAlt}))(#[^)\\n]*)?(\\s*\\))`,
    "gi",
  );

  const newLines = lines.map((line, idx) => {
    // 코드 블록 라인은 통째로 보호 (AST 기반 식별).
    if (codeLines.has(idx)) return line;

    // 인라인 코드 영역 보호: backtick run 단위로 정확히 매칭.
    const segments = splitByInlineCode(line);
    const replaced = segments
      .map((seg) => {
        if (seg.isCode) return seg.text;
        let s = seg.text;
        s = s.replace(wikilinkRe, (_match, _stem, anchorPart, aliasPart) => {
          count++;
          return `[[${newStem}${anchorPart ?? ""}${aliasPart ?? ""}]]`;
        });
        // ⚠️ `ext` 는 **원문 그대로**다(`.mmd` · `.MMD` 포함). 소문자로 눕히거나
        //    `.md` 로 바꾸면 가리키는 파일이 없어진다.
        s = s.replace(mdlinkRe, (_match, prefix, pathPart, ext, anchor, suffix) => {
          count++;
          return `${prefix}${pathPart ?? ""}${newStem}${ext}${anchor ?? ""}${suffix}`;
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

/**
 * 한 줄을 backtick **run** 기준으로 [plain, code, plain, ...] 세그먼트로.
 *
 * CommonMark inline code: 같은 길이의 backtick run으로 열고 닫는다.
 *   - `` ` `` ↔ `` ` ``       (run length 1)
 *   - `` `` `` ↔ `` `` ``    (run length 2 — 안에 single backtick 허용)
 *   - 다른 길이의 run은 안에서 평범한 문자로 간주
 *
 * 닫히지 않은 inline code는 라인 끝까지 code 영역으로 유지 (보수적 — 잘못된 매치보다 안전).
 *
 * backtick run 자체는 plain segment로 push (wikilink/mdlink 매칭에 영향 없음).
 */
function splitByInlineCode(line: string): Segment[] {
  const segments: Segment[] = [];
  let current = "";
  let inCode = false;
  let openRunLen = 0;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (ch !== "`") {
      current += ch;
      i++;
      continue;
    }
    // backtick run 측정.
    let runLen = 0;
    while (i + runLen < line.length && line[i + runLen] === "`") runLen++;
    const run = line.substring(i, i + runLen);

    if (!inCode) {
      // 코드 영역 열기.
      if (current.length > 0) {
        segments.push({ text: current, isCode: false });
        current = "";
      }
      segments.push({ text: run, isCode: false });
      inCode = true;
      openRunLen = runLen;
    } else if (runLen === openRunLen) {
      // 정확히 같은 길이 → 닫기.
      if (current.length > 0) {
        segments.push({ text: current, isCode: true });
        current = "";
      }
      segments.push({ text: run, isCode: false });
      inCode = false;
      openRunLen = 0;
    } else {
      // 다른 길이 — 코드 안의 backtick으로 취급.
      current += run;
    }
    i += runLen;
  }
  if (current.length > 0) {
    segments.push({ text: current, isCode: inCode });
  }
  return segments;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
