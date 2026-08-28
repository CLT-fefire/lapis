import { writable } from "svelte/store";
import type { LinkInfo } from "$lib/tauri/notes";

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

/** kind/topic → 노트 수 (count > 0인 것만 포함) */
export const docKindCounts = writable<Map<string, number>>(new Map());
export const topicCounts = writable<Map<string, number>>(new Map());

/** 선택된 facet 값들 (다중 선택, AND) */
export const selectedDocKinds = writable<Set<string>>(new Set());
export const selectedTopics = writable<Set<string>>(new Set());

/**
 * 폴더 축 — **경로 접두사** 집합.
 *
 * ⚠️ 2026-08-28 실측: 이 vault 는 한 안에 프로젝트가 둘이고 이름 충돌 7건이 **전부**
 * 그 사이에서 났다. 두 프로젝트가 **같은 `doc_kind` 를 쓰므로** 기존 두 축으로는 경계를
 * 못 긋는다.
 *
 * ⚠️ 값은 문자열 접두사다 — MCP `under`·`exclude` 와 **같은 규칙**이어야 한다
 * (`folderScope.ts` 참조). 앱만 디렉터리 경계로 맞추면 같은 문자열이 표면마다 다르게 먹는다.
 */
export const selectedFolders = writable<Set<string>>(new Set());

/**
 * 임의 frontmatter 축 — **필드 → 고른 값들**.
 *
 * ⚠️ 3차 분석이 이걸 `PR-C` 로 계획해 놓고 폴더 축만 넣은 채 끝냈다. 측정은 그대로였다:
 * `status` 가 **44노트(41%)** 에 있고 한눈에 보기에는 **컬럼으로 추가되는데 거를 수는
 * 없었다.** 보이는데 못 거르는 것은 반쪽이다.
 *
 * ⚠️ **아무 필드나 축이 되면 안 된다** — `propAxes` 가 고른다.
 */
export const selectedProps = writable<Map<string, Set<string>>>(new Map());

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

export function togglePropValue(field: string, value: string): void {
  selectedProps.update((m) => {
    const next = new Map(m);
    const cur = new Set(next.get(field) ?? []);
    if (cur.has(value)) cur.delete(value);
    else cur.add(value);
    // ⚠️ 비면 **지운다.** 빈 Set 을 남기면 "축은 있는데 아무것도 안 고른" 상태가 되고,
    //    그건 화면에서 구별이 안 된다.
    if (cur.size === 0) next.delete(field);
    else next.set(field, cur);
    return next;
  });
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

export function toggleDocKind(value: string): void {
  selectedDocKinds.update((set) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

export function toggleTopic(value: string): void {
  selectedTopics.update((set) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
}

export function toggleFolder(prefix: string): void {
  selectedFolders.update((set) => {
    const next = new Set(set);
    if (next.has(prefix)) next.delete(prefix);
    else next.add(prefix);
    return next;
  });
}

export function clearFilters(): void {
  selectedDocKinds.set(new Set());
  selectedTopics.set(new Set());
  selectedFolders.set(new Set());
  selectedProps.set(new Map());
}

export function clearFacetCounts(): void {
  docKindCounts.set(new Map());
  topicCounts.set(new Map());
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
