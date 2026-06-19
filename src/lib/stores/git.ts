import { writable, get } from "svelte/store";
import { gitIsRepo, gitInit, gitCommitAll, gitCommitPaths } from "$lib/tauri/git";

/**
 * vault git 버전관리 상태 + 자동 커밋 (ADR-004 V2).
 *
 * 모델: `.git` 존재 자체가 vault의 버전관리 상태(별도 설정 플래그 없음). 사용자는 Lapis에서
 * 편집하지 않고 외부 도구에서 문서가 바뀌므로, file watcher가 변경을 감지하면
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
  // vault 전환 — 이전 vault의 누적 경로/대기 커밋 폐기(교차 커밋 방지).
  resetAutoCommitState();
  if (!vault) {
    gitRepo.set(false);
    gitBannerVisible.set(false);
    return;
  }
  try {
    const repo = await gitIsRepo(vault);
    gitRepo.set(repo);
    // repo면 첫 자동커밋은 전체 스윕으로 — 앱이 꺼진 동안의 drift를 무손실 반영.
    if (repo) needsFullSweep = true;
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
// watcher가 알려준 **변경 경로만 add**해 거대 vault의 `add -A` 전체 스캔을 피한다(duration 최적화).

const AUTO_COMMIT_DELAY_MS = 4000;
let commitTimer: ReturnType<typeof setTimeout> | null = null;
let committing = false;
/** 다음 자동 커밋에 add할 변경 경로(수정/생성/삭제/rename 대상). `git add -- <path>`가 셋 다 처리. */
const pendingCommitPaths = new Set<string>();
/**
 * 다음 자동커밋을 `add -A`(전체 스윕)로 — vault 열린 직후 첫 커밋. 앱이 꺼진 동안 외부에서
 * 바뀐 파일(watcher가 못 본 drift)을 한 번 쓸어담아 무손실을 보장. 이후 커밋은 targeted.
 */
let needsFullSweep = false;

/** vault 전환 시 누적 상태 초기화(테스트·교차 vault 누수 방지). */
function resetAutoCommitState(): void {
  if (commitTimer) {
    clearTimeout(commitTimer);
    commitTimer = null;
  }
  pendingCommitPaths.clear();
  needsFullSweep = false;
}

/** 자동 스냅샷 커밋 메시지(시각). 순수. */
export function autoCommitMessage(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Lapis 자동 스냅샷 — ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// === 이력 뷰어(V3) 표시 헬퍼 — 순수 ===

/** commit 시각(epoch seconds) → "YYYY-MM-DD HH:mm". 0이면 "—". */
export function formatCommitDate(epochSec: number): string {
  if (!epochSec) return "—";
  const d = new Date(epochSec * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** unified diff 한 줄의 종류 — 색상 클래스용. 순수. */
export type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";
export function diffLineClass(line: string): DiffLineKind {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (
    line.startsWith("diff ") ||
    line.startsWith("index ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted ") ||
    line.startsWith("similarity ") ||
    line.startsWith("rename ")
  )
    return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return "ctx";
}

/**
 * 변경 발생 시 watcher가 호출 — repo면 변경 경로를 누적하고 debounce 후 1회 커밋 예약.
 * `paths`는 이번 이벤트로 바뀐 경로(수정/생성/삭제/rename 양쪽). 누적해 두었다가 커밋 때 add.
 */
export function scheduleAutoCommit(vault: string | null, paths: string[] = []): void {
  if (!vault || !get(gitRepo)) return;
  for (const p of paths) pendingCommitPaths.add(p);
  if (commitTimer) clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    void runAutoCommit(vault);
  }, AUTO_COMMIT_DELAY_MS);
}

async function runAutoCommit(vault: string): Promise<void> {
  commitTimer = null;
  if (committing || !get(gitRepo)) return;
  committing = true;
  const paths = Array.from(pendingCommitPaths);
  pendingCommitPaths.clear();
  const fullSweep = needsFullSweep;
  needsFullSweep = false;
  try {
    // 변경 없으면 backend가 no-op(false) 반환 — 빈 커밋 안 생김.
    if (fullSweep || paths.length === 0) {
      // 첫 커밋(또는 경로 정보 없음) — 전체 스윕으로 drift/누락 방지.
      await gitCommitAll(vault, autoCommitMessage(new Date()));
    } else {
      await gitCommitPaths(vault, paths, autoCommitMessage(new Date()));
    }
  } catch (e) {
    console.warn("[git] auto-commit 실패", e);
    // 실패분 복원 — 다음 변경 때 재시도(무손실).
    if (fullSweep) needsFullSweep = true;
    for (const p of paths) pendingCommitPaths.add(p);
  } finally {
    committing = false;
  }
}
