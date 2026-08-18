import { m } from "$lib/paraglide/messages.js";
import type { LinkInfo, NoteEntry } from "$lib/tauri/notes";

/**
 * Phase A-1 — "필드 렌즈" 그룹핑.
 *
 * frontmatter의 한 필드(예: `status`, `phase`, `type`)를 골라 노트를 값별로 묶는다.
 * 출력은 **합성 `NoteEntry[]`**(필드값=가상 폴더, 노트=leaf) — 기존 `FileTree`가 그대로
 * 렌더(가상 스크롤·접기/펼치기·클릭 열기 재사용). 폴더 트리 기본값을 깨지 않는 *덧붙이는* 렌즈.
 *
 * 데이터 원천 = `LinkInfo.props`(Rust가 수집한 generic frontmatter).
 */

/** 값 없는 노트가 모이는 그룹 라벨. */
/**
 * ⚠️ **상수가 아니라 함수다.** 모듈 최상위 `const`로 두면 import 시점에 한 번만
 * 평가돼 로케일 변경을 못 따라온다 — `{#key $activeLocale}` remount는 컴포넌트만
 * 다시 만들지 모듈 코드를 재실행하지 않는다. 호출 시점에 해소해야 한다.
 */
export function noValueLabel(): string {
  return m.lens_no_value();
}

/** 합성 그룹 path의 prefix — 실제 노트 path는 `/`로 시작하므로 충돌 불가. */
const GROUP_PATH_PREFIX = "lens://";

/**
 * 그룹핑에 부적합한 필드 — 식별자/관계/산문/날짜. 카디널리티 휴리스틱으로 대부분 걸러지지만,
 * 저카디널리티로 새어나올 수 있는 것들을 명시 제외.
 */
const NON_GROUPING_FIELDS = new Set<string>([
  // 식별자
  "title",
  "name",
  "aliases",
  "tags", // 다중값 — Tags 탭이 담당
  // 관계 (그래프가 담당)
  "related",
  "related_pr",
  "parent_plan",
  "depends_on",
  "related_brainstorm",
  "superseded_by",
  "supersedes",
  "related_solutions",
  "related_files",
  "related_branch",
  "related_seed",
  "related_dmg",
  // 산문/메타
  "description",
  "purpose",
  "decision",
  "output",
  "deferred_reason",
  "target_audience",
  "source",
  "confluence_parent",
  "metadata",
  "files",
  // 날짜/고유 식별
  "date",
  "created",
  "last_update",
  "originsessionid",
]);

export interface GroupingCandidate {
  field: string;
  /** 이 필드를 가진 노트 수. */
  noteCount: number;
  /** 서로 다른 값 개수(카디널리티). */
  valueCount: number;
}

/**
 * 그룹핑 후보 필드 목록 — props 키를 훑어 "분류 축"에 적합한 것만.
 *
 * 적합 조건: blocklist 제외 + noteCount >= 3 + 값이 노트마다 고유하지 않음(valueCount < noteCount)
 * + 저카디널리티(valueCount <= 50). 필드명 알파벳 순 정렬(드롭다운 예측성).
 */
export function groupingCandidates(infos: LinkInfo[]): GroupingCandidate[] {
  // field -> (notes 가진 수, 값 집합)
  const noteCount = new Map<string, number>();
  const values = new Map<string, Set<string>>();

  for (const info of infos) {
    for (const [field, vals] of Object.entries(info.props ?? {})) {
      if (NON_GROUPING_FIELDS.has(field.toLowerCase())) continue;
      if (vals.length === 0) continue;
      noteCount.set(field, (noteCount.get(field) ?? 0) + 1);
      let set = values.get(field);
      if (!set) {
        set = new Set();
        values.set(field, set);
      }
      // 그룹핑은 단일 축 — 노트당 첫 값만 카운트(다중값 필드도 첫 값 기준).
      set.add(vals[0]);
    }
  }

  const out: GroupingCandidate[] = [];
  for (const [field, count] of noteCount) {
    const valueCount = values.get(field)?.size ?? 0;
    if (count < 3) continue;
    if (valueCount >= count) continue; // 노트마다 고유 -> 분류축 아님
    if (valueCount > 50) continue; // 고카디널리티 -> hairball
    out.push({ field, noteCount: count, valueCount });
  }
  out.sort((a, b) => a.field.localeCompare(b.field));
  return out;
}

/**
 * 주어진 필드로 노트를 값별 그룹(합성 `NoteEntry` 트리)으로 묶는다.
 * - 노트의 `props[field]` 첫 값으로 그룹핑. 값 없으면 `(미지정)` 그룹(맨 뒤).
 * - 그룹은 노트 수 내림차순, `(미지정)`은 항상 마지막.
 * - leaf 노트는 이름순 정렬. 그룹 이름에 개수 표기(`value · N`).
 */
export function groupNotesByField(infos: LinkInfo[], field: string): NoteEntry[] {
  const buckets = new Map<string, LinkInfo[]>();
  for (const info of infos) {
    const vals = info.props?.[field];
    const value = vals && vals.length > 0 ? vals[0] : noValueLabel();
    let arr = buckets.get(value);
    if (!arr) {
      arr = [];
      buckets.set(value, arr);
    }
    arr.push(info);
  }

  const entries: Array<{ value: string; notes: LinkInfo[] }> = [];
  for (const [value, notes] of buckets) {
    notes.sort((a, b) =>
      a.source_name.toLowerCase().localeCompare(b.source_name.toLowerCase()),
    );
    entries.push({ value, notes });
  }
  entries.sort((a, b) => {
    // (미지정)은 항상 마지막
    if (a.value === noValueLabel()) return 1;
    if (b.value === noValueLabel()) return -1;
    return b.notes.length - a.notes.length || a.value.localeCompare(b.value);
  });

  return entries.map(({ value, notes }) => ({
    path: `${GROUP_PATH_PREFIX}${field}:${value}`,
    rel_path: value,
    name: `${value} · ${notes.length}`,
    is_dir: true,
    children: notes.map((info) => ({
      path: info.source_path,
      rel_path: info.source_path,
      name: info.source_name,
      is_dir: false,
      children: null,
    })),
  }));
}
