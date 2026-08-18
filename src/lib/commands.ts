import { m } from "$lib/paraglide/messages.js";
import { get } from "svelte/store";
import { fuzzyMatch } from "$lib/searchIndex";
import {
  vaultPath,
  currentNotePath,
  pickAndOpenVault,
  reloadNotes,
  deletePath,
} from "$lib/stores/vault";
import { openNewNote, requestRename } from "$lib/stores/tree-ui";
import {
  toggleMainPane,
  toggleSidebar,
  toggleContext,
  resetLayout,
} from "$lib/stores/layout";
import { openPalette } from "$lib/stores/palette";
import { newWindow } from "$lib/tauri/window";

export interface Command {
  id: string;
  label: string;
  /** Mac 표기 (⌘ ⌥ ⇧). 미지정이면 단축키 없음 */
  shortcut?: string;
  /** 비활성 조건 — true 반환 시 결과 목록에 노출 안 됨. 예: vault 미선택 시 New Note */
  disabled?: () => boolean;
  run(): void | Promise<void>;
}

export interface CommandHit {
  command: Command;
  score: number;
  matchedKey: string;
}

/** 빌트인 명령. 가짓수 적고 정적이라 hard-code. */
export const BUILTIN_COMMANDS: Command[] = [
  {
    id: "new-note",
    label: "New Note",
    shortcut: "⌘N",
    disabled: () => !get(vaultPath),
    run() {
      const vault = get(vaultPath);
      if (!vault) return;
      const cur = get(currentNotePath);
      const parentDir = cur ? cur.split("/").slice(0, -1).join("/") : vault;
      const parentLabel = cur
        ? (cur.split("/").slice(-2, -1)[0] ?? "") + "/"
        : "(vault root)";
      openNewNote(parentDir, parentLabel);
    },
  },
  {
    id: "open-vault",
    label: "Open Vault…",
    run() {
      void pickAndOpenVault();
    },
  },
  {
    id: "reload-vault",
    label: "Reload Vault",
    disabled: () => !get(vaultPath),
    run() {
      void reloadNotes();
    },
  },
  {
    id: "toggle-sidebar",
    label: "Toggle Sidebar",
    shortcut: "⌘B",
    run() {
      toggleSidebar();
    },
  },
  {
    id: "new-tab",
    label: "New Tab",
    shortcut: "⌘T",
    disabled: () => !get(vaultPath),
    run() {
      // ⌘P("잠깐 보기", 활성 탭 교체)와 짝. 여기서 고른 노트는 새 탭으로 열린다.
      openPalette("files", "new-tab");
    },
  },
  {
    id: "new-window",
    label: "New Window",
    shortcut: "⌘⇧T",
    run() {
      // 새 창은 vault 없이 뜬다 — 거기서 다른 vault를 고르면 그 창만 바뀐다.
      void newWindow().catch((e) => console.error("new window failed", e));
    },
  },
  {
    id: "toggle-main-pane",
    label: "Toggle Editor / Preview",
    shortcut: "⌘E",
    run() {
      toggleMainPane();
    },
  },
  {
    id: "toggle-context-panel",
    label: "Toggle Context Panel",
    shortcut: "⌘⌥B",
    run() {
      toggleContext();
    },
  },
  {
    id: "reset-layout",
    label: "Reset Layout",
    run() {
      resetLayout();
    },
  },
  {
    id: "rename-current-note",
    label: "Rename Current Note",
    shortcut: "F2",
    disabled: () => !get(currentNotePath),
    run() {
      const cur = get(currentNotePath);
      if (cur) requestRename(cur);
    },
  },
  {
    id: "delete-current-note",
    label: "Delete Current Note (move to Trash)",
    shortcut: "⌘⌫",
    disabled: () => !get(currentNotePath),
    async run() {
      const cur = get(currentNotePath);
      if (!cur) return;
      const name = cur.split("/").pop() ?? cur;
      if (!confirm(m.ctx_confirm_trash({ label: m.ctx_label_note({ name }) }))) return;
      await deletePath(cur);
    },
  },
  {
    id: "copy-current-note-path",
    label: "Copy Current Note Path",
    shortcut: "⌘⇧C",
    disabled: () => !get(currentNotePath),
    async run() {
      const cur = get(currentNotePath);
      if (!cur) return;
      try {
        await navigator.clipboard.writeText(cur);
      } catch (e) {
        console.error("copy current note path failed", e);
      }
    },
  },
];

/**
 * 명령 검색. 빈 query면 전체 명령(비활성 제외)을 정의 순서대로 반환.
 * 매칭 대상: label, id. id 매칭은 weight 낮게 (사용자가 외운 게 아님).
 */
export function matchCommands(query: string, limit = 20): CommandHit[] {
  const visible = BUILTIN_COMMANDS.filter((c) => !c.disabled?.());
  const q = query.trim();
  if (!q) {
    return visible.map((command) => ({ command, score: 0, matchedKey: command.label }));
  }
  const hits: CommandHit[] = [];
  for (const command of visible) {
    const labelScore = fuzzyMatch(q, command.label);
    const idScore = fuzzyMatch(q, command.id);
    let best: { score: number; key: string } | null = null;
    if (labelScore !== null) best = { score: labelScore, key: command.label };
    if (idScore !== null) {
      const adj = idScore * 0.6; // id 매칭은 weight 낮춤
      if (!best || adj > best.score) best = { score: adj, key: command.id };
    }
    if (best) hits.push({ command, score: best.score, matchedKey: best.key });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
