import { get, writable } from "svelte/store";
import type { LinkRewritePreview } from "$lib/linkRewrite";

/**
 * 자동 링크 갱신 dry-run 미리보기 모달 상태.
 *
 * 흐름:
 * 1. rename 시 vault.ts가 preview 계산 후 `requestLinkRewritePreview` 호출
 * 2. `LinkRewritePreviewModal`이 store를 구독해 모달 표시
 * 3. 사용자가 "적용"/"취소" → `settleLinkRewritePreview(apply)` → vault.ts가 다음 단계 진행
 *
 * Preview 자체는 pure (`computeLinkRewritePreview` 결과)이고, store는 UI 연결 통로일 뿐.
 *
 * ## 🔴 슬롯이 콜백을 들고 있다 — 그래서 함수로만 만진다
 *
 * 이 슬롯에는 `resolve` 가 들어 있다. 그냥 `set` 으로 덮으면 **이전 요청이 영원히
 * 안 끝난다** — `rewriteAllLinksWithPreview` 가 `await new Promise` 에서 멈춘 채 남고,
 * 에러도 타임아웃도 없다. 이름은 바뀌었는데 인용은 안 바뀐 상태로 조용히 끝난다.
 *
 * ⚠️ 도달 경로가 있다: 모달이 떠 있어도 전역 단축키가 안 막힌다(`handleGlobalKey` 는
 * `inEditing` 만 본다). `rename-note` 가 다시 들어오면 두 번째 요청이 첫 것을 덮는다.
 *
 * ⚠️ **같은 모양을 이 저장소에서 이미 겪었다** — `clirender::stage` 가 슬롯을 채우면서
 * 지난 요청의 창 표식을 안 지웠다. 슬롯을 덮을 때 이전 점유자를 치우는 것은 규칙이다.
 *
 * `set` 과 `resolve` 를 밖에서 손으로 짝지으면 언젠가 한쪽을 빼먹는다. 그래서 **짝을
 * 여기 가둔다** — 밖에서 할 수 있는 것은 요청하거나 매듭짓거나 둘 뿐이다.
 */
export interface LinkRewritePreviewRequest {
  preview: LinkRewritePreview;
  /** 사용자 결정 콜백 — true면 적용, false면 취소. */
  resolve: (apply: boolean) => void;
}

/** 읽기용. 쓰기는 아래 두 함수로만 한다. */
export const linkRewritePreviewRequest = writable<LinkRewritePreviewRequest | null>(null);

/**
 * 미리보기를 띄운다.
 *
 * 🔴 이미 떠 있던 것이 있으면 **취소로 닫고** 들어간다. 안 그러면 그쪽이 영원히 기다린다.
 */
export function requestLinkRewritePreview(
  preview: LinkRewritePreview,
  resolve: (apply: boolean) => void,
): void {
  const pending = get(linkRewritePreviewRequest);
  if (pending) pending.resolve(false);
  linkRewritePreviewRequest.set({ preview, resolve });
}

/**
 * 사용자의 답으로 매듭짓고 슬롯을 비운다.
 *
 * ⚠️ 슬롯이 비어 있으면 아무 일도 안 한다. 모달이 닫히는 경로가 넷이라(적용 · 취소 · ✕ ·
 * 배경/ESC) 겹쳐 들어올 수 있는데, 두 번째가 **그 사이 들어온 남의 요청**을 닫으면 안 된다.
 */
export function settleLinkRewritePreview(apply: boolean): void {
  const pending = get(linkRewritePreviewRequest);
  if (!pending) return;
  linkRewritePreviewRequest.set(null);
  pending.resolve(apply);
}
