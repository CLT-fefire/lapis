import { writable, get } from "svelte/store";
import { gitIsRepo, gitInit, gitCommitAll } from "$lib/tauri/git";

/**
 * vault git 버전관리 상태 + 자동 커밋 (ADR-004 V2).
 *
 * 모델: `.git` 존재 자체가 vault의 버전관리 상태(별도 설정 플래그 없음). 사용자는 Lapis에서
 * 편집하지 않고 외부(claude-mem·타 도구)에서 문서가 바뀌므로, file watcher가 변경을 감지하면
 * **debounce 후 자동 커밋**한다(무손실 이력). 미설정 vault는 "버전관리 시작?" 배너로 권유(opt-in).
 *
 * vault 경로는 **인자로 받는다**(vault store를 import하지 않음) — 호출부가 이미 경로를 알고,
 * 순수 헬퍼를 store 체인 없이 단위 테스트할 수 있게 하기 위함.
 */

/** 현재 vault가 git repo인가. */
export const gitRepo = writable<boolean>(false);
/** init/commit 진행 중(배너 버튼 비활성화 등). */
export const gitBusy = writable<boolean>(false);
/** "버전관리 시작?" 배너 노출 여부. */
export const gitBannerVisible = writable<boolean>(false);

const DISMISS_PREFIX = "lapis.git-banner-dismissed:";

/** vault별 배너 dismiss localStorage 키. */
export function bannerDismissKey(vault: string): string {
  return DISMISS_PREFIX + vault;
}

/** 배너를 보여줄지 — repo가 아니고 dismiss도 안 했을 때만. 순수. */
export function shouldShowBanner(isRepo: boolean, dismissed: boolean): boolean {
  return !isRepo && !dismissed;
}

export function isBannerDismissed(vault: string): boolean {
  try {
    return localStorage.getItem(bannerDismissKey(vault)) === "1";
  } catch {
    return false;
  }
}

/** "나중에" — 이 vault에선 배너 다시 안 띄움(영속). */
export function dismissBanner(vault: string): void {
  try {
    localStorage.setItem(bannerDismissKey(vault), "1");
  } catch {
    /* localStorage 불가(테스트 stub 등) — 무시 */
  }
  gitBannerVisible.set(false);
}

/** vault 열릴 때 호출 — repo 여부 갱신 + 배너 노출 판단. */
export async function refreshGitStatus(vault: string | null): Promise<void> {
  if (!vault) {
    gitRepo.set(false);
    gitBannerVisible.set(false);
    return;
  }
  try {
    const repo = await gitIsRepo(vault);
    gitRepo.set(repo);
    gitBannerVisible.set(shouldShowBanner(repo, isBannerDismissed(vault)));
  } catch (e) {
    console.warn("[git] status 조회 실패", e);
    gitRepo.set(false);
    gitBannerVisible.set(false);
  }
}

/** "버전관리 시작" — git init + 초기 커밋. 성공 시 repo=true, 배너 숨김. */
export async function startVersioning(vault: string): Promise<void> {
  if (!vault) return;
  gitBusy.set(true);
  try {
    await gitInit(vault);
    gitRepo.set(true);
    gitBannerVisible.set(false);
  } catch (e) {
    console.error("[git] init 실패", e);
  } finally {
    gitBusy.set(false);
  }
}

// === 자동 커밋 (debounce) ===
// watcher가 변경을 적용한 뒤 호출. repo일 때만, 변경이 정착(마지막 변경 후 idle)하면 1 commit.

const AUTO_COMMIT_DELAY_MS = 4000;
let commitTimer: ReturnType<typeof setTimeout> | null = null;
let committing = false;

/** 자동 스냅샷 커밋 메시지(시각). 순수. */
export function autoCommitMessage(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Lapis 자동 스냅샷 — ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 변경 발생 시 watcher가 호출 — repo면 debounce 후 1회 커밋 예약. */
export function scheduleAutoCommit(vault: string | null): void {
  if (!vault || !get(gitRepo)) return;
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    void runAutoCommit(vault);
  }, AUTO_COMMIT_DELAY_MS);
}

async function runAutoCommit(vault: string): Promise<void> {
  commitTimer = null;
  if (committing || !get(gitRepo)) return;
  committing = true;
  try {
    // 변경 없으면 backend가 no-op(false) 반환 — 빈 커밋 안 생김.
    await gitCommitAll(vault, autoCommitMessage(new Date()));
  } catch (e) {
    console.warn("[git] auto-commit 실패", e);
  } finally {
    committing = false;
  }
}
