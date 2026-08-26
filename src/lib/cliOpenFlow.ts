/**
 * `lapis open <노트>` 를 **어느 창이 받을지** 정하는 규칙 — 순수 함수다.
 *
 * 효과(노트 열기·vault 전환·창 포커스)는 `stores/cliOpen.ts`가 맡고, 여기엔 판단만 있다.
 * 갈래가 셋뿐인데 잘못 고르면 **남의 노트를 가로채거나** 아무도 안 받아 창이 하나 더 뜬다.
 * 그건 눈으로 확인하기 번거로운 종류의 결함이라 테이블로 못박아 둔다.
 *
 * 전체 설계는 `src-tauri/src/cliopen.rs` 모듈 주석에 있다.
 */

export type ClaimMode =
  /** 이 창은 CLI 때문에 방금 만들어졌다 — 무엇이든 받아 vault부터 연다. */
  | { kind: "fresh" }
  /** 평범한 창 — vault가 일치할 때만 받는다. */
  | { kind: "vault"; vault: string }
  /** 물어볼 자격이 없다. */
  | { kind: "skip" };

export interface ClaimInput {
  /** URL에 CLI 표식(`cli-open=1`)이 있나. */
  isCliOpenWindow: boolean;
  /** 이 창이 지금 연 vault. 아직 없으면 `null`. */
  vault: string | null;
}

/**
 * ⚠️ **vault 없는 평범한 창은 묻지 않는다.**
 *
 * 물으면 `vault: null`이 되고, Rust는 그걸 "무엇이든 달라"로 읽는다. vault를 아직 안 연
 * 창(첫 실행이라 아무것도 복원되지 않은 창)이 **남을 위한 노트를 가로채고**, 정작 그
 * vault를 연 창은 아무것도 못 받는다.
 *
 * CLI 표식이 있는 창만 그렇게 물어도 된다 — 그러라고 만들어진 창이기 때문이다.
 */
export function claimModeFor(input: ClaimInput): ClaimMode {
  if (input.isCliOpenWindow) return { kind: "fresh" };
  if (input.vault !== null && input.vault !== "") return { kind: "vault", vault: input.vault };
  return { kind: "skip" };
}

/** `claimModeFor`의 결과를 Rust 명령의 인자로. `skip`은 부르지 않으므로 여기 오지 않는다. */
export function vaultArgFor(mode: Exclude<ClaimMode, { kind: "skip" }>): string | null {
  return mode.kind === "fresh" ? null : mode.vault;
}

/** URL에 CLI 표식이 있나. `location.search`를 그대로 받는다(`?cli-open=1` 형태). */
export function isCliOpenWindow(search: string): boolean {
  return new URLSearchParams(search).get("cli-open") === "1";
}
