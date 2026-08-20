/**
 * frontmatter 분리 + 단일 키 패치.
 * - parseFrontmatter: raw 노트에서 YAML 블록과 본문 분리 + 파싱
 * - patchFrontmatter: 단일/복수 키 변경 → 새 raw 문자열 (Properties 인라인 편집용)
 *
 * 직렬화는 js-yaml `dump` 사용. 코멘트·공백 일부 손실 가능 — Lapis 정신상 frontmatter는
 * 데이터로만 사용하므로 실용적 트레이드오프. raw editor는 항상 직접 편집 가능.
 *
 * ⚠️ **이 모듈은 사용자 파일을 다시 쓰는 유일한 frontmatter 경로다**(Properties 패널).
 * 읽기 전용 앱에서 몇 안 되는 쓰기 지점이라, 실패는 조용히 넘어가지 말고 던진다 —
 * `FrontmatterParseError` 주석 참조.
 */

import yaml from "js-yaml";

/**
 * ⚠️ 구분자 뒤 여백을 `[ \t]*`로 받는다 — `\s*`가 아니다. `\s`는 **개행을 포함**해서,
 * `---` 다음의 빈 줄까지 삼켜 `body`에서 사라진다. 그러면 속성 하나만 고쳐도 frontmatter와
 * 본문 사이 빈 줄이 없어진 채로 파일이 다시 써진다 — 이 vault의 거의 모든 노트가 그 모양이라
 * 편집할 때마다 diff에 잡음이 낀다. `linkRewrite`도 같은 분리를 쓰므로 함께 고쳐진다.
 */
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

/**
 * frontmatter를 읽을 때 쓰는 YAML 스키마 — **CORE다. js-yaml 기본값(DEFAULT)이 아니다.**
 *
 * DEFAULT 스키마엔 `timestamp` 타입이 있어 `date: 2026-08-20`을 **Date 객체**로 만든다.
 * 그 값을 다시 `dump`하면 `2026-08-20T00:00:00.000Z`가 되므로, 사용자가 태그 하나만 고쳐도
 * **파일의 날짜 표기가 통째로 바뀐다**(이 vault는 거의 모든 노트에 `created:`/`date:`가 있다).
 * 화면에도 샜다 — `String(Date)`라 Properties 패널이 `Thu Aug 20 2026 09:00:00 GMT+0900`을
 * 보여준다.
 *
 * CORE 스키마는 null·bool·int·float·str만 안다. 날짜는 문자열로 남고 왕복이 무손실이다.
 * frontmatter에 필요한 것도 딱 그만큼이다.
 */
export const FRONTMATTER_YAML_SCHEMA = yaml.CORE_SCHEMA;

/**
 * frontmatter YAML을 매핑으로 못 읽었는데 패치를 요청받았을 때 던진다.
 *
 * ⚠️ **조용히 진행하면 안 되는 자리다.** `parseFrontmatter`가 실패를 `data: {}`로 뭉개면
 * 패치는 "원래 아무 속성도 없던 노트"로 착각하고 `---\n<고친 키만>\n---`을 새로 써 넣는다.
 * 원문 frontmatter는 **한 줄도 남지 않는다.** 실측: 19,213개 노트 중 1개가 지금 이 상태다
 * (`bad indentation of a mapping entry`).
 */
export class FrontmatterParseError extends Error {
  constructor(message = "frontmatter YAML을 매핑으로 읽지 못했다 — 덮어쓰지 않는다") {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

export interface SplitResult {
  hasFrontmatter: boolean;
  frontmatter: string; // YAML 본문 (--- 제외)
  body: string;
}

export interface ParseResult extends SplitResult {
  data: Record<string, unknown>;
  /**
   * YAML을 매핑으로 못 읽었다 — **그런데 원문 텍스트는 살아 있다**(`frontmatter` 필드).
   * `data`가 비었다는 것만 보고 "빈 frontmatter"로 취급하면 안 된다. 쓰기 경로는
   * 이 값이 `true`면 손을 떼야 한다 → `FrontmatterParseError`.
   *
   * 내용이 아예 없는 `---\n---`는 **실패가 아니다**(잃을 게 없다) → `false`.
   */
  parseError: boolean;
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
    return { ...split, data: {}, parseError: false };
  }
  let data: Record<string, unknown> = {};
  let parseError = false;
  try {
    const parsed = yaml.load(split.frontmatter, { schema: FRONTMATTER_YAML_SCHEMA });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    } else if (parsed !== null && parsed !== undefined) {
      // 스칼라나 배열 — 유효한 YAML이지만 frontmatter가 아니다. 이것도 덮어쓰면 안 된다.
      parseError = true;
    }
  } catch (err) {
    console.warn("Frontmatter YAML parse failed:", err);
    parseError = true;
  }
  return { ...split, data, parseError };
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
/**
 * 빈 값도 보존하는 키 추가 — Properties UI에서 사용자가 명시적으로 "추가" 했을 때
 * patchFrontmatter는 빈 값을 deletion으로 해석하므로 별도 helper.
 *
 * 사용 예: Properties 패널에서 "+ tags" 버튼 → addFrontmatterKey(raw, "tags", []).
 */
export function addFrontmatterKey(
  raw: string,
  key: string,
  defaultValue: unknown,
): string {
  const { data, body, parseError } = parseFrontmatter(raw);
  if (parseError) throw new FrontmatterParseError();
  if (key in data) return raw; // 이미 존재 — noop
  const originalKeys = Object.keys(data);
  const merged: Record<string, unknown> = { ...data, [key]: defaultValue };
  const orderedKeys = orderKeys(Object.keys(merged), originalKeys);
  const ordered: Record<string, unknown> = {};
  for (const k of orderedKeys) ordered[k] = merged[k];
  const yamlText = yaml.dump(ordered, {
    lineWidth: -1,
    flowLevel: -1,
    noRefs: true,
    schema: FRONTMATTER_YAML_SCHEMA,
  });
  const fmText = yamlText.endsWith("\n") ? yamlText : yamlText + "\n";
  return `---\n${fmText}---\n${body}`;
}

export function patchFrontmatter(
  raw: string,
  patch: Record<string, unknown>,
): string {
  const { data, body, parseError } = parseFrontmatter(raw);
  if (parseError) throw new FrontmatterParseError();
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
    // ⚠️ **읽을 때와 같은 스키마여야 한다.** 기본 스키마로 쓰면 `2026-08-13`이 timestamp로
    // 되읽힐까 봐 `'2026-08-13'`처럼 따옴표를 씌운다 — 값은 같지만 파일이 바뀐다.
    schema: FRONTMATTER_YAML_SCHEMA,
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
