import { writable, get } from "svelte/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  listNotes,
  readNote,
  scanLinks,
  readAllNotes,
  createNote as createNoteTauri,
  createFolder as createFolderTauri,
  deleteNote as deleteNoteTauri,
  renameNote as renameNoteTauri,
  moveNote as moveNoteTauri,
  writeNote,
  type NoteEntry,
} from "$lib/tauri/notes";
import { rewriteLinksInNote } from "$lib/linkRewrite";
import { buildIndex, resolveTarget, type LinkIndex } from "$lib/linkIndex";
import { rebuildIndexes, clearIndexes } from "$lib/stores/search";
import { buildTagIndex, tagIndex, clearTagIndex } from "$lib/stores/tags";
import {
  buildFacetCounts,
  docKindCounts,
  topicCounts,
  clearFacetCounts,
  clearFilters,
} from "$lib/stores/filters";

const STORAGE_KEY = "lapis.last-vault-path";

export const vaultPath = writable<string | null>(null);
export const notes = writable<NoteEntry[]>([]);
export const currentNotePath = writable<string | null>(null);
export const currentNoteContent = writable<string>("");
export const linkIndex = writable<LinkIndex | null>(null);
/** 트리 listNotes 진행 중 — 짧음 (~30-100ms) */
export const treeLoading = writable<boolean>(false);
/** 인덱스 재빌드 진행 중 — 길음 (~1-3s, 큰 vault) */
export const indexBuilding = writable<boolean>(false);

export async function pickAndOpenVault(): Promise<void> {
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: "Lapis — Vault 선택",
  });
  if (typeof selected === "string") {
    await openVault(selected);
  }
}

export async function openVault(path: string): Promise<void> {
  vaultPath.set(path);
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, path);
  }
  currentNotePath.set(null);
  currentNoteContent.set("");
  await reloadNotes();

  // 파일 watcher 시작 — circular import 회피 위해 lazy import
  try {
    const { startWatching } = await import("./watcher");
    await startWatching();
  } catch (e) {
    console.warn("[vault] startWatching failed", e);
  }
}

export async function reloadNotes(): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;
  treeLoading.set(true);
  try {
    const list = await listNotes(root);
    notes.set(list);
  } catch (e) {
    console.error("list_notes failed", e);
    notes.set([]);
  } finally {
    treeLoading.set(false);
  }

  // 링크 인덱스 + 검색 인덱스 + facet 카운트 백그라운드 갱신 — 트리 표시는 막지 않음
  indexBuilding.set(true);
  try {
    const [links, contents] = await Promise.all([scanLinks(root), readAllNotes(root)]);
    linkIndex.set(buildIndex(links));
    tagIndex.set(buildTagIndex(links));
    const facets = buildFacetCounts(links);
    docKindCounts.set(facets.docKindCounts);
    topicCounts.set(facets.topicCounts);
    rebuildIndexes(links, contents);
  } catch (e) {
    console.error("link/search index build failed", e);
    linkIndex.set(null);
    clearTagIndex();
    clearIndexes();
    clearFacetCounts();
    clearFilters();
  } finally {
    indexBuilding.set(false);
  }
}

// === Phase 4.1 — Vault 조작 high-level 함수 ===

const AUTO_UPDATE_LINKS_KEY = "lapis.autoUpdateLinks";

/** 설정 — rename/move 시 vault 내 인용 자동 갱신 여부. localStorage 영속화. */
export const autoUpdateLinks = writable<boolean>(loadAutoUpdateLinks());

function loadAutoUpdateLinks(): boolean {
  if (typeof localStorage === "undefined") return true;
  const v = localStorage.getItem(AUTO_UPDATE_LINKS_KEY);
  return v === null ? true : v === "true";
}

autoUpdateLinks.subscribe((v) => {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(AUTO_UPDATE_LINKS_KEY, String(v));
  }
});

export interface CreateNoteResult {
  path: string;
}

/**
 * 트리만 빠르게 재로드 (listNotes만 호출).
 * - 인덱스 빌드는 file watcher의 scheduleFullReload(500ms)에 위임 → UI 즉시 응답
 * - 1000노트 vault에서 ~30ms vs 전체 reloadNotes ~1-3s
 */
async function refreshTreeOnly(): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;
  treeLoading.set(true);
  try {
    const list = await listNotes(root);
    notes.set(list);
  } catch (e) {
    console.error("listNotes failed", e);
  } finally {
    treeLoading.set(false);
  }
}

export async function createNewNote(
  parentDir: string,
  fileName: string,
  content = "",
): Promise<string | null> {
  const vault = get(vaultPath);
  if (!vault) return null;
  try {
    const newPath = await createNoteTauri(vault, parentDir, fileName, content);
    await refreshTreeOnly();
    await selectNote(newPath);
    return newPath;
  } catch (e) {
    console.error("createNewNote failed", e);
    return null;
  }
}

export async function createNewFolder(parentDir: string, folderName: string): Promise<string | null> {
  const vault = get(vaultPath);
  if (!vault) return null;
  try {
    const newPath = await createFolderTauri(vault, parentDir, folderName);
    await refreshTreeOnly();
    return newPath;
  } catch (e) {
    console.error("createNewFolder failed", e);
    return null;
  }
}

export async function deletePath(path: string): Promise<boolean> {
  const vault = get(vaultPath);
  if (!vault) return false;
  try {
    await deleteNoteTauri(vault, path);
    if (get(currentNotePath) === path) {
      currentNotePath.set(null);
      currentNoteContent.set("");
    }
    await refreshTreeOnly();
    return true;
  } catch (e) {
    console.error("deletePath failed", e);
    return false;
  }
}

/**
 * 노트 이름 변경.
 * autoUpdateLinks=true면 vault 내 다른 노트들의 인용도 자동 치환 (백그라운드).
 */
export async function renamePath(oldPath: string, newName: string): Promise<string | null> {
  const vault = get(vaultPath);
  if (!vault) return null;
  const oldStem = stemOfPath(oldPath);

  try {
    const newPath = await renameNoteTauri(vault, oldPath, newName);
    const newStem = stemOfPath(newPath);

    // 현재 노트가 이 노트면 path 업데이트
    if (get(currentNotePath) === oldPath) {
      currentNotePath.set(newPath);
    }
    await refreshTreeOnly();

    // 링크 자동 갱신 — 비동기 백그라운드, UI 차단 X
    if (get(autoUpdateLinks) && oldStem !== newStem) {
      void rewriteAllLinks(vault, oldStem, newStem);
    }

    return newPath;
  } catch (e) {
    console.error("renamePath failed", e);
    return null;
  }
}

export async function movePath(path: string, newParentDir: string): Promise<string | null> {
  const vault = get(vaultPath);
  if (!vault) return null;
  try {
    const newPath = await moveNoteTauri(vault, path, newParentDir);
    // stem은 변하지 않음 — link 갱신 불필요 (path 형식만 바뀜)
    if (get(currentNotePath) === path) {
      currentNotePath.set(newPath);
    }
    await refreshTreeOnly();
    return newPath;
  } catch (e) {
    console.error("movePath failed", e);
    return null;
  }
}

function stemOfPath(p: string): string {
  const segs = p.split("/").filter(Boolean);
  const last = segs[segs.length - 1] ?? p;
  return last.replace(/\.md$/i, "");
}

/** vault 내 모든 노트를 읽어 oldStem → newStem 치환 후 저장. */
async function rewriteAllLinks(vault: string, oldStem: string, newStem: string): Promise<void> {
  const idx = get(linkIndex);
  if (!idx) return;
  const tasks: Promise<void>[] = [];
  for (const path of idx.byPath.keys()) {
    tasks.push(
      (async () => {
        try {
          const raw = await readNote(path);
          const { changed, newContent } = rewriteLinksInNote(raw, oldStem, newStem);
          if (changed) {
            await writeNote(vault, path, newContent);
          }
        } catch (e) {
          console.warn(`link rewrite failed for ${path}:`, e);
        }
      })(),
    );
  }
  await Promise.all(tasks);
}

/**
 * Wikilink target name (alias / title / file stem) → 매칭되는 노트로 점프.
 * 매칭 없으면 false 반환.
 */
export async function jumpToWikilink(target: string): Promise<boolean> {
  const idx = get(linkIndex);
  if (!idx) return false;
  const path = resolveTarget(target, idx);
  if (!path) return false;
  await selectNote(path);
  return true;
}

export async function selectNote(path: string): Promise<void> {
  // editor 모듈을 lazy import — circular import 회피
  // (editor가 vault store를 import하므로 직접 top-level import 시 초기화 순서 위험)
  let editor: typeof import("./editor") | null = null;
  try {
    editor = await import("./editor");
  } catch (e) {
    console.warn("editor module load failed", e);
  }

  // 이전 노트가 dirty면 먼저 저장
  if (editor && editor.getIsDirty()) {
    try {
      await editor.saveCurrentNote();
    } catch (e) {
      console.warn("save before navigate failed", e);
    }
  }

  try {
    const content = await readNote(path);
    currentNotePath.set(path);
    currentNoteContent.set(content);
    // editor 상태 동기화 — 새 노트 기준으로 dirty 해제
    if (editor) editor.markSaved(content);
  } catch (e) {
    console.error("read_note failed", e);
    currentNoteContent.set("");
  }
}

export async function restoreLastVault(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  const last = localStorage.getItem(STORAGE_KEY);
  if (!last) return;
  try {
    await openVault(last);
  } catch (e) {
    console.warn("restoreLastVault failed", e);
    localStorage.removeItem(STORAGE_KEY);
  }
}
