import type { LinkInfo } from "$lib/tauri/notes";

/**
 * Phase A-2 — frontmatter 기반 "타입 있는 관계" 인덱스.
 *
 * 기존 백링크(linkIndex.backlinks)는 **본문** wikilink/md-link만 담당하고,
 * frontmatter의 cross-ref 필드(`parent_plan`, `depends_on`, `related_brainstorm`,
 * `superseded_by`, `related` …)는 본 모듈이 **관계 타입(=필드명)을 보존해** 양방향으로 인덱싱한다.
 *
 * 값은 `LinkInfo.props`(Rust가 수집한 generic frontmatter)에서 읽어
 * `normalizeRef`로 정규화 후 resolver로 노트 path에 매핑한다.
 */

/** 관계 1건 — 타입(frontmatter 필드명) + 상대 노트 절대 경로. */
export interface Relation {
  type: string;
  path: string;
}

export interface RelationIndex {
  /** source path → 이 노트가 frontmatter로 선언한 outgoing 관계. */
  outgoing: Map<string, Relation[]>;
  /** target path → 역방향(이 노트를 가리키는 다른 노트의 관계). */
  incoming: Map<string, Relation[]>;
}

/**
 * 관계 후보에서 제외할 필드 — 노트 **자신을 기술**하는 메타(상호참조 아님).
 *
 * ⚠️ allowlist가 **아니다**: 여기 없는 임의 필드는 값이 노트로 resolve되면 자동으로 관계가 된다
 * (D2 self-filtering). 이 denylist는 `title`/`name`이 우연히 다른 노트 stem과 일치해
 * 거짓 관계를 만드는 것만 막는 안전장치다.
 */
export const NON_RELATION_FIELDS = new Set<string>([
  "title",
  "name",
  "aliases",
  "tags",
  "doc_kind",
  "topic",
  "date",
  "created",
  "last_update",
  "status",
  "priority",
  "phase",
  "severity",
  "branch",
  "current_branch",
  "description",
  "purpose",
  "target_audience",
  "decision",
  "output",
  "deferred_reason",
  "user_confirmed",
  "metadata",
  "files",
  "owner",
]);

/**
 * frontmatter 관계 값 1개를 resolver 조회용 stem 후보 배열로 정규화.
 *
 * 실측(knowledge/lapis vault) 형태를 전부 흡수:
 * - 인라인 콤마: `a.md, b.md` → ["a", "b"]
 * - 경로: `plans/foo.md` → "foo"
 * - 확장자: `.md` / `.mmd` 제거
 * - 꼬리 주석: `brainstorms/x.md (deferred)` → "x"
 * - wikilink/alias: `[[foo|별칭]]` → "foo"
 * - 따옴표 제거
 *
 * 반환: 정규화된 stem 후보들(소문자화는 resolver lookup 시점에).
 */
export function normalizeRef(raw: string): string[] {
  return raw
    .split(",")
    .map(normalizeOne)
    .filter((s): s is string => s !== null);
}

function normalizeOne(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  // `[[target]]` / `[[target|alias]]` 벗기기
  const wl = /^\[\[([^\]]+)\]\]$/.exec(s);
  if (wl) s = wl[1].trim();
  // alias 분리 `target|alias` → target
  const pipe = s.indexOf("|");
  if (pipe !== -1) s = s.slice(0, pipe).trim();
  // 후행 괄호 주석 ` (deferred)` 등 제거
  s = s.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // 감싼 따옴표 제거
  s = s.replace(/^['"]|['"]$/g, "").trim();
  if (!s) return null;
  // 경로 → 마지막 세그먼트
  const seg = s.split("/").pop() ?? s;
  // 확장자(.md/.mmd) 제거
  const stem = seg.replace(/\.(md|mmd)$/i, "").trim();
  return stem || null;
}

/**
 * 모든 노트의 `props`를 훑어 타입 있는 관계 인덱스를 빌드.
 * resolver는 `linkIndex.buildIndex`가 만든 것(alias>title>stem 우선순위) 그대로 사용.
 */
function addRelation(map: Map<string, Relation[]>, key: string, rel: Relation) {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  if (!arr.some((r) => r.type === rel.type && r.path === rel.path)) {
    arr.push(rel);
  }
}

/** 한 노트의 props → outgoing/incoming 관계 적재. sync/chunked 빌더가 공유. */
function collectRelationsForInfo(
  info: LinkInfo,
  resolver: Map<string, string>,
  outgoing: Map<string, Relation[]>,
  incoming: Map<string, Relation[]>,
): void {
  const src = info.source_path;
  for (const [field, values] of Object.entries(info.props ?? {})) {
    if (NON_RELATION_FIELDS.has(field.toLowerCase())) continue;
    for (const value of values) {
      for (const stem of normalizeRef(value)) {
        const targetPath = resolver.get(stem.toLowerCase());
        if (!targetPath || targetPath === src) continue;
        addRelation(outgoing, src, { type: field, path: targetPath });
        addRelation(incoming, targetPath, { type: field, path: src });
      }
    }
  }
}

export function buildRelationIndex(
  infos: LinkInfo[],
  resolver: Map<string, string>,
): RelationIndex {
  const outgoing = new Map<string, Relation[]>();
  const incoming = new Map<string, Relation[]>();
  for (const info of infos) {
    collectRelationsForInfo(info, resolver, outgoing, incoming);
  }
  return { outgoing, incoming };
}

/**
 * `buildRelationIndex`의 청크 버전 — 큰 vault(12000+)에서 props 순회가 main thread를
 * 수백 ms 점유해 인덱스 빌드 스피너가 freeze되는 것을 막는다. `yieldEvery`개 노트마다
 * 이벤트 루프에 양보. 결과는 sync 버전과 동일(같은 inner 로직 공유).
 */
export async function buildRelationIndexChunked(
  infos: LinkInfo[],
  resolver: Map<string, string>,
  yieldEvery = 1500,
): Promise<RelationIndex> {
  const outgoing = new Map<string, Relation[]>();
  const incoming = new Map<string, Relation[]>();
  for (let i = 0; i < infos.length; i++) {
    collectRelationsForInfo(infos[i], resolver, outgoing, incoming);
    if (i > 0 && i % yieldEvery === 0) {
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  return { outgoing, incoming };
}

/** UI 표시용 — 관계 목록을 타입별로 묶고 상대 LinkInfo로 해석. */
export interface RelationGroup {
  type: string;
  notes: LinkInfo[];
}

export function groupRelations(
  rels: Relation[],
  byPath: Map<string, LinkInfo>,
): RelationGroup[] {
  const byType = new Map<string, LinkInfo[]>();
  for (const rel of rels) {
    const info = byPath.get(rel.path);
    if (!info) continue;
    let arr = byType.get(rel.type);
    if (!arr) {
      arr = [];
      byType.set(rel.type, arr);
    }
    if (!arr.some((i) => i.source_path === info.source_path)) arr.push(info);
  }
  const groups: RelationGroup[] = [];
  for (const [type, notes] of byType) {
    notes.sort((a, b) =>
      (a.title ?? a.source_name)
        .toLowerCase()
        .localeCompare((b.title ?? b.source_name).toLowerCase()),
    );
    groups.push({ type, notes });
  }
  groups.sort((a, b) => a.type.localeCompare(b.type));
  return groups;
}
