/**
 * frontmatter 분리 + 단일 키 패치.
 * - parseFrontmatter: raw 노트에서 YAML 블록과 본문 분리 + 파싱
 * - patchFrontmatter: 단일/복수 키 변경 → 새 raw 문자열 (Properties 인라인 편집용)
 *
 * 직렬화는 js-yaml `dump` 사용. 코멘트·공백 일부 손실 가능 — Lapis 정신상 frontmatter는
 * 데이터로만 사용하므로 실용적 트레이드오프. raw editor는 항상 직접 편집 가능.
 */

import yaml from "js-yaml";

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

export interface SplitResult {
  hasFrontmatter: boolean;
  frontmatter: string; // YAML 본문 (--- 제외)
  body: string;
}

export interface ParseResult extends SplitResult {
  data: Record<string, unknown>;
}

/** 단순 분리만 — 텍스트 유지 (linkRewrite 등 텍스트 단위 처리에 사용) */
export function splitFrontmatter(raw: string): SplitResult {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return { hasFrontmatter: false, frontmatter: "", body: raw };
  }
  const [, fm, body] = match;
  return { hasFrontmatter: true, frontmatter: fm, body };
}

/** 분리 + YAML 파싱까지. Properties 편집 진입에 필요. */
export function parseFrontmatter(raw: string): ParseResult {
  const split = splitFrontmatter(raw);
  if (!split.hasFrontmatter) {
    return { ...split, data: {} };
  }
  let data: Record<string, unknown> = {};
  try {
    const parsed = yaml.load(split.frontmatter);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    }
  } catch (err) {
    console.warn("Frontmatter YAML parse failed:", err);
  }
  return { ...split, data };
}

/**
 * Lapis 4키 스키마(SharedDocs 가이드) 우선 순서 + 일반 필드.
 * patch에 의해 신규 키가 추가될 때 삽입 위치 결정.
 */
const PREFERRED_KEY_ORDER: readonly string[] = [
  "title",
  "doc_kind",
  "topic",
  "tags",
  "aliases",
  "related",
  "date",
  "status",
];

/**
 * 단일/복수 키 변경. 기존 frontmatter + body를 받아 새 raw 문자열을 생성한다.
 * - 빈 문자열 / 빈 배열 / null / undefined → 키 제거
 * - 모든 키가 제거되면 frontmatter 블록 자체 제거
 * - 키 순서: 기존 frontmatter의 키 순서를 유지하고, 신규 키만 PREFERRED 순서로 끼움
 *
 * 사용 예:
 *   const newRaw = patchFrontmatter(raw, { title: "새 제목", doc_kind: "plan" });
 */
export function patchFrontmatter(
  raw: string,
  patch: Record<string, unknown>,
): string {
  const { data, body } = parseFrontmatter(raw);
  const originalKeys = Object.keys(data);

  const merged: Record<string, unknown> = { ...data };
  for (const [k, v] of Object.entries(patch)) {
    if (isEmptyValue(v)) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }

  if (Object.keys(merged).length === 0) {
    // frontmatter 전체 제거
    return body;
  }

  const orderedKeys = orderKeys(Object.keys(merged), originalKeys);
  const ordered: Record<string, unknown> = {};
  for (const k of orderedKeys) ordered[k] = merged[k];

  const yamlText = yaml.dump(ordered, {
    lineWidth: -1, // 한 줄 길이 제한 안 함
    flowLevel: -1, // 배열을 block 스타일(- a / - b)로
    noRefs: true,
  });
  const fmText = yamlText.endsWith("\n") ? yamlText : yamlText + "\n";
  return `---\n${fmText}---\n${body}`;
}

function isEmptyValue(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string" && v.trim() === "") return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

function orderKeys(have: string[], originalOrder: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // 1) 기존 순서 유지 (실제로 남아 있는 키만)
  for (const k of originalOrder) {
    if (have.includes(k) && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  // 2) 신규 키는 PREFERRED 순서로
  for (const k of PREFERRED_KEY_ORDER) {
    if (have.includes(k) && !seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  // 3) PREFERRED에도 없는 신규 키 (스키마 외)
  for (const k of have) {
    if (!seen.has(k)) {
      out.push(k);
      seen.add(k);
    }
  }
  return out;
}

/**
 * kebab-case 검증. SharedDocs 가이드 §2.2/§2.3.
 * - 소문자 영숫자 + 하이픈
 * - `/` 로 nested 허용 (tags용)
 * - 양 끝이 알파넘 / 연속 하이픈·슬래시 금지
 */
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)*$/;

export function isKebab(s: string): boolean {
  return KEBAB_RE.test(s);
}
