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
import { openTableView } from "$lib/stores/tableView";
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
/**
 * ⚠️ `label`이 **getter**인 이유 — 이 배열은 모듈 최상위라 일반 프로퍼티로 두면
 * import 시점에 한 번 평가돼 로케일 변경을 못 따라온다(`lens.ts`에서 겪은 함정).
 * getter면 접근할 때마다 해소되므로 호출부는 그대로 `c.label`을 쓴다.
 */
export const BUILTIN_COMMANDS: Command[] = [
  {
    id: "new-note",
    get label() {
      return m.cmd_new_note();
    },
    shortcut: "⌘N",
    disabled: () => !get(vaultPath),
    run() {
      const vault = get(vaultPath);
      if (!vault) return;
      const cur = get(currentNotePath);
      const parentDir = cur ? cur.split("/").slice(0, -1).join("/") : vault;
      const parentLabel = cur
        ? (cur.split("/").slice(-2, -1)[0] ?? "") + "/"
        : m.cmd_vault_root();
      openNewNote(parentDir, parentLabel);
    },
  },
  {
    id: "table-view",
    get label() {
      return m.cmd_table_view();
    },
    shortcut: "⌘⇧B",
    disabled: () => !get(vaultPath),
    run() {
      openTableView();
    },
  },
  {
    id: "open-vault",
    get label() {
      return m.cmd_open_vault();
    },
    run() {
      void pickAndOpenVault();
    },
  },
  {
    id: "reload-vault",
    get label() {
      return m.cmd_reload_vault();
    },
    disabled: () => !get(vaultPath),
    run() {
      void reloadNotes();
    },
  },
  {
    id: "toggle-sidebar",
    get label() {
      return m.cmd_toggle_sidebar();
    },
    shortcut: "⌘B",
    run() {
      toggleSidebar();
    },
  },
  {
    id: "new-tab",
    get label() {
      return m.cmd_new_tab();
    },
    shortcut: "⌘T",
    disabled: () => !get(vaultPath),
    run() {
      // ⌘P("잠깐 보기", 활성 탭 교체)와 짝. 여기서 고른 노트는 새 탭으로 열린다.
      openPalette("files", "new-tab");
    },
  },
  {
    id: "new-window",
    get label() {
      return m.cmd_new_window();
    },
    shortcut: "⌘⇧T",
    run() {
      // 새 창은 vault 없이 뜬다 — 거기서 다른 vault를 고르면 그 창만 바뀐다.
      void newWindow().catch((e) => console.error("new window failed", e));
    },
  },
  {
    id: "toggle-main-pane",
    get label() {
      return m.cmd_toggle_editor_preview();
    },
    shortcut: "⌘E",
    run() {
      toggleMainPane();
    },
  },
  {
    id: "toggle-context-panel",
    get label() {
      return m.cmd_toggle_context();
    },
    shortcut: "⌘⌥B",
    run() {
      toggleContext();
    },
  },
  {
    id: "reset-layout",
    get label() {
      return m.cmd_reset_layout();
    },
    run() {
      resetLayout();
    },
  },
  {
    id: "rename-current-note",
    get label() {
      return m.cmd_rename_note();
    },
    shortcut: "F2",
    disabled: () => !get(currentNotePath),
    run() {
      const cur = get(currentNotePath);
      if (cur) requestRename(cur);
    },
  },
  {
    id: "delete-current-note",
    get label() {
      return m.cmd_delete_note();
    },
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
    get label() {
      return m.cmd_copy_note_path();
    },
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
