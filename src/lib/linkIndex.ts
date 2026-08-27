import type { LinkInfo } from "$lib/tauri/notes";
import {
  buildRelationIndex,
  buildRelationIndexChunked,
  type RelationIndex,
} from "$lib/relations";

export interface LinkIndex {
  byPath: Map<string, LinkInfo>;
  /**
   * 키: 소문자 문자열(alias / title / file stem) → **후보 경로들**.
   *
   * ⚠️ 값이 배열인 이유 — 같은 이름의 노트가 둘 이상 있을 수 있다. 예전엔 경로 하나였고
   * **먼저 넣은 것이 이겼는데**, 순서가 vault walk 순서라 `knowledge/lapis/`가
   * `knowledge/slate/`보다 먼저 온다는 이유만으로 slate 문서의 `[[feature-map]]`이
   * lapis 문서로 갔다. 링크가 깨진 게 아니라 **엉뚱한 곳으로 간다.**
   *
   * 후보는 **한 티어에서만** 온다(alias > title > stem). 어느 것을 고를지는
   * `resolveTarget`이 링크한 노트와의 거리로 정한다.
   */
  resolver: Map<string, string[]>;
  // 키: 노트 path → 그 노트를 **본문** wikilink/md-link로 가리키는 소스 path 집합.
  // (frontmatter cross-ref는 backlinks가 아니라 relations가 타입별로 담당 — Phase A-2)
  backlinks: Map<string, Set<string>>;
  // frontmatter 기반 타입 있는 관계(parent_plan/depends_on/related/…) 양방향 인덱스.
  relations: RelationIndex;
}

/**
 * wikilink target에서 alias 분리. `[[file|alias]]` → "file"
 */
/**
 * `resolveTarget`이 실제로 읽는 것 — `resolver` 하나뿐이다.
 *
 * `LinkIndex` 전체를 요구하지 않는 이유: 백링크·관계 인덱스를 **짓는 도중에** 해소가
 * 필요하다. 그때는 인덱스가 아직 완성되지 않았다.
 */
export type ResolveSource = Pick<LinkIndex, "resolver">;

export function targetName(rawTarget: string): string {
  const idx = rawTarget.indexOf("|");
  return (idx === -1 ? rawTarget : rawTarget.slice(0, idx)).trim();
}

/**
 * `노트#헤딩` → 이름과 앵커. `#`이 없으면 `anchor`는 `null`이다.
 *
 * ⚠️ **첫 번째 `#`에서만 가른다.** 헤딩 텍스트에 `#`이 또 있을 수 있다(`C# 이야기`).
 *
 * ⚠️ 별칭(`|`)은 여기서 다루지 않는다. 순서가 `[[노트#헤딩|별칭]]`이라 **`targetName`을
 * 먼저** 통과시켜야 한다. 반대로 하면 별칭 안의 `#`이 앵커로 잡힌다.
 */
export function splitAnchor(raw: string): { name: string; anchor: string | null } {
  const i = raw.indexOf("#");
  if (i === -1) return { name: raw.trim(), anchor: null };
  return { name: raw.slice(0, i).trim(), anchor: raw.slice(i + 1).trim() };
}

/**
 * resolver가 **실제로 아는** 키. 없으면 `null`.
 *
 * ## ⚠️ 앵커 폴백을 여기 한 곳에만 둔다
 *
 * 마크다운 링크는 Rust(`extract_md_links`)가 이미 `#`을 떼고 넘긴다. 위키링크만 안 뗐다.
 * 그래서 `[[노트#헤딩]]`은 노트가 멀쩡히 있는데도 **끊긴 링크로 보고**되고, 백링크
 * 인덱스에 안 들어가 **간선이 통째로 사라졌다.** 둘 다 에러가 아니라 회색 링크와
 * 한 줄 짧은 목록으로만 보인다.
 *
 * ⚠️ **통째로 먼저 찾고, 없을 때만 앵커를 뗀다.** 파일 이름에 `#`이 들어갈 수 있어서다
 * (`C#.md`). 순서를 뒤집으면 지금 잘 가던 `[[C#]]`이 조용히 `C.md`로 간다 — 이 폴백은
 * **이미 해소되는 것을 절대 안 건드린다**는 성질이 있어야 안전하다.
 */
export function resolverKey(target: string, source: ResolveSource): string | null {
  const whole = target.trim().toLowerCase();
  if (source.resolver.has(whole)) return whole;
  const { name, anchor } = splitAnchor(target);
  if (anchor === null || !name) return null;
  const bare = name.toLowerCase();
  return source.resolver.has(bare) ? bare : null;
}

/** 경로에서 디렉터리 세그먼트만. `/v/a/b.md` → `["", "v", "a"]` */
function dirSegments(path: string): string[] {
  const segs = path.split("/");
  segs.pop();
  return segs;
}

/** 앞에서부터 몇 세그먼트가 같은가. */
function sharedDepth(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * 이름 → 경로. 후보가 여럿이면 **`fromPath`와 가장 가까운 것**을 고른다.
 *
 * ## ⚠️ `fromPath`가 필수인 이유
 *
 * 링크에는 **맥락**이 있다 — slate 문서가 쓴 `[[feature-map]]`은 slate 것을 뜻한다.
 * 선택적으로 두면 넘기는 걸 잊어도 컴파일이 되고, 그러면 조용히 옛 동작(아무거나 하나)
 * 으로 돌아간다. 맥락이 **없는** 경우(사람이 CLI에 이름을 직접 준 경우)는 여기가 아니라
 * `mcp/query.ts`가 다루며, 거기서는 추측하지 않고 거부한다.
 *
 * ## 순서
 *
 * **티어(alias > title > stem) → 같은 티어 안에서 가장 가까운 것 → 경로 오름차순.**
 *
 * 티어가 먼저인 것은 **기존 동작 보존**이다. alias는 사람이 일부러 단 이름이고, 충돌이
 * 없던 vault에서도 alias와 stem이 겹칠 수 있다. 근접을 티어보다 앞에 두면 그런 vault의
 * 링크가 조용히 다른 곳을 가리키게 된다. 티어 선별은 `buildResolverAndByPath`가 이미
 * 끝냈으므로 여기서는 거리만 본다.
 *
 * 동률 타이브레이크가 경로순인 것은 결정성 때문이다 — 그게 없으면 답이 vault walk 순서에
 * 흔들린다. `localeCompare`를 쓰지 않는 이유는 로케일에 따라 갈리기 때문이다.
 */
export function resolveTarget(
  target: string,
  index: ResolveSource,
  fromPath: string,
): string | null {
  const key = resolverKey(target, index);
  const candidates = key === null ? undefined : index.resolver.get(key);
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const from = dirSegments(fromPath);
  let best = candidates[0];
  let bestDepth = sharedDepth(from, dirSegments(best));
  for (const c of candidates.slice(1)) {
    const d = sharedDepth(from, dirSegments(c));
    if (d > bestDepth || (d === bestDepth && c < best)) {
      best = c;
      bestDepth = d;
    }
  }
  return best;
}

/** 위키링크 하나를 풀어 놓은 것 — **어디로 갈지**와 **어디로 스크롤할지**. */
export interface WikilinkTarget {
  /** 이동할 노트. 같은 문서 안이거나 해소 실패면 `null`. */
  path: string | null;
  /** 스크롤할 헤딩(원문 그대로). 없으면 `null`. */
  anchor: string | null;
  /** `[[#헤딩]]` — 지금 보고 있는 문서 안. `path`가 `null`인 두 경우를 가른다. */
  sameDoc: boolean;
}

/**
 * `[[…]]` 하나를 이동 목적지로 푼다. **`resolverKey`와 같은 우선순위를 쓴다** —
 * 두 곳에서 따로 판단하면 링크가 파랗게 보이는데 눌러도 안 가는 상태가 생긴다.
 *
 * ⚠️ 앵커를 **해소에 실제로 썼을 때만** 돌려준다. `C#.md`가 있어서 `[[C#]]`이 통째로
 * 해소됐다면 스크롤할 헤딩은 없다. 여기서 틀리면 맞는 노트에 도착해 없는 헤딩을 찾다가
 * **아무 일도 안 일어난 것처럼** 보인다.
 */
export function resolveWikilink(
  target: string,
  index: ResolveSource,
  fromPath: string,
): WikilinkTarget {
  const whole = target.trim().toLowerCase();
  if (index.resolver.has(whole)) {
    return { path: resolveTarget(target, index, fromPath), anchor: null, sameDoc: false };
  }
  const { name, anchor } = splitAnchor(target);
  if (anchor !== null && !name) return { path: null, anchor, sameDoc: true };
  return { path: resolveTarget(target, index, fromPath), anchor, sameDoc: false };
}

/** byPath + resolver(alias>title>stem 우선순위) 빌드. sync/chunked 빌더가 공유. */
function buildResolverAndByPath(infos: LinkInfo[]): {
  byPath: Map<string, LinkInfo>;
  resolver: Map<string, string[]>;
} {
  const byPath = new Map<string, LinkInfo>();
  // 티어별로 따로 모은다: 0=alias, 1=title, 2=stem.
  const tiers: Map<string, string[]>[] = [new Map(), new Map(), new Map()];
  const add = (tier: number, key: string, path: string) => {
    const k = key.toLowerCase();
    const arr = tiers[tier].get(k);
    if (!arr) tiers[tier].set(k, [path]);
    // 한 노트가 같은 키를 두 번 낼 수 있다(alias == stem 등).
    else if (!arr.includes(path)) arr.push(path);
  };

  for (const info of infos) {
    byPath.set(info.source_path, info);
    for (const alias of info.aliases) add(0, alias, info.source_path);
    if (info.title) add(1, info.title, info.source_path);
    add(2, info.source_name, info.source_path);
  }

  // ⚠️ 후보는 **한 티어에서만** 온다. 예전 `if (!resolver.has(key))`가 "먼저 넣은 경로
  // 하나만"이었던 것을 "먼저 채운 티어의 후보 전부"로 넓힌 것이다. 티어 우선순위가
  // 그대로 보존되므로, 충돌이 없던 vault에서는 동작이 완전히 같다.
  const resolver = new Map<string, string[]>();
  for (const tier of tiers) {
    for (const [key, paths] of tier) {
      if (!resolver.has(key)) resolver.set(key, paths);
    }
  }
  return { byPath, resolver };
}

/**
 * backlinks 계산 — **본문** wikilink/md-link만. frontmatter cross-ref(related 등)는
 * buildRelationIndex가 관계 타입을 보존해 별도로 인덱싱(중복 표시 방지).
 */
function buildBacklinks(infos: LinkInfo[], index: ResolveSource): Map<string, Set<string>> {
  const backlinks = new Map<string, Set<string>>();
  function addBacklink(targetPath: string, sourcePath: string) {
    if (targetPath === sourcePath) return;
    let set = backlinks.get(targetPath);
    if (!set) {
      set = new Set();
      backlinks.set(targetPath, set);
    }
    set.add(sourcePath);
  }
  for (const info of infos) {
    for (const raw of info.targets) {
      // ⚠️ **링크한 노트를 넘긴다.** 이게 빠지면 같은 이름의 노트가 둘일 때 남의
      // 프로젝트 문서에 백링크가 달린다.
      const resolvedPath = resolveTarget(targetName(raw), index, info.source_path);
      if (!resolvedPath) continue;
      addBacklink(resolvedPath, info.source_path);
    }
  }
  return backlinks;
}

/**
 * 다음 paint 직전까지 양보 — `requestAnimationFrame` 우선(렌더 기회 보장 → 인덱스 빌드
 * 오버레이 스피너가 청크 사이에 실제로 갱신/회전). rAF 없으면(worker/test) setTimeout(0).
 */
function yieldToPaint(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function buildIndex(infos: LinkInfo[]): LinkIndex {
  const { byPath, resolver } = buildResolverAndByPath(infos);
  const backlinks = buildBacklinks(infos, { resolver });
  const relations = buildRelationIndex(infos, { resolver });
  return { byPath, resolver, backlinks, relations };
}

/**
 * `buildIndex`의 청크 버전 — 큰 vault(12000+)에서 동기 빌드가 main thread를 수백 ms
 * 점유해 인덱스 빌드 스피너가 freeze되는 것을 막는다. 각 phase 사이 + 관계 빌드 내부에서
 * 이벤트 루프에 양보. 결과는 sync 버전과 **동일**(같은 inner 헬퍼 공유 → 테스트는 sync
 * `buildIndex`로 검증). 프로덕션(`stores/vault.ts`)만 이쪽을 쓴다.
 */
export async function buildIndexChunked(infos: LinkInfo[]): Promise<LinkIndex> {
  const { byPath, resolver } = buildResolverAndByPath(infos);
  await yieldToPaint();
  const backlinks = buildBacklinks(infos, { resolver });
  await yieldToPaint();
  const relations = await buildRelationIndexChunked(infos, { resolver });
  return { byPath, resolver, backlinks, relations };
}

export function getBacklinks(targetPath: string, index: LinkIndex): LinkInfo[] {
  const sources = index.backlinks.get(targetPath);
  if (!sources) return [];
  const out: LinkInfo[] = [];
  for (const path of sources) {
    const info = index.byPath.get(path);
    if (info) out.push(info);
  }
  out.sort((a, b) => {
    const an = (a.title ?? a.source_name).toLowerCase();
    const bn = (b.title ?? b.source_name).toLowerCase();
    return an.localeCompare(bn);
  });
  return out;
}
