/**
 * 폴더 스코프 — **"이 아래에서만"**.
 *
 * ## ⚠️ 왜 필요한가 (2026-08-28 실측)
 *
 * 이 vault 는 한 안에 프로젝트가 둘이다(`knowledge/lapis` · `knowledge/slate`).
 * `audit: tags` 가 낸 이름 충돌 **7건이 전부** 그 둘 사이였다 — `state` · `feature-map` ·
 * `open-items` · `verification` · `shortcut-map` · `autonomous-loop` · `열린 항목`.
 *
 * 검색하면 결과의 절반이 남의 프로젝트인데 **에러가 없다.** 결과는 나오고 무관할 뿐이다.
 *
 * ## ⚠️ 의미는 문자열 접두사다 — `exclude` 와 같아야 한다
 *
 * MCP 의 `exclude` 가 이미 문자열 접두사이고, 그 주석이 이유를 적고 있다: 디렉터리
 * 경계(`x + "/"`)로 맞추면 `lapis/plans/lapis-cli-` 처럼 세그먼트 중간에서 끊는 접두사가
 * **조용히 no-op** 이 된다.
 *
 * 포함(`under`)과 제외(`exclude`)가 다른 규칙을 쓰면 같은 문자열이 한쪽에서만 먹는다.
 * 그건 에러 없이 반쪽만 도는 상태다.
 */

/** 경로가 스코프 안인가. 스코프가 비어 있으면 **전부** 안이다. */
export function inScope(rel: string, under: readonly string[]): boolean {
  if (under.length === 0) return true;
  return under.some((u) => rel.startsWith(u));
}

/**
 * 포함과 제외를 함께 적용한다.
 *
 * ⚠️ **제외가 이긴다.** "빼라"는 말이 "여기서만"보다 강하다 — 아카이브를 빼 두고
 * 그 안을 스코프로 잡았을 때 아카이브가 딸려 나오면 뺀 뜻이 사라진다.
 */
export function passesScope(
  rel: string,
  under: readonly string[],
  exclude: readonly string[],
): boolean {
  if (exclude.some((x) => rel.startsWith(x))) return false;
  return inScope(rel, under);
}

/** 스코프 후보 하나. */
export interface ScopeOption {
  /**
   * 매칭에 쓰는 접두사 — 끝에 `/` 가 붙는다. 루트 직속 파일은 후보가 아니다.
   *
   * ⚠️ **넣어 준 경로와 같은 형태로 나온다.** 호출부가 절대경로를 넘겼으면 절대경로다
   * (`applyFilters` 와 팔레트가 `startsWith` 로 그대로 비교하기 때문).
   */
  prefix: string;
  /** 화면에 쓰는 이름 — 모든 경로가 공유하는 뿌리를 걷어낸 것. 상대경로면 `prefix` 와 같다. */
  label: string;
  /** 이 접두사 아래 노트 수. */
  count: number;
}

/**
 * 모든 경로가 공유하는 **디렉터리** 접두사의 세그먼트 수.
 *
 * ⚠️ 이게 없으면 절대경로에서 `depth` 예산을 드라이브·홈이 다 먹는다 —
 * `C:/` 와 `C:/Projects/` 는 둘 다 전체를 덮으니 `n < total` 에 걸려 사라지고,
 * 후보가 **에러 없이 하나도 안 나온다.** 실제로 그렇게 나가 있었다.
 */
function commonRootDepth(paths: readonly string[]): number {
  if (paths.length === 0) return 0;
  // 파일명은 디렉터리가 아니다 — 마지막 세그먼트는 뺀다.
  let common = paths[0].split("/").slice(0, -1);
  for (const p of paths.slice(1)) {
    const segs = p.split("/").slice(0, -1);
    let i = 0;
    while (i < common.length && i < segs.length && common[i] === segs[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) break;
  }
  return common.length;
}

/**
 * 경로 목록 → 고를 만한 스코프 후보.
 *
 * `depth` 단계까지의 디렉터리를 후보로 낸다. 이 vault 는 `knowledge/<project>/<kind>/`
 * 로 깊이가 균일해서(최대 3, 평균 3.0) 2단계면 프로젝트 경계와 정확히 맞는다.
 *
 * ⚠️ **노트가 하나뿐인 후보는 뺀다.** 고르면 그 하나만 남는 스코프는 필터가 아니라
 * 파일 열기이고, 목록만 길어진다.
 *
 * ⚠️ **전부를 덮는 후보도 뺀다.** 모든 노트가 `knowledge/` 아래면 그 후보는 아무것도
 * 거르지 않는다 — 눌러도 화면이 안 바뀌는 항목은 고장과 구별이 안 된다.
 */
export function scopeOptions(
  paths: readonly string[],
  depth = 2,
  minCount = 2,
): ScopeOption[] {
  // ⚠️ `depth` 는 **공통 뿌리 아래로** 센다. 절대경로에서 드라이브·홈이 예산을 먹으면
  //    후보가 통째로 사라진다(위 `commonRootDepth` 참조).
  const root = commonRootDepth(paths);
  const counts = new Map<string, number>();
  for (const p of paths) {
    const segs = p.split("/");
    // 마지막은 파일명이라 디렉터리가 아니다.
    for (let d = root + 1; d <= Math.min(root + depth, segs.length - 1); d++) {
      const prefix = segs.slice(0, d).join("/") + "/";
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
    }
  }
  const total = paths.length;
  // 뿌리를 걷어 화면에 쓸 이름을 만든다. 매칭용 `prefix` 는 받은 형태 그대로 둔다.
  const rootPrefix = root === 0 ? "" : paths[0].split("/").slice(0, root).join("/") + "/";
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount && n < total)
    .map(([prefix, count]) => ({
      prefix,
      label: rootPrefix && prefix.startsWith(rootPrefix) ? prefix.slice(rootPrefix.length) : prefix,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix));
}

/**
 * 사용자가 친 스코프 문자열을 다듬는다.
 *
 * ⚠️ 끝의 `/` 유무로 결과가 갈리면 안 된다 — `knowledge/lapis` 와 `knowledge/lapis/` 는
 * 같은 뜻으로 읽힌다. 다만 **붙이지는 않는다**: 세그먼트 중간 접두사(`plans/lapis-cli-`)를
 * 쓸 수 있어야 하고, `/` 를 붙이면 그게 죽는다. 앞의 `/`·`./` 만 걷어낸다.
 */
export function normalizeScope(raw: string): string {
  return raw.trim().replace(/^\.?\/+/, "").replace(/\\/g, "/");
}
