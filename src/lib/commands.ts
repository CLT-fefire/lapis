import { m } from "$lib/paraglide/messages.js";
import { get } from "svelte/store";
import { fuzzyMatch } from "$lib/searchIndex";
import {
  vaultPath,
  currentNotePath,
  pickAndOpenVault,
  reloadNotes,
  deletePath,
  reopenClosedTab,
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
import { openBrokenLinks } from "$lib/stores/brokenLinks";
import { openGrep } from "$lib/stores/grep";
import { openTagRename } from "$lib/stores/tagRewrite";
import { newWindow } from "$lib/tauri/window";
import { logError } from "$lib/stores/usage";

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
    id: "reopen-tab",
    get label() {
      return m.cmd_reopen_tab();
    },
    /**
     * ⚠️ 단축키를 안 준다. `⌘⇧T` 는 새 창이 쓰고 있고, 자주 쓰는 조작이 아니다 —
     * 키를 뺏으면 매일 쓰는 것이 밀린다.
     */
    disabled: () => !get(vaultPath),
    run() {
      void reopenClosedTab();
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
    id: "vault-grep",
    get label() {
      return m.cmd_grep();
    },
    shortcut: "⌘⇧G",
    disabled: () => !get(vaultPath),
    run() {
      openGrep();
    },
  },
  {
    id: "tag-rename",
    get label() {
      return m.cmd_tag_rename();
    },
    // 단축키 없음 — 되돌릴 수 없는 쓰기라 손이 미끄러져 열릴 자리를 주지 않는다.
    disabled: () => !get(vaultPath),
    run() {
      openTagRename();
    },
  },
  {
    id: "broken-links",
    get label() {
      return m.cmd_broken_links();
    },
    // 단축키 없음 — 자주 쓰는 동작이 아니고, 남은 조합을 여기 쓰면 아까운 자리다.
    disabled: () => !get(vaultPath),
    run() {
      openBrokenLinks();
    },
  },
  /**
   * ⚠️ 감사가 다섯이 되고 나서 나머지 넷에 **직행할 길이 없었다.** 팔레트에서 위생을
   * 열고 탭을 두 번 넘겨야 "속성"에 닿았다. 하나마다 항목을 두는 대신 위 명령 하나로
   * 두면 목적지를 말할 방법이 없다.
   */
  ...(["orphans", "tags", "unlinked", "props"] as const).map((tab) => ({
    id: `audit-${tab}`,
    get label() {
      return {
        orphans: m.cmd_audit_orphans(),
        tags: m.cmd_audit_tags(),
        unlinked: m.cmd_audit_unlinked(),
        props: m.cmd_audit_props(),
      }[tab];
    },
    disabled: () => !get(vaultPath),
    run() {
      openBrokenLinks(tab);
    },
  })),
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
      void newWindow().catch((e) => logError("commands", "new window failed", e));
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
        logError("commands", "copy current note path failed", e);
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
