import { resolveTarget, targetName, type LinkIndex } from "$lib/linkIndex";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * vault 위생 감사 — **고아 노트 · 태그 중복 후보 · 모호한 이름.**
 *
 * `brokenLinks.ts`와 같은 부류다: 인덱스에 이미 있는 것만 읽고, 아무것도 쓰지 않으며,
 * 앱과 CLI가 **같은 함수**를 쓴다.
 *
 * ## ⚠️ 판단하지 않는다
 *
 * "합쳐라" · "지워라"가 아니라 **"이것들이 이렇게 생겼다 + 숫자"** 까지만 낸다. 되돌릴 수
 * 없는 실행은 `tag rename`이 맡고, 그건 미리보기 → 백업 → 롤백을 거친다.
 *
 * 감사 도구가 오탐을 섞어 권하기 시작하면 **목록 자체를 안 믿게 된다.** 그래서 판정을
 * 좁게 잡았다 — 뺀 것들(편집거리 오타 탐지 · 단수복수 · 계층 없는 태그)의 근거는
 * 계획 문서에 있다.
 *
 * ## ⚠️ 인덱스 빌드 경로에 넣지 않는다
 *
 * `brokenLinks`와 같은 이유다. 요청 시에만 계산한다 — 기동 경로에 순회를 얹으면
 * `buildIndexChunked`가 존재하는 이유를 갉아먹는다.
 */

/** 결정적 문자열 비교 — **UTF-16 코드 단위**. 로케일에 따라 순서가 갈리지 않게. */
const asc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ─── 고아 노트 ────────────────────────────────────────────────────────────────

export interface OrphanNote {
  path: string;
  /** 표시 이름 — `title` 우선, 없으면 파일 이름. */
  name: string;
  /**
   * 이 노트가 **내보내는** 링크 수(본문 ∪ 프론트매터, 중복 제거).
   *
   * ⚠️ 진입점 오탐을 새 개념 없이 가르는 수단이다. 허브(vault의 HOME 같은 것)는 들어오는
   * 링크가 없어도 **정상**이고, 그건 나가는 링크가 많다는 것으로 드러난다. 프론트매터
   * 표식이나 제외 설정을 새로 만들지 않는 대신 사람이 두 숫자를 보고 판단한다.
   */
  outgoing: number;
}

/**
 * 들어오는 링크가 없는 노트.
 *
 * **본문 위키링크와 프론트매터 교차참조를 둘 다 본다.** 한쪽만 보면 `related` ·
 * `amends` · `superseded_by`로만 걸린 노트를 고아로 오판한다.
 *
 * 백링크가 이 앱의 주된 이동 수단이므로, 들어오는 링크가 없는 노트는 사실상 닿을 수 없다.
 * 끊긴 링크 감사의 정확한 거울상이다.
 *
 * 정렬은 경로 오름차순 — 관련도가 아니라 **결정성** 때문이다. 순서를 안 정하면 답이
 * 인덱스에 담긴 순서에 흔들린다.
 */
export function findOrphans(index: LinkIndex): OrphanNote[] {
  const out: OrphanNote[] = [];
  for (const info of index.byPath.values()) {
    const path = info.source_path;
    const viaBody = index.backlinks.get(path)?.size ?? 0;
    const viaFrontmatter = index.relations.incoming.get(path)?.length ?? 0;
    if (viaBody > 0 || viaFrontmatter > 0) continue;
    out.push({ path, name: info.title ?? info.source_name, outgoing: countOutgoing(index, info) });
  }
  out.sort((a, b) => asc(a.path, b.path));
  return out;
}

/**
 * 이 노트가 실제로 닿는 다른 노트의 수.
 *
 * ⚠️ 링크 **개수**가 아니라 **대상 노트 수**다. 같은 노트를 세 번 가리킨 문서가 세 곳과
 * 이어진 것처럼 보이면 허브 판별이 왜곡된다. 자기 자신도 세지 않는다.
 *
 * ⚠️ 해소되지 않는 링크는 세지 않는다 — 그건 끊긴 링크이고 `findBrokenLinks`의 몫이다.
 */
function countOutgoing(index: LinkIndex, info: LinkInfo): number {
  const reached = new Set<string>();
  for (const raw of info.targets) {
    const name = targetName(raw);
    if (!name) continue;
    const p = resolveTarget(name, index, info.source_path);
    if (p && p !== info.source_path) reached.add(p);
  }
  for (const r of index.relations.outgoing.get(info.source_path) ?? []) {
    if (r.path !== info.source_path) reached.add(r.path);
  }
  return reached.size;
}

// ─── 태그 위생 ────────────────────────────────────────────────────────────────

export type TagIssueKind = "same-leaf" | "case-only" | "near-universal";

export interface TagIssue {
  kind: TagIssueKind;
  /** 관련된 태그들과 각각의 노트 수. 경로처럼 **이름 오름차순**으로 고정한다. */
  tags: { tag: string; count: number }[];
}

/**
 * 태그를 몇 개의 노트가 쓰는지. 한 노트가 같은 태그를 두 번 적어도 한 번만 센다.
 */
function tagCounts(infos: readonly LinkInfo[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const info of infos) {
    for (const tag of new Set(info.tags ?? [])) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/** `a/b/c` → `c`. 계층이 없으면 태그 전체가 잎이다. */
const leafOf = (tag: string): string => tag.split("/").pop() ?? tag;

const toEntries = (counts: Map<string, number>, tags: string[]) =>
  tags.sort(asc).map((tag) => ({ tag, count: counts.get(tag) ?? 0 }));

export interface TagAuditOptions {
  /**
   * 이 비율 이상의 노트에 붙은 태그를 "필터로 무용"이라고 본다.
   *
   * ⚠️ 임의값이다. 이 판정만 성격이 다르다 — 중복이 아니라 **다른 종류의 신호**이고,
   * 셋 중 가장 약하다.
   */
  universalRatio?: number;
  /** 이보다 노트가 적으면 `near-universal`을 판정하지 않는다. 새 vault가 전부 걸린다. */
  minNotesForUniversal?: number;
}

/**
 * 태그 중복 후보.
 *
 * 판정 셋 — 실측에서 실제로 나온 것들이다:
 *
 * - **같은 잎, 다른 부모** (`class/silent-failure` ↔ `issue/silent-failure`).
 *   같은 개념을 두 분류축에 걸어둔 것.
 * - **대소문자만 다름.** `norm()`이 NFC만 하고 소문자로 접지 않으므로 실재할 수 있다.
 * - **거의 모든 노트에 붙은 태그.** 중복은 아니지만 필터로 쓸모가 없다.
 */
export function findTagIssues(
  infos: readonly LinkInfo[],
  opts: TagAuditOptions = {},
): TagIssue[] {
  const { universalRatio = 0.9, minNotesForUniversal = 5 } = opts;
  const counts = tagCounts(infos);
  const issues: TagIssue[] = [];

  // ⚠️ **대소문자를 먼저 본다.** `subject/CLI`와 `subject/cli`는 잎도 같아서 아래 판정에도
  // 걸리는데, 그렇게 보고하면 "부모가 다르다"는 틀린 라벨이 붙는다. 처방이 훨씬 분명한
  // 쪽(대소문자를 맞춰라)으로 낸다.
  const byFolded = new Map<string, string[]>();
  for (const tag of counts.keys()) {
    const k = tag.toLowerCase();
    (byFolded.get(k) ?? byFolded.set(k, []).get(k)!).push(tag);
  }
  const caseOnly = new Set<string>();
  for (const [, tags] of byFolded) {
    if (tags.length < 2) continue;
    issues.push({ kind: "case-only", tags: toEntries(counts, [...tags]) });
    for (const t of tags) caseOnly.add(t);
  }

  // 같은 잎, 다른 부모 — 계층이 없는 태그(`solo`)는 자기 자신뿐이라 걸리지 않는다.
  const byLeaf = new Map<string, string[]>();
  for (const tag of counts.keys()) {
    const leaf = leafOf(tag).toLowerCase();
    (byLeaf.get(leaf) ?? byLeaf.set(leaf, []).get(leaf)!).push(tag);
  }
  for (const [, tags] of byLeaf) {
    if (tags.length < 2) continue;
    // 대소문자로 이미 알린 조합은 두 번 알리지 않는다.
    if (tags.every((t) => caseOnly.has(t))) continue;
    issues.push({ kind: "same-leaf", tags: toEntries(counts, [...tags]) });
  }

  // 거의 모든 노트에 붙은 태그.
  if (infos.length >= minNotesForUniversal) {
    const threshold = infos.length * universalRatio;
    for (const [tag, count] of counts) {
      if (count >= threshold) issues.push({ kind: "near-universal", tags: [{ tag, count }] });
    }
  }

  // 결정성 — 종류 안에서는 첫 태그 이름순.
  const order: TagIssueKind[] = ["same-leaf", "case-only", "near-universal"];
  issues.sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) || asc(a.tags[0].tag, b.tags[0].tag),
  );
  return issues;
}

// ─── 모호한 이름 ──────────────────────────────────────────────────────────────

export interface AmbiguousName {
  /** 소문자 정규형 — 해소기가 쓰는 키 그대로다. */
  name: string;
  paths: string[];
}

/**
 * 같은 이름으로 해소되는 노트가 둘 이상인 것.
 *
 * ⚠️ 해소 규칙이 고쳐진 뒤에도(#220) **충돌 자체는 남는다.** 문서 안의 링크는 가장 가까운
 * 것으로 가지만, 사람이 `lapis open`에 그 이름을 주면 거부된다 — 맥락이 없어 추측할 수
 * 없기 때문이다. 어느 이름이 그런지 알아야 이름을 바꾸든 경로로 부르든 할 수 있다.
 */
export function findAmbiguousNames(index: LinkIndex): AmbiguousName[] {
  const out: AmbiguousName[] = [];
  for (const [name, paths] of index.resolver) {
    if (paths.length < 2) continue;
    out.push({ name, paths: [...paths].sort(asc) });
  }
  out.sort((a, b) => asc(a.name, b.name));
  return out;
}
