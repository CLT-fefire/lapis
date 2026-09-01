import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 필터 축의 **순수한 절반** — 무엇이 축이 되고, 무엇이 선택에 걸리나.
 *
 * ## 🔴 왜 스토어에서 뗐나
 *
 * 이 함수들은 스토어를 안 만진다. 그런데 `stores/filters.ts` 안에 있어서,
 * 헤드리스(cli·mcp)가 `applyFilters` 하나 쓰려고 **`svelte/store` 를 통째로 끌고 왔다.**
 *
 * ⚠️ 같은 모양으로 이미 한 번 당했다 — 6차에서 `commands.ts` 가 스토어를 물어 헤드리스가
 * 명령 목록을 못 읽었고, `lapis_usage` 가 "안 쓴 명령 없음"이라고 **거짓말했다.**
 *
 * 경계는 `scripts/arch-gate.mjs` 가 지킨다. 근거와 측정치는
 * `docs/reference/lapis-module-boundaries-20260830.md`.
 *
 * ⚠️ `LinkInfo` 는 **타입만** 가져온다 — 런타임 의존이 아니다.
 */

/**
 * doc_kind / topic facet 필터 — 다중 선택 (AND 조건).
 * SharedDocs Markdown-Tag-Management-Guide.md §2.1, §2.2 기반.
 */
export const DOC_KIND_ENUM: readonly string[] = [
  "requirements",
  "spec",
  "plan",
  "solution",
  "analysis",
  "brainstorm",
  "howto",
  "reference",
  "meeting-notes",
];

/** 축이 될 수 있는 필드 하나와 그 값 분포. */
export interface PropAxis {
  field: string;
  /** 값과 노트 수. 많은 순, 동점은 값 이름순. */
  values: { value: string; count: number }[];
}

/**
 * 타입 있는 필드는 **이미 자기 축**이 있다. 관계 필드는 값이 노트 이름이라 거르는 축이 아니다.
 *
 * ⚠️ `vaultAudit` 의 제외 목록과 뜻이 같다. 갈리면 "감사는 보는데 못 거르는 축"이 생긴다.
 */
const NOT_AN_AXIS = new Set([
  "doc_kind",
  "topic",
  "tags",
  "title",
  "aliases",
  "related",
  "amends",
  "superseded_by",
  "parent_plan",
  "depends_on",
]);

/** 축으로 보려면 이만큼의 노트가 그 필드를 써야 한다. */
export const AXIS_MIN_NOTES = 4;
/**
 * 서로 다른 값이 쓰인 노트 수의 이 비율을 넘으면 **열거형이 아니다.**
 *
 * ⚠️ `date` 가 96% 노트에 있지만 값이 전부 다르다 — 칩이 노트 수만큼 뜨고 하나를 고르면
 * 노트 한 개가 남는다. 그건 필터가 아니라 파일 열기다. `vaultAudit` 이 같은 질문에
 * 같은 문턱을 쓴다.
 */
export const AXIS_DISTINCT_RATIO = 0.5;

/** 노트들 → 고를 만한 축 목록. */
export function propAxes(infos: Iterable<LinkInfo>): PropAxis[] {
  const byField = new Map<string, Map<string, number>>();
  for (const info of infos) {
    for (const [field, values] of Object.entries(info.props ?? {})) {
      if (NOT_AN_AXIS.has(field)) continue;
      let counts = byField.get(field);
      if (!counts) {
        counts = new Map();
        byField.set(field, counts);
      }
      // ⚠️ 한 노트가 같은 값을 두 번 적어도 한 번만 센다 — 안 그러면 개수가 노트 수를 넘는다.
      for (const v of new Set(values)) {
        const t = v.trim();
        if (t !== "") counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
  }

  const out: PropAxis[] = [];
  for (const [field, counts] of byField) {
    const used = [...counts.values()].reduce((a, b) => a + b, 0);
    if (used < AXIS_MIN_NOTES) continue;
    if (counts.size > used * AXIS_DISTINCT_RATIO) continue;
    out.push({
      field,
      values: [...counts.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    });
  }
  return out.sort((a, b) => a.field.localeCompare(b.field));
}

/** 지금 고른 것 전부. */
export interface FilterSelection {
  docKinds: Set<string>;
  topics: Set<string>;
  folders: Set<string>;
  props: Map<string, Set<string>>;
}

export function emptySelection(): FilterSelection {
  return { docKinds: new Set(), topics: new Set(), folders: new Set(), props: new Map() };
}

/**
 * 고른 값의 총 개수.
 *
 * ⚠️ **빈 Set 인 축은 안 센다.** 값을 다 해제하면 그 축은 없는 것과 같은데, 세면
 * "필터 지우기"가 켜져 있는데 아무것도 안 걸리는 상태가 된다.
 */
export function selectionSize(sel: FilterSelection): number {
  let n = sel.docKinds.size + sel.topics.size + sel.folders.size;
  for (const values of sel.props.values()) n += values.size;
  return n;
}

export interface FacetCounts {
  docKindCounts: Map<string, number>;
  topicCounts: Map<string, number>;
}

export function buildFacetCounts(infos: LinkInfo[]): FacetCounts {
  const dk = new Map<string, number>();
  const tp = new Map<string, number>();
  for (const info of infos) {
    if (info.doc_kind) {
      dk.set(info.doc_kind, (dk.get(info.doc_kind) ?? 0) + 1);
    }
    if (info.topic) {
      tp.set(info.topic, (tp.get(info.topic) ?? 0) + 1);
    }
  }
  return { docKindCounts: dk, topicCounts: tp };
}

/**
 * 선택에 맞는 노트만.
 *
 * - 같은 축 안에서는 **OR** (doc_kind in {plan, spec})
 * - 다른 축 사이에는 **AND** (doc_kind=plan AND status=완료 AND 폴더=lapis)
 *
 * ⚠️ **아무것도 안 골랐으면 빈 배열**이다(선택 전에는 결과를 안 보여준다). 축을 더하면서
 * 이 규칙을 안 늘리면 새 축만 골랐을 때 조용히 아무것도 안 나온다 — 폴더 축에서 실제로
 * 그럴 뻔했다.
 *
 * ⚠️ 인자를 **객체 하나**로 받는다. 축이 넷이 되면서 위치 인자로는 어느 자리가 무엇인지
 * 호출부에서 안 보인다.
 */
export function applyFilters(infos: Iterable<LinkInfo>, sel: FilterSelection): LinkInfo[] {
  if (selectionSize(sel) === 0) return [];
  const out: LinkInfo[] = [];
  for (const info of infos) {
    if (sel.docKinds.size > 0) {
      if (!info.doc_kind || !sel.docKinds.has(info.doc_kind)) continue;
    }
    if (sel.topics.size > 0) {
      if (!info.topic || !sel.topics.has(info.topic)) continue;
    }
    // ⚠️ 문자열 접두사 — `folderScope.ts` 의 `inScope` 와 같은 규칙.
    if (sel.folders.size > 0) {
      let hit = false;
      for (const f of sel.folders) {
        if (info.source_path.startsWith(f)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    let propsOk = true;
    for (const [field, wanted] of sel.props) {
      if (wanted.size === 0) continue;
      const have = info.props?.[field];
      // ⚠️ 그 필드가 없는 노트는 빠진다 — `status` 없는 노트가 "완료"일 리 없다.
      if (!have || !have.some((v) => wanted.has(v.trim()))) {
        propsOk = false;
        break;
      }
    }
    if (!propsOk) continue;
    out.push(info);
  }
  return out;
}
