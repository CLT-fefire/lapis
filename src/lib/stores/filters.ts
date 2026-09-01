import { writable } from "svelte/store";

/**
 * 필터 축의 **스토어 절반** — 지금 무엇이 골라져 있나, 그리고 그걸 바꾸는 일.
 *
 * ⚠️ 판정과 축 계산은 여기 없다. `$lib/filterSelection` 에 있고 **Svelte 를 안 문다** —
 * 헤드리스(cli·mcp)가 같은 규칙을 쓰기 때문이다. 여기로 되돌려 놓으면 그쪽이 순수 함수
 * 하나 때문에 프레임워크를 끌고 오게 된다. `scripts/arch-gate.mjs` 가 막는다.
 */

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
