import { get } from "svelte/store";
import { fuzzyMatch } from "$lib/searchIndex";
import {
  vaultPath,
  currentNotePath,
  pickAndOpenVault,
  reloadNotes,
} from "$lib/stores/vault";
import { openNewNote } from "$lib/stores/tree-ui";
import { openGraph } from "$lib/stores/graph";
import { toggleEditor, togglePreview } from "$lib/stores/layout";
import { openMemorySync } from "$lib/stores/memorySync";
import { openMemorySearch } from "$lib/stores/memorySearch";

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
    id: "open-graph",
    label: "Graph View",
    shortcut: "⌘G",
    disabled: () => !get(vaultPath),
    run() {
      openGraph();
    },
  },
  {
    id: "toggle-editor-pane",
    label: "Toggle Editor Pane",
    run() {
      toggleEditor();
    },
  },
  {
    id: "toggle-preview-pane",
    label: "Toggle Preview Pane",
    run() {
      togglePreview();
    },
  },
  {
    id: "memory-sync",
    label: "Memory: Sync from claude-mem",
    disabled: () => !get(vaultPath),
    run() {
      openMemorySync();
    },
  },
  {
    id: "memory-search",
    label: "Memory: Search",
    shortcut: "⌘⇧M",
    disabled: () => !get(vaultPath),
    run() {
      openMemorySearch();
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
