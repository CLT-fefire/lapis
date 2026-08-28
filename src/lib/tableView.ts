import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 한눈에 보기(코드 이름은 `tableView`)의 **순수 절반** — 컬럼 열거 · 셀 값 · 정렬 · 필터 · 저장뷰 직렬화.
 *
 * store도 IO도 만지지 않는다. Node 테스트에서 그대로 import 되어야 정렬 규칙과
 * 저장뷰 파싱을 고정할 수 있기 때문이다(`fullTextOptions`·`snippet`·`cacheDelta`와 같은 이유).
 */

/** 컬럼 식별자 — 붙박이 5종이거나 `props`의 frontmatter 키. */
export type ColumnKey = string;

/** `props`로 가지 않고 `LinkInfo`의 전용 필드에서 오는 컬럼. */
export const BUILTIN_COLUMNS = ["title", "doc_kind", "topic", "tags", "path"] as const;

const BUILTIN_SET = new Set<string>(BUILTIN_COLUMNS);

/**
 * ⚠️ **붙박이가 덮는 frontmatter 키는 추가 후보에서 뺀다.** `doc_kind`·`topic`·`tags`는
 * `props`에도 그대로 들어 있어서, 안 빼면 같은 값을 내는 컬럼이 목록에 두 번 뜬다.
 * `title`도 마찬가지고, `aliases`·`related`는 목록 표시에 쓸모가 없다.
 */
const SHADOWED_PROPS = new Set(["doc_kind", "topic", "tags", "title", "aliases", "related"]);

export interface ColumnOption {
  key: ColumnKey;
  /** 이 키에 값이 있는 노트 수 — 빈도순 정렬과 "쓸모 있나" 판단의 근거. */
  count: number;
}

/**
 * 추가할 수 있는 컬럼 후보 — vault에 **실제로 쓰이는** frontmatter 키를 빈도순으로.
 *
 * 고정 목록을 두지 않는 이유: 이 vault의 상위 키는 `project`·`created`·`authored_by`처럼
 * 규약에서 온 것도 있지만 `mem_id`·`obs_type`처럼 아카이브 도구가 넣은 것도 많다.
 * 어느 쪽이 유용한지는 vault마다 다르므로 세지 말고 **세어서 보여준다.**
 */
export function availableColumns(infos: Iterable<LinkInfo>): ColumnOption[] {
  const counts = new Map<string, number>();
  for (const info of infos) {
    for (const [key, values] of Object.entries(info.props)) {
      if (SHADOWED_PROPS.has(key)) continue;
      if (!values.some((v) => v.trim() !== "")) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** 한 셀의 표시 문자열. 값이 없으면 빈 문자열 — 정렬에서 뒤로 밀리는 신호다. */
export function cellValue(info: LinkInfo, key: ColumnKey, vaultRoot: string): string {
  switch (key) {
    case "title":
      return info.title?.trim() || info.source_name;
    case "doc_kind":
      return info.doc_kind ?? "";
    case "topic":
      return info.topic ?? "";
    case "tags":
      return info.tags.join(", ");
    case "path":
      return relativeDir(info.source_path, vaultRoot);
    default:
      return (info.props[key] ?? []).join(", ");
  }
}

/** vault 기준 상대 **디렉터리**. 파일명은 제목 컬럼이 이미 낸다. */
export function relativeDir(path: string, vaultRoot: string): string {
  const root = vaultRoot.endsWith("/") ? vaultRoot : vaultRoot + "/";
  const rel = path.startsWith(root) ? path.slice(root.length) : path;
  const cut = rel.lastIndexOf("/");
  return cut < 0 ? "" : rel.slice(0, cut);
}

export interface TableFilter {
  docKinds: Set<string>;
  topics: Set<string>;
  /** 제목·경로에 대한 부분 일치. 빈 문자열이면 무시. */
  text: string;
}

/**
 * 행 고르기.
 *
 * ⚠️ **비어 있으면 전량이다.** `stores/filters.ts`의 `applyFilters`는 아무것도 안 고르면
 * 빈 배열을 내는데(사이드바에선 그게 맞다 — 고르기 전엔 결과를 안 보여준다), 테이블은
 * 훑어보는 자리라 기본이 전량이어야 한다. 같은 이름을 쓰지 않는 이유이기도 하다.
 */
export function filterRows(
  infos: Iterable<LinkInfo>,
  filter: TableFilter,
  vaultRoot: string,
): LinkInfo[] {
  const needle = filter.text.trim().toLowerCase();
  const out: LinkInfo[] = [];
  for (const info of infos) {
    if (filter.docKinds.size > 0 && (!info.doc_kind || !filter.docKinds.has(info.doc_kind))) {
      continue;
    }
    if (filter.topics.size > 0 && (!info.topic || !filter.topics.has(info.topic))) continue;
    if (needle) {
      const hay = `${cellValue(info, "title", vaultRoot)}\n${info.source_path}`.toLowerCase();
      if (!hay.includes(needle)) continue;
    }
    out.push(info);
  }
  return out;
}

export type SortDir = "asc" | "desc";
export interface SortSpec {
  key: ColumnKey;
  dir: SortDir;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

/**
 * 두 셀 값의 비교. **오름차순 기준**이고 방향은 호출부가 뒤집는다.
 *
 * 타입을 값에서 판별한다 — 컬럼마다 스키마를 선언하게 하면 vault가 바뀔 때마다 손봐야 하고,
 * 실제로 `created`(ISO 날짜)·`version`(숫자 아님)·`project`(문자열)가 한 표에 섞인다.
 */
export function compareCells(a: string, b: string): number {
  if (ISO_DATE.test(a) && ISO_DATE.test(b)) return a < b ? -1 : a > b ? 1 : 0;
  const na = Number(a);
  const nb = Number(b);
  if (a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

/**
 * 정렬. **빈 값은 방향과 무관하게 항상 뒤로 간다.**
 *
 * 안 그러면 내림차순으로 뒤집을 때마다 값 없는 행이 화면을 가득 채운다 — 이 vault에서
 * `related`는 3%, `description`은 1%만 값이 있어서 대부분의 컬럼이 그 꼴이 된다.
 * 정렬은 "값이 있는 것들 사이의 순서"를 보려는 동작이다.
 */
export function sortRows(
  rows: readonly LinkInfo[],
  sort: SortSpec | null,
  vaultRoot: string,
): LinkInfo[] {
  if (!sort) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;

  // **셀 값을 미리 뽑는다**(decorate-sort-undecorate). 비교 함수 안에서 `cellValue`를
  // 부르면 행마다 O(log n)번 다시 계산된다. 실측(19,387 노트, `created` 정렬):
  // **27ms → 20ms**, 순서는 동일. 큰 폭은 아니지만 검색어를 칠 때마다 도는 경로다.
  const decorated = rows.map((info) => ({
    info,
    key: cellValue(info, sort.key, vaultRoot),
  }));

  decorated.sort((x, y) => {
    if (x.key === "" && y.key === "") return 0;
    if (x.key === "") return 1;
    if (y.key === "") return -1;
    const c = compareCells(x.key, y.key);
    // 동점이면 경로로 안정화 — 같은 값이 매 렌더마다 자리를 바꾸면 눈이 따라가지 못한다.
    return c !== 0 ? c * sign : x.info.source_path.localeCompare(y.info.source_path);
  });
  return decorated.map((d) => d.info);
}

// ─── 저장뷰 ──────────────────────────────────────────────────────────────────

export interface SavedView {
  id: string;
  name: string;
  columns: ColumnKey[];
  sort: SortSpec | null;
  docKinds: string[];
  topics: string[];
}

/** 기본 컬럼 — vault 실측 상위 키(`doc_kind` 99% · `topic` 98% · `created` 99%) 기준. */
export const DEFAULT_COLUMNS: ColumnKey[] = ["title", "doc_kind", "topic", "created"];

/**
 * localStorage 문자열 → 저장뷰 목록.
 *
 * ⚠️ **모양이 틀린 항목은 통째로 버리지 말고 그것만 버린다.** 저장뷰 하나가 깨졌다고
 * 나머지를 잃으면 사용자는 이유를 알 수 없다. 파싱 자체가 실패하면 빈 목록.
 */
export function parseSavedViews(raw: string | null): SavedView[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SavedView[] = [];
  for (const item of data) {
    const v = item as Partial<SavedView>;
    if (typeof v?.id !== "string" || typeof v?.name !== "string") continue;
    if (!Array.isArray(v.columns) || !v.columns.every((c) => typeof c === "string")) continue;
    out.push({
      id: v.id,
      name: v.name,
      columns: v.columns,
      sort: isSortSpec(v.sort) ? v.sort : null,
      docKinds: stringArray(v.docKinds),
      topics: stringArray(v.topics),
    });
  }
  return out;
}

function isSortSpec(v: unknown): v is SortSpec {
  const s = v as Partial<SortSpec> | null;
  return !!s && typeof s.key === "string" && (s.dir === "asc" || s.dir === "desc");
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** 컬럼이 붙박이인지 — UI가 라벨을 번역할지 키를 그대로 쓸지 가른다. */
export function isBuiltinColumn(key: ColumnKey): boolean {
  return BUILTIN_SET.has(key);
}
