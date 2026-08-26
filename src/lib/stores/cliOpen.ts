import { get } from "svelte/store";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { claimModeFor, isCliOpenWindow, vaultArgFor } from "$lib/cliOpenFlow";
import { takePendingOpen, onCliOpen, type PendingOpen } from "$lib/tauri/cliOpen";
import { openVault, selectNote, vaultPath } from "$lib/stores/vault";

/**
 * `lapis open <노트>` 의 창 쪽 처리 — 판단은 `$lib/cliOpenFlow`, 효과는 여기.
 *
 * 전체 설계는 `src-tauri/src/cliopen.rs` 모듈 주석에 있다.
 */

/** 테스트가 갈아끼울 수 있게 모아둔 의존. 기본값이 실제 구현이다. */
export interface CliOpenDeps {
  take(vault: string | null): Promise<PendingOpen | null>;
  openVault(path: string): Promise<void>;
  selectNote(path: string): Promise<void>;
  currentVault(): string | null;
  focus(): Promise<void>;
  search(): string;
  warn(message: string, error: unknown): void;
}

const defaultDeps: CliOpenDeps = {
  take: takePendingOpen,
  openVault,
  selectNote: (p) => selectNote(p),
  currentVault: () => get(vaultPath),
  focus: async () => {
    const w = getCurrentWindow();
    await w.unminimize().catch(() => {});
    await w.show().catch(() => {});
    await w.setFocus();
  },
  search: () => (typeof location === "undefined" ? "" : location.search),
  warn: (m, e) => console.warn(m, e),
};

export type ClaimResult = "opened" | "not-mine" | "skipped";

/**
 * "내 것이면 달라"고 한 번 묻고, 받으면 연다.
 *
 * ⚠️ **실패해도 던지지 않는다.** 이건 기동 경로에서도 불린다 — 여기서 예외가 새면
 * vault 복원 이후의 초기화가 통째로 멈춘다. CLI로 노트 하나 여는 편의 기능 때문에 앱이
 * 안 뜨면 안 된다.
 */
export async function claimCliOpen(deps: CliOpenDeps = defaultDeps): Promise<ClaimResult> {
  const mode = claimModeFor({
    isCliOpenWindow: isCliOpenWindow(deps.search()),
    vault: deps.currentVault(),
  });
  if (mode.kind === "skip") return "skipped";

  try {
    const pending = await deps.take(vaultArgFor(mode));
    if (!pending) return "not-mine";

    // ⚠️ `fresh` 창은 vault부터 연다. 순서를 뒤집으면 인덱스가 없는 상태에서 노트를
    // 열게 되고, 그 뒤 `openVault`가 탭을 자기 것으로 갈아치운다.
    if (mode.kind === "fresh") await deps.openVault(pending.vault);
    await deps.selectNote(pending.path);
    await deps.focus();
    return "opened";
  } catch (e) {
    deps.warn("[cli-open] 처리 실패", e);
    return "not-mine";
  }
}

/**
 * 이 창이 살아 있는 동안 `cli:open`을 듣는다. 해제 함수를 돌려준다.
 *
 * 기동 시 한 번은 **직접** 불러야 한다(`claimCliOpen`) — 앱이 꺼져 있었다면 알림은 창이
 * 생기기 전에 이미 지나갔고, 남은 건 담아둔 것뿐이기 때문이다.
 */
export async function listenCliOpen(deps: CliOpenDeps = defaultDeps): Promise<() => void> {
  try {
    const unlisten = await onCliOpen(async () => {
      await claimCliOpen(deps);
    });
    return unlisten;
  } catch (e) {
    deps.warn("[cli-open] 구독 실패", e);
    return () => {};
  }
}
