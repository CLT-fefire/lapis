import { writable } from "svelte/store";

/**
 * 최근 연 vault 경로.
 *
 * ⚠️ **창별이 아니다.** `lapis.last-vault-path` 는 `scopedKey()` 로 창마다 갈리는데
 * (창 하나에 vault 하나가 이 앱의 규칙), 최근 목록은 그 반대다 — 창 A 에서 연 vault 를
 * 창 B 에서 고를 수 있어야 목록이 쓸모가 있다. 그래서 **접미사 없는 키**를 쓴다.
 *
 * ## ⚠️ 핸드오프는 설정 파일에 두라고 했다
 *
 * 이 레포의 관례가 다르다: 테마·밀도처럼 **순수 UI 편의**는 localStorage 로 가고,
 * 앱 밖에서 고칠 수 있어야 하는 것(사용자 CSS 처럼 앱을 못 열게 만들 수 있는 값)만
 * 설정 JSON 으로 간다. 최근 목록은 잃어도 파일 다이얼로그가 그대로 있으므로 앞쪽이다.
 */
const RECENT_VAULTS_KEY = "lapis.recent-vaults";

/** 3~5개. 더 늘리면 목록이 아니라 이력이 된다. */
export const RECENT_VAULTS_MAX = 5;

/**
 * 새 경로를 맨 앞에 놓은 목록.
 *
 * ⚠️ **같은 경로를 중복으로 쌓지 않는다.** 쌓이면 다섯 칸이 같은 vault 하나로 차서
 * 목록이 아무 일도 안 하게 된다 — 화면은 멀쩡하고 기능만 없다.
 */
export function pushRecentVault(
  list: readonly string[],
  path: string,
  max = RECENT_VAULTS_MAX,
): string[] {
  const clean = path.trim();
  if (!clean) return [...list];
  return [clean, ...list.filter((p) => p !== clean)].slice(0, max);
}

/** 저장값 → 목록. 문자열 배열이 아니면 통째로 버린다. */
export function normalizeRecentVaults(raw: unknown, max = RECENT_VAULTS_MAX): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const c = v.trim();
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

function load(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_VAULTS_KEY);
    return normalizeRecentVaults(raw ? JSON.parse(raw) : null);
  } catch {
    return [];
  }
}

export const recentVaults = writable<string[]>(load());

recentVaults.subscribe((list) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(RECENT_VAULTS_KEY, JSON.stringify(list));
  } catch {
    /* localStorage 사용 불가 — 무시 */
  }
});

export function rememberVault(path: string): void {
  recentVaults.update((list) => pushRecentVault(list, path));
}

/** 목록에서 뺀다 — 지워진 폴더를 계속 권하지 않기 위해. */
export function forgetVault(path: string): void {
  recentVaults.update((list) => list.filter((p) => p !== path));
}
