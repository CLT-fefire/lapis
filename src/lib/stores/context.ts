import { writable } from "svelte/store";

/**
 * 우측 컨텍스트 패널 — **세그먼트 탭 하나**.
 *
 * Discord의 멤버 리스트 자리다. 좌측 사이드바가 "vault 탐색"이라면 여기는 "이 문서에
 * 딸린 것" — 속성(frontmatter) · 목차 · 관계/백링크 · 발행 자산.
 *
 * ## ⚠️ 아코디언에서 왜 바꿨나
 *
 * 좌측 사이드바와 같은 이유다(`sidebar.ts` 참조) — 300px 폭에 넷을 세로로 쌓으면 어느
 * 것도 제 높이를 못 갖는다. 목차가 기본 접힘이었던 것이 그 증상이다: "문서마다 길이
 * 편차가 커서" 접어 뒀다는 것은 **넷이 자리를 나눠 쓰는 구조가 안 맞았다**는 뜻이다.
 *
 * 패널 자체의 접힘은 여전히 `layout.contextCollapsed` 가 담당한다.
 */
export type ContextSectionKey = "properties" | "outline" | "relations" | "assets";

export const CONTEXT_SECTION_KEYS: readonly ContextSectionKey[] = [
  "properties",
  "outline",
  "relations",
  "assets",
] as const;

const STORAGE_KEY = "lapis.context-sections";

export function defaultContextTab(): ContextSectionKey {
  return "properties";
}

/**
 * 저장된 상태 → 활성 탭.
 *
 * ⚠️ 옛 상태는 `{properties: true, outline: false, …}` 였다. **열려 있던 첫 섹션**을
 * 고른다 — 아무거나 고르면 사용자가 보던 것과 다른 탭으로 열리고, 그건 "설정이
 * 날아갔다"로 읽힌다.
 */
export function migrateContextTab(raw: unknown): ContextSectionKey {
  const d = defaultContextTab();
  if (typeof raw === "string" && (CONTEXT_SECTION_KEYS as readonly string[]).includes(raw)) {
    return raw as ContextSectionKey;
  }
  if (!raw || typeof raw !== "object") return d;
  const legacy = raw as Partial<Record<ContextSectionKey, boolean>>;
  return CONTEXT_SECTION_KEYS.find((k) => legacy[k] === true) ?? d;
}

function load(): ContextSectionKey {
  if (typeof localStorage === "undefined") return defaultContextTab();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return migrateContextTab(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultContextTab();
  }
}

export const contextTab = writable<ContextSectionKey>(load());

contextTab.subscribe((s) => {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* localStorage 사용 불가(테스트 stub 등) — 무시 */
  }
});

export function showContextTab(key: ContextSectionKey): void {
  contextTab.set(key);
}

/**
 * 그 탭으로 간다. `⌘⇧O`(목차) 같은 단축키가 부른다.
 *
 * ⚠️ 이름을 `ensureContextSectionOpen` 에서 바꾸지 않았다면 "이미 열려 있으면 no-op"
 * 이라는 옛 뜻으로 읽힌다. 탭은 **항상 하나만 열려 있으므로** 그 구분이 없다.
 */
export function ensureContextSectionOpen(key: ContextSectionKey): void {
  contextTab.set(key);
}
