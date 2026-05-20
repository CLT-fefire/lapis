import { writable, get } from "svelte/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  listNotes,
  readNote,
  readVaultBundle,
  vaultFingerprint,
  readSearchCache,
  writeSearchCache,
  createNote as createNoteTauri,
  createFolder as createFolderTauri,
  deleteNote as deleteNoteTauri,
  renameNote as renameNoteTauri,
  moveNote as moveNoteTauri,
  writeNote,
  backupNotes,
  pruneLinkRewriteBackups,
  type NoteEntry,
} from "$lib/tauri/notes";
import { loadFullTextIndexFromJson, buildQuickEntries } from "$lib/searchIndex";
import { fullTextIndex, quickEntries } from "$lib/stores/search";
import {
  computeLinkRewritePreview,
  type LinkRewritePreview,
  type LinkRewritePreviewItem,
} from "$lib/linkRewrite";
import { linkRewritePreviewRequest } from "$lib/stores/linkRewritePreview";
import { buildIndex, resolveTarget, type LinkIndex } from "$lib/linkIndex";
import { clearBacklinkCache } from "$lib/backlinks";
import { rebuildIndexes, clearIndexes } from "$lib/stores/search";
import { buildTagIndex, tagIndex, clearTagIndex } from "$lib/stores/tags";
import {
  buildFacetCounts,
  docKindCounts,
  topicCounts,
  clearFacetCounts,
  clearFilters,
} from "$lib/stores/filters";
import { pushRecent, rememberLastClosed } from "$lib/stores/recent";

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

  // Lapis mirror DB 증분 sync (Phase 5.2 PR1). 백그라운드 IIFE — vault 열기 흐름 차단 X.
  // PR2 #12: vault path 전달로 mirror 삭제 시 .md 자동 정리(orphans.json 박제).
  void (async () => {
    try {
      const { mirrorSyncNow } = await import("$lib/tauri/mirror");
      const report = await mirrorSyncNow(false, path);
      console.log(
        `[mirror] sync: summaries ${report.summaries_upserted}, observations ${report.observations_upserted}, deleted ${report.deleted} · ${report.duration_ms}ms`,
      );
    } catch (e) {
      // 실패는 silent — claude-mem.db 부재 등은 정상 시나리오. 사이드바 status indicator(PR2)가 surface.
      console.warn("[mirror] sync failed:", e);
    }
  })();
}

/** 다음 macro task로 양보 — JS event loop가 OS/UI 메시지 처리 시간 확보. */
function nextTick(): Promise<void> {
  return new Promise<void>((r) => setTimeout(r, 0));
}

/**
 * 진행 중 reloadNotes 중복 호출 guard.
 * 예: MemorySyncModal이 직접 await reloadNotes를 부르는 동안 file watcher의
 * scheduleFullReload(500ms 디바운스)도 같은 burst 끝에 한 번 부른다 → guard로 중복 차단.
 */
let reloadInFlight = false;

export async function reloadNotes(): Promise<void> {
  if (reloadInFlight) return;
  reloadInFlight = true;
  try {
    await reloadNotesInner();
  } finally {
    reloadInFlight = false;
  }
}

async function reloadNotesInner(): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;
  // dev 모드 측정 — 어느 단계가 cold start 비용을 차지하는지 추적. release는 dead code.
  const perf = import.meta.env.DEV;
  const t0 = perf ? performance.now() : 0;
  let tListEnd = 0;
  let tCacheCheckEnd = 0;
  let tEnd = 0;
  let noteCount = 0;
  let cacheMode: "hit" | "miss" = "miss";
  let fingerprint = "";

  // 전체 인덱스 재빌드 시 백링크 snippet 캐시도 stale — 안전하게 전부 비움.
  clearBacklinkCache();

  // 1) 트리
  treeLoading.set(true);
  try {
    const list = await listNotes(root);
    notes.set(list);
    noteCount = list.length;
  } catch (e) {
    console.error("list_notes failed", e);
    notes.set([]);
  } finally {
    treeLoading.set(false);
  }
  if (perf) tListEnd = performance.now();

  // 2) 캐시 hit/miss 결정 + 인덱스 빌드
  // 5.1.d 변경: 큰 vault(10000+ 노트) MiniSearch 빌드가 main thread를 수 초 점유 → 다른
  // 앱/macOS WindowServer 응답성 저하. chunked yield + dim overlay로 처리(`Sidebar`).
  // 본 chore(2026-05-20): vault fingerprint(stat 누적 hash) + disk 캐시(MiniSearch JSON +
  // link_infos)로 vault 변경이 없으면 9s addAll + 1s IPC body를 모두 회피. cache miss는
  // 첫 사용/노트 편집 후만 발생.
  indexBuilding.set(true);
  try {
    const [fp, cache] = await Promise.all([
      vaultFingerprint(root),
      readSearchCache(root),
    ]);
    fingerprint = fp.fingerprint;
    if (perf) tCacheCheckEnd = performance.now();

    let appliedFromCache = false;
    if (cache && cache.fingerprint === fp.fingerprint) {
      const idx = loadFullTextIndexFromJson(cache.minisearch_json);
      if (idx) {
        const links = cache.link_infos;
        linkIndex.set(buildIndex(links));
        await nextTick();
        tagIndex.set(buildTagIndex(links));
        await nextTick();
        const facets = buildFacetCounts(links);
        docKindCounts.set(facets.docKindCounts);
        topicCounts.set(facets.topicCounts);
        await nextTick();
        quickEntries.set(buildQuickEntries(links));
        fullTextIndex.set(idx);
        appliedFromCache = true;
        cacheMode = "hit";
        if (perf) {
          console.debug(
            `[lapis-perf] search-cache HIT fp=${fp.fingerprint} ` +
              `files=${fp.file_count} links=${links.length} ` +
              `addAll skipped (~9s saved)`,
          );
        }
      }
    }

    if (!appliedFromCache) {
      // cache miss(또는 loadJSON 실패) — 풀 빌드 + 캐시 저장
      const bundle = await readVaultBundle(root);
      if (perf) {
        console.debug(
          `[lapis-perf] vault-bundle files=${bundle.stats.file_count} ` +
            `walk=${bundle.stats.walk_ms}ms read=${bundle.stats.read_ms}ms`,
        );
      }
      const links = bundle.links;
      const contents = bundle.contents;
      await nextTick();

      linkIndex.set(buildIndex(links));
      await nextTick();

      tagIndex.set(buildTagIndex(links));
      await nextTick();

      const facets = buildFacetCounts(links);
      docKindCounts.set(facets.docKindCounts);
      topicCounts.set(facets.topicCounts);
      await nextTick();

      // rebuildIndexes는 내부에서 MiniSearch addAll을 chunked로 yield
      await rebuildIndexes(links, contents);

      // 캐시 저장 — fire-and-forget. 사용자 perceived 지연 없도록 await 안 함.
      // 다음 vault open에서 hit. 저장 실패는 silent (다음에 다시 시도).
      void (async () => {
        try {
          const idx = get(fullTextIndex);
          if (!idx) return;
          // JSON.stringify(idx)는 MiniSearch가 노출하는 toJSON 메서드를 자동 호출.
          await writeSearchCache(root, fp.fingerprint, JSON.stringify(idx), links);
          if (import.meta.env.DEV) {
            console.debug(`[lapis-perf] search-cache saved fp=${fp.fingerprint}`);
          }
        } catch (e) {
          console.warn("[search-cache] write failed", e);
        }
      })();
    }
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
  if (perf) {
    tEnd = performance.now();
    const fmt = (a: number, b: number) => (b - a).toFixed(0);
    console.debug(
      `[lapis-perf] reloadNotes cache=${cacheMode} fp=${fingerprint} ` +
        `notes=${noteCount} list=${fmt(t0, tListEnd)}ms ` +
        `cacheLookup=${fmt(tListEnd, tCacheCheckEnd)}ms ` +
        `build=${fmt(tCacheCheckEnd, tEnd)}ms total=${fmt(t0, tEnd)}ms`,
    );
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

    // 링크 자동 갱신 — preview 모달 → confirm → backup → write.
    // 비동기 백그라운드: rename 자체는 UI 차단 X, 모달은 별도 흐름.
    if (get(autoUpdateLinks) && oldStem !== newStem) {
      void rewriteAllLinksWithPreview(vault, oldStem, newStem);
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

/**
 * vault 내 모든 노트를 읽어 oldStem → newStem 치환.
 *
 * 흐름 (옵션 1 — 안전망):
 * 1. 모든 노트 read → in-memory map
 * 2. `computeLinkRewritePreview`로 affected note 계산 (write 안 함)
 * 3. affected 0건 → 즉시 종료 (모달 X)
 * 4. affected ≥1건 → 모달로 사용자 confirm 대기
 * 5. confirm → vault 안 `.lapis/link-rewrite-backup/<ISO-ts>/`에 affected 노트 원본 백업
 * 6. 백업 성공 시 newContent를 write. 한 파일 write 실패 시 즉시 중단(이미 쓴 건 backup으로 수동 복구)
 */
async function rewriteAllLinksWithPreview(
  vault: string,
  oldStem: string,
  newStem: string,
): Promise<void> {
  const idx = get(linkIndex);
  if (!idx) return;

  // 1) 모든 노트 read → map
  const notesMap = new Map<string, string>();
  await Promise.all(
    Array.from(idx.byPath.keys()).map(async (path) => {
      try {
        notesMap.set(path, await readNote(path));
      } catch (e) {
        console.warn(`readNote failed for preview ${path}:`, e);
      }
    }),
  );

  // 2) preview 계산
  const preview = computeLinkRewritePreview(notesMap, oldStem, newStem);
  if (preview.items.length === 0) return;

  // 3) 사용자 confirm 대기
  const apply = await new Promise<boolean>((resolve) => {
    linkRewritePreviewRequest.set({ preview, resolve });
  });
  if (!apply) return;

  // 4) 백업 + write
  await backupAndWrite(vault, preview);
}

async function backupAndWrite(
  vault: string,
  preview: LinkRewritePreview,
): Promise<void> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirRel = `.lapis/link-rewrite-backup/${ts}`;
  const sources = preview.items.map((i: LinkRewritePreviewItem) => i.path);
  let backupAbs: string;
  try {
    backupAbs = await backupNotes(vault, sources, backupDirRel);
    console.info(`[lapis] link rewrite backup → ${backupAbs}`);
  } catch (e) {
    console.error("link rewrite backup failed — write aborted:", e);
    return;
  }

  // 순차 write. 실패 시 이미 성공한 path들을 backup에서 원본 복원.
  const written: string[] = [];
  for (const item of preview.items) {
    try {
      await writeNote(vault, item.path, item.newContent);
      written.push(item.path);
    } catch (e) {
      console.error(`link rewrite write failed for ${item.path}:`, e);
      await rollbackFromBackup(vault, backupAbs, written);
      console.info(
        `[lapis] 추가 수동 복구 필요 시 ${backupAbs} 에서 회수 가능`,
      );
      return;
    }
  }

  // 모든 write 성공 → 오래된 백업 prune (실패해도 메인 흐름엔 영향 X)
  void pruneOldBackups(vault);
}

/**
 * write fail 시 이미 갱신된 파일을 backup의 원본으로 되돌림.
 * 복원 자체도 실패하면 stderr 로깅 + 다음으로 — 부분 복원이라도 시도.
 */
async function rollbackFromBackup(
  vault: string,
  backupAbs: string,
  writtenPaths: string[],
): Promise<void> {
  if (writtenPaths.length === 0) return;
  console.info(`[lapis] 자동 롤백 시작: ${writtenPaths.length}건 복원`);
  // vault path는 canonicalize 결과(trailing slash X). vault relative 추출 후 backup path 조립.
  // item.path는 Rust canonicalize 결과(절대 경로) → vault.startsWith 보장.
  let restored = 0;
  for (const target of writtenPaths) {
    try {
      const rel = relativeToVault(vault, target);
      if (rel === null) {
        console.error(`rollback: ${target}이 vault(${vault}) 밖 — skip`);
        continue;
      }
      const backupFile = `${backupAbs}/${rel}`;
      const original = await readNote(backupFile);
      await writeNote(vault, target, original);
      restored++;
    } catch (re) {
      console.error(`rollback failed for ${target}:`, re);
    }
  }
  console.info(`[lapis] 자동 롤백 완료: ${restored}/${writtenPaths.length}건 복원`);
}

/** vault 기준 상대 경로. abs가 vault 안이 아니면 null. */
function relativeToVault(vault: string, abs: string): string | null {
  const prefix = vault.endsWith("/") ? vault : vault + "/";
  if (!abs.startsWith(prefix)) return null;
  return abs.slice(prefix.length);
}

async function pruneOldBackups(vault: string): Promise<void> {
  // Settings(linkRewriteBackupKeep)의 현재 값을 사용. lazy import로 circular import 회피.
  const { linkRewriteBackupKeep, LINK_REWRITE_BACKUP_KEEP_DEFAULT } = await import("./settings");
  const max = get(linkRewriteBackupKeep) || LINK_REWRITE_BACKUP_KEEP_DEFAULT;
  try {
    const removed = await pruneLinkRewriteBackups(vault, max);
    if (removed > 0) {
      console.info(`[lapis] backup prune: ${removed}개 디렉토리 정리 (max_keep=${max})`);
    }
  } catch (e) {
    console.warn("backup prune failed:", e);
  }
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

  // 새 노트 열기 직전, 직전 노트 path를 lastClosed로 기록 (Cmd+Shift+T 대상).
  // 같은 노트 재선택은 의미 없으므로 다를 때만.
  const prevPath = get(currentNotePath);
  if (prevPath && prevPath !== path) {
    rememberLastClosed(prevPath);
  }

  try {
    const content = await readNote(path);
    currentNotePath.set(path);
    currentNoteContent.set(content);
    // editor 상태 동기화 — 새 노트 기준으로 dirty 해제
    if (editor) editor.markSaved(content);
    pushRecent(path);
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
