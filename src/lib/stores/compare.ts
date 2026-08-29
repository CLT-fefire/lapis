import { writable, get } from "svelte/store";

/**
 * 나란히 보기 — 본문 옆에 **읽기 전용**으로 노트 하나를 더 띄운다.
 *
 * ## 🔴 왜 반쪽인가 — 적어 두는 이유
 *
 * 지금은 두 노트를 비교하려면 `⌘⇧T` 로 **창을 따로** 띄워야 한다. 모니터가 하나면 불편하다.
 *
 * 그런데 본문 상태가 전부 싱글턴이다 — `currentNotePath` · `renderedArticleEl` ·
 * `mainPane`(읽기/편집) · 문서 내 검색 · 읽던 자리. **완전한 두 번째 작업 공간**을 만들려면
 * 그 전부를 pane 별로 쪼개야 하고, 그건 2,400줄짜리 `+page.svelte` 의 구조 개편이다.
 *
 * 그래서 옆칸은 읽기만 한다 — 탭도 편집기도 문서 내 검색도 없다. 값의 8할은 거기 있다:
 * **"A 를 읽으면서 B 를 띄워 두기"**.
 *
 * ⚠️ 이 판단을 안 적으면 다음 사람이 "왜 반쪽이지"를 처음부터 다시 조사한다.
 *
 * ## ⚠️ vault 를 안 넘어간다
 *
 * 경로만 들고 있고 vault 는 안 따진다 — 옆칸은 본문과 **같은 vault** 안에서만 열린다
 * (여는 쪽이 그 vault 의 목록에서 고른다). 다른 vault 를 보려면 창이 따로 필요하고,
 * 그건 이미 `⌘⇧T` 가 한다.
 */
export const comparePath = writable<string | null>(null);

/**
 * 옆칸에 연다.
 *
 * ⚠️ **본문과 같은 노트면 안 연다.** 두 칸이 같은 것을 그리면 옆칸이 아무것도 더해 주지
 * 않으면서 자리만 반을 먹는다.
 */
export function openCompare(path: string, currentPath?: string | null): void {
  if (!path) return;
  if (currentPath && path === currentPath) return;
  comparePath.set(path);
}

export function closeCompare(): void {
  comparePath.set(null);
}

/**
 * 같은 노트면 닫고, 다른 노트면 **갈아 끼운다.**
 *
 * ⚠️ 다를 때 닫아 버리면 "B 를 보다가 C 로"가 두 번 눌러야 하는 일이 되고, 사람은 그걸
 * 고장으로 읽는다.
 */
export function toggleCompare(path: string, currentPath?: string | null): void {
  if (!path) return;
  if (get(comparePath) === path) {
    closeCompare();
    return;
  }
  openCompare(path, currentPath);
}

/**
 * 🔴 본문이 옆칸과 **같은 노트로 가면** 옆칸을 닫는다.
 *
 * 안 그러면 같은 문서가 나란히 두 벌 뜬다. 링크를 눌러 옮겨 다니다 보면 실제로 걸린다.
 */
export function closeIfSame(nextCurrentPath: string | null): void {
  if (nextCurrentPath && get(comparePath) === nextCurrentPath) closeCompare();
}
