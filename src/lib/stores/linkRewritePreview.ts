import { writable } from "svelte/store";
import type { LinkRewritePreview } from "$lib/linkRewrite";

/**
 * 자동 링크 갱신 dry-run 미리보기 모달 상태.
 *
 * 흐름:
 * 1. rename 시 vault.ts가 preview 계산 후 이 store를 set (resolve 콜백 포함)
 * 2. `LinkRewritePreviewModal`이 store를 구독해 모달 표시
 * 3. 사용자가 "적용"/"취소" 클릭 → resolve(true|false) → vault.ts가 다음 단계 진행
 * 4. 모달은 store를 null로 reset
 *
 * Preview 자체는 pure (`computeLinkRewritePreview` 결과)이고, store는 UI 연결 통로일 뿐.
 */
export interface LinkRewritePreviewRequest {
  preview: LinkRewritePreview;
  /** 사용자 결정 콜백 — true면 적용, false면 취소. */
  resolve: (apply: boolean) => void;
}

export const linkRewritePreviewRequest =
  writable<LinkRewritePreviewRequest | null>(null);
