/**
 * vault 진단 화면의 **탭 목록** — 이 목록이 사는 유일한 자리.
 *
 * ## 🔴 왜 떼어 냈나 (2026-08-30 실측)
 *
 * 같은 목록이 **세 곳에 다르게** 있었다:
 *
 * | 어디 | 개수 |
 * |---|---|
 * | `VaultHygieneModal.svelte` 의 `type Tab` | **9** |
 * | `brokenLinks.ts` 의 `HygieneTab` | **7** — `decay`·`stale` 이 빠져 있었다 |
 * | `commands.ts` 의 팔레트 목록 | **5** |
 *
 * ⚠️ `HygieneTab` 은 주석에 *"모달과 팔레트가 **공유한다**"* 고 적어 두고도 공유되지
 * 않았다. 모달이 자기 유니온을 따로 선언했기 때문이다 — 그래도 타입 검사는 안 운다.
 *
 * 🔴 그리고 `commands.ts` 의 주석이 이 일을 **예언하고 있었다**:
 * *"감사가 다섯이 되고 나서 나머지 넷에 직행할 길이 없었다."* 같은 일이 또 났고 이유도
 * 같다 — 손으로 유지하는 목록. `hygieneTabs.test.ts` 가 이제 양방향으로 막는다.
 *
 * ## ⚠️ import 를 넣지 않는다
 *
 * `commandIds.ts` 와 같은 이유다. 여기가 앱 트리를 물면 순수 모듈에서 못 읽고,
 * 그러면 목록을 떼어 낸 이유가 사라진다.
 */

/**
 * 화면에 보이는 **순서 그대로**. 팔레트 명령도 이 순서를 따른다.
 *
 * ⚠️ 앞의 여섯은 **감사**(찾아서 보여준다), 뒤의 둘은 vault 의 **지나온 것**이다.
 * 묶음 구분은 모달이 하고, 여기는 목록만 갖는다.
 */
export const HYGIENE_TABS = [
  "broken",
  "orphans",
  "tags",
  "unlinked",
  "props",
  "tasks",
  "decay",
  "changes",
  "stale",
] as const;

export type HygieneTab = (typeof HYGIENE_TABS)[number];

/**
 * 그 탭으로 직행하는 팔레트 명령 id.
 *
 * ⚠️ `broken` 만 `broken-links` 다 — 감사 가족이 생기기 전부터 있던 이름이고, id 는
 * 사용 기록의 키라서 바꾸면 **과거 로그와 안 이어진다.**
 */
export function hygieneCommandId(tab: HygieneTab): string {
  return tab === "broken" ? "broken-links" : `audit-${tab}`;
}
