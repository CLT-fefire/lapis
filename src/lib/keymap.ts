/**
 * 전역 단축키 **매칭**만 담당한다. 실행(효과)은 호출자가 한다.
 *
 * 왜 갈랐나 — `+page.svelte`의 keydown 핸들러는 22개 분기가 `else if` 사슬로 이어져
 * 있었고, 조건(어느 키냐)과 효과(무엇을 하냐)가 한 줄에 붙어 있어 **조건만 따로 검증할
 * 방법이 없었다.** 단축키는 자주 바뀌는데(2026-08-10 하루에만 6건) 테스트가 0건이었다.
 *
 * ⚠️ **순서가 의미를 갖는다.** 아래 표는 위에서부터 첫 매치를 채택한다:
 *   - `⌥B`(∫)가 `⌘B`보다 **먼저** 와야 한다. 안 그러면 ⌘⌥B가 사이드바를 토글한다.
 *   - `⌘⇧T`/`⌘⇧E`/`⌘⇧F`가 각각 `⌘T`/`⌘E`/`⌘F`와 shift로만 갈린다.
 */

/** KeyboardEvent에서 매칭에 필요한 부분만. 테스트가 DOM 없이 돌도록 좁혔다. */
export interface KeyChord {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export type ShortcutId =
  | "rename-note"
  | "delete-note"
  | "palette"
  | "quick-open"
  | "new-tab"
  | "new-window"
  | "fulltext-search"
  | "save"
  | "find-in-doc"
  | "toggle-main-pane"
  | "new-note"
  | "copy-path"
  | "toggle-context"
  | "toggle-sidebar"
  | "focus-tree-filter"
  | "show-outline"
  | "nav-back"
  | "nav-forward"
  | "close-tab"
  | "select-tab";

export interface ShortcutMatch {
  id: ShortcutId;
  /** `select-tab`에서만 채워진다 (1~9). */
  index?: number;
}

/** 입력 중이면 대부분의 단축키를 가로채지 않는다. */
export interface KeymapContext {
  /** INPUT·TEXTAREA·contenteditable(CodeMirror 포함)에 포커스가 있는지. */
  inEditing: boolean;
}

/**
 * ⌥(Option)는 macOS에서 **문자를 바꾼다** — ⌥B는 `e.key === "∫"`로 온다.
 * 반대로 일부 환경(자동화·리모트 입력)은 `e.code`를 비워 보낸다.
 * 어느 한쪽에 의존하지 않도록 code·key를 **모두** 허용한다.
 */
function isOptionB(e: KeyChord): boolean {
  return e.altKey && (e.code === "KeyB" || e.key.toLowerCase() === "b" || e.key === "∫");
}

export function resolveShortcut(e: KeyChord, ctx: KeymapContext): ShortcutMatch | null {
  // --- modifier 없는 것들 (입력 중이면 통과) ---
  if (e.key === "F2" && !e.metaKey && !e.ctrlKey && !ctx.inEditing) {
    return { id: "rename-note" };
  }
  if (
    (e.key === "Backspace" || e.key === "Delete") &&
    (e.metaKey || e.ctrlKey) &&
    !ctx.inEditing
  ) {
    return { id: "delete-note" };
  }

  // --- 이하 전부 ⌘/Ctrl 필요 ---
  if (!(e.metaKey || e.ctrlKey)) return null;
  const key = e.key.toLowerCase();

  // ⌘⌃←/→ 는 다른 분기보다 조합이 특수하므로 먼저 본다.
  if ((key === "arrowleft" || key === "arrowright") && e.metaKey && e.ctrlKey) {
    return { id: key === "arrowleft" ? "nav-back" : "nav-forward" };
  }

  // ⚠️ ⌥B는 반드시 ⌘B보다 먼저.
  if (isOptionB(e)) return { id: "toggle-context" };

  if (key === "k" && !e.shiftKey) return { id: "palette" };
  if (key === "p" && !e.shiftKey) return { id: "quick-open" };
  if (key === "t" && !e.shiftKey) return { id: "new-tab" };
  if (key === "t" && e.shiftKey) return { id: "new-window" };
  if ((key === "f" || key === "p") && e.shiftKey) return { id: "fulltext-search" };
  if (key === "s" && !e.shiftKey) return { id: "save" };
  if (key === "f" && !e.shiftKey) return { id: "find-in-doc" };
  if (key === "e" && !e.shiftKey && !e.altKey) return { id: "toggle-main-pane" };
  if (key === "e" && e.shiftKey) return { id: "focus-tree-filter" };
  if (key === "n" && !e.shiftKey) return { id: "new-note" };
  if (key === "c" && e.shiftKey) return { id: "copy-path" };
  if (key === "b" && !e.shiftKey && !e.altKey) return { id: "toggle-sidebar" };
  if (key === "o" && e.shiftKey) return { id: "show-outline" };
  if ((key === "," || key === ".") && !e.shiftKey && !e.altKey) {
    return { id: key === "," ? "nav-back" : "nav-forward" };
  }
  if (key === "w" && !e.shiftKey) return { id: "close-tab" };
  if (/^[1-9]$/.test(key) && !e.shiftKey) {
    return { id: "select-tab", index: Number(key) };
  }
  return null;
}
