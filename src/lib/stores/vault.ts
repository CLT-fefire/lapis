import { writable, get } from "svelte/store";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import {
  listNotes,
  readNote,
  readVaultBundle,
  vaultFingerprint,
  readSearchCacheMeta,
  readSearchCacheShard,
  writeSearchCacheMeta,
  writeSearchCacheShard,
  createNote as createNoteTauri,
  createFolder as createFolderTauri,
  deleteNote as deleteNoteTauri,
  renameNote as renameNoteTauri,
  moveNote as moveNoteTauri,
  writeNote,
  backupNotes,
  pruneLinkRewriteBackups,
  scanLinkSingle,
  type NoteEntry,
} from "$lib/tauri/notes";
import {
  buildQuickEntries,
  workerLoadShard,
  workerToJSONShard,
  workerUpdateDoc,
  workerRemoveDoc,
  computeShardId,
  decideShardCount,
} from "$lib/searchIndex";
import {
  fullTextIndexReady,
  quickEntries,
  pendingFullTextVault,
  fullTextLoading,
} from "$lib/stores/search";
import {
  computeLinkRewritePreview,
  type LinkRewritePreview,
  type LinkRewritePreviewItem,
} from "$lib/linkRewrite";
import { linkRewritePreviewRequest } from "$lib/stores/linkRewritePreview";
import { markOpened, syncFromDisk } from "./unread";
import { buildIndexChunked, resolveTarget, type LinkIndex } from "$lib/linkIndex";
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
import { pushRecent } from "$lib/stores/recent";
import { scopedKey, pruneOrphanScopedKeys } from "$lib/windowScope";
import {
  recordNavigation,
  navBack,
  navForward,
  navJumpTo,
  clearNavHistory,
} from "$lib/stores/navHistory";
import {
  registerTab,
  replaceTab,
  unregisterTab,
  clearTabs,
  openTabs,
  loadTabsFor,
  saveTabsFor,
  reorderTabs,
  closeOthers,
  keepUpTo,
} from "$lib/stores/tabs";

/**
 * "이 창이 마지막으로 본 vault" — **창별**이다(2026-08-10 멀티 윈도우).
 * `main` 창은 접미사 없는 원래 키를 그대로 써서 기존 저장값을 잇는다. → `windowScope.ts`
 */
const VAULT_KEY_BASE = "lapis.last-vault-path";
const STORAGE_KEY = scopedKey(VAULT_KEY_BASE);

export const vaultPath = writable<string | null>(null);
export const notes = writable<NoteEntry[]>([]);
export const currentNotePath = writable<string | null>(null);
export const currentNoteContent = writable<string>("");
export const linkIndex = writable<LinkIndex | null>(null);
/** 트리 listNotes 진행 중 — 짧음 (~30-100ms) */
export const treeLoading = writable<boolean>(false);
/**
 * 인덱스 **최초** 빌드 진행 중 — 쓸 수 있는 인덱스가 아직 없는 상태(cold start).
 * Sidebar의 blocking dim overlay를 띄운다(보여줄 게 없으니 클릭 막아도 무방).
 */
export const indexBuilding = writable<boolean>(false);
/**
 * 인덱스 **재빌드/증분 갱신** 진행 중 — 이미 쓸 수 있는 (stale) 인덱스가 떠 있는 상태.
 * watcher 변경/수동 새로고침 등은 여기로 분류 → blocking 오버레이 없이 백그라운드 진행
 * (상단 얇은 progress strip만). 트리·노트 클릭은 그대로 사용 가능.
 */
export const indexRefreshing = writable<boolean>(false);

/**
 * 현재 풀텍스트 인덱스가 빌드된 shard 수 (cache-hit=meta.shard_count / cache-miss=
 * rebuildIndexes 결정값). 증분 갱신(`reindexIncremental`)이 노트→shard 라우팅에 사용.
 * 노트 수가 shardCount 임계를 넘으면(`decideShardCount` 변동) 증분 대신 풀 빌드로 fallback.
 */
let activeShardCount = 1;

/** 한 burst에서 이 개수를 넘는 변경은 증분 대신 풀 빌드 — 그게 더 단순/안전. */
const INCREMENTAL_MAX = 200;

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
  // 이전 vault의 인덱스는 새 vault엔 무효 → 명시적으로 비워 이 vault의 첫 빌드를
  // "최초 빌드"(blocking 오버레이)로 취급(stale 검색/백링크 노출 방지). 이후 **같은**
  // vault 내 변경(watcher/편집/수동 새로고침)은 background 재빌드($indexRefreshing).
  linkIndex.set(null);
  clearNavHistory();
  clearTabs();

  // 인덱스 빌드(큰 vault 1~3s) 전에 저장된 탭/활성 노트를 먼저 복원 → 빌드 중에도
  // 마지막 보던 문서가 즉시 표시(빈 placeholder/welcome 대신). 노트 본문은 readNote
  // 한 번이면 충분하고, linkIndex가 아직 없어도 열람 가능하다(위키링크 resolved 표시만
  // 인덱스 준비 후 채워짐). 존재하지 않는(삭제·이동된) 탭은 인덱스 준비 후 정리한다.
  const savedTabs = loadTabsFor(path);
  if (savedTabs.tabs.length > 0) {
    openTabs.set(savedTabs.tabs);
    if (savedTabs.active && savedTabs.tabs.includes(savedTabs.active)) {
      await selectNote(savedTabs.active);
    }
  }

  await reloadNotes();

  // 앱이 꺼져 있던 동안의 외부 변경을 "안 본 사이 바뀜"으로 복원.
  // 열람 이력이 있는 경로만 stat하므로 12000노트여도 대상은 보통 수백 건이고,
  // 실패해도 표시만 빠질 뿐이라 await로 막지 않는다.
  void syncFromDisk(path);

  // 인덱스 준비 후 실제 존재하지 않는 탭 정리 (외부에서 삭제·이동된 노트).
  const idx = get(linkIndex);
  if (idx) {
    const open = get(openTabs);
    const liveTabs = open.filter((p) => idx.byPath.has(p));
    if (liveTabs.length !== open.length) {
      openTabs.set(liveTabs);
      const active = get(currentNotePath);
      if (active && !idx.byPath.has(active)) {
        currentNotePath.set(null);
        currentNoteContent.set("");
      }
      persistTabs();
    }
  }

  // 파일 watcher 시작 — circular import 회피 위해 lazy import
  try {
    const { startWatching } = await import("./watcher");
    await startWatching();
  } catch (e) {
    console.warn("[vault] startWatching failed", e);
  }

  // git 버전관리 상태 갱신(repo 여부 + "시작?" 배너 판단). lazy import로 circular 회피.
  try {
    const { refreshGitStatus } = await import("./git");
    await refreshGitStatus(path);
  } catch (e) {
    console.warn("[vault] refreshGitStatus failed", e);
  }
}

/**
 * 빌드 단계 사이 양보 — `requestAnimationFrame` 우선이라 다음 paint까지 기다림 →
 * 인덱스 빌드 오버레이 스피너가 단계 사이에 실제로 갱신/회전한다(setTimeout(0)은 메인
 * 스레드가 바쁘면 paint를 건너뛸 수 있음). rAF 없으면(test 등) setTimeout(0) fallback.
 */
function nextTick(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * cache hit 시점에 호출 — `pendingFullTextVault`에 박은 vault path 기준으로 idle 시점에
 * `read_search_cache_minisearch_json`(30MB IPC) + `MiniSearch.loadJSON`(sync 4.5s) 진행.
 * cold-start measurement에서 4.5s + ~1s IPC 빠짐.
 *
 * 같은 vault open 안에서 이미 빌드됐거나 진행 중이면 noop.
 * 사용자가 검색을 시도해서 `ensureFullTextIndex`(아래)가 먼저 호출되면 그쪽이
 * pending을 소비하므로 본 함수가 다시 와도 noop.
 */
let lazyLoadScheduled = false;
function scheduleLazyFullTextLoad(): void {
  if (lazyLoadScheduled) return;
  lazyLoadScheduled = true;
  const run = () => {
    lazyLoadScheduled = false;
    void buildFullTextFromPending().catch((e) => {
      console.warn("[search] lazy fulltext load failed", e);
    });
  };
  // requestIdleCallback이 있으면 idle 진입 시점, 없으면 fallback 50ms.
  const ric = (globalThis as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") {
    ric(run, { timeout: 5000 });
  } else {
    setTimeout(run, 50);
  }
}

/**
 * 사용자 검색 모달이 열릴 때 호출 — 현재 fullTextIndex가 null + pending이 있으면
 * 즉시 백그라운드 로드 트리거. 이미 빌드 중/완료면 noop. idempotent.
 */
export async function ensureFullTextIndex(): Promise<void> {
  if (get(fullTextIndexReady)) return;
  if (get(fullTextLoading)) return; // 다른 lazy 빌드 진행 중 — 그쪽이 끝낼 것
  await buildFullTextFromPending();
}

async function buildFullTextFromPending(): Promise<void> {
  if (get(fullTextIndexReady)) return;
  // race 방지 — idle callback + CommandPalette open이 같은 함수를 두 번 호출 시
  // 중복 진입 차단.
  if (get(fullTextLoading)) return;
  const pending = get(pendingFullTextVault);
  if (!pending) return;
  const { vault, shardCount } = pending;
  const perf = import.meta.env.DEV;
  fullTextLoading.set(true);
  try {
    // N shard 순차 로드 — vault별 shardCount(decideShardCount). 첫 shard 완료 시
    // fullTextIndexReady set → partial 검색 가능.
    for (let i = 0; i < shardCount; i++) {
      const t0 = perf ? performance.now() : 0;
      const json = await readSearchCacheShard(vault, i);
      if (!json) {
        console.warn(`[search-cache] shard${i} missing at lazy load time`);
        continue;
      }
      const tFetch = perf ? performance.now() : 0;
      await workerLoadShard(i, json);
      if (i === 0) fullTextIndexReady.set(true);
      if (perf) {
        const tLoad = performance.now();
        console.debug(
          `[lapis-perf] fulltext-lazy.shard${i} fetch=${(tFetch - t0).toFixed(0)}ms ` +
            `worker.loadJSON=${(tLoad - tFetch).toFixed(0)}ms`,
        );
      }
    }
    if (!get(fullTextIndexReady)) {
      console.warn("[search-cache] no shards loaded — keeping fullTextIndexReady=false");
    }
  } catch (e) {
    console.warn("[search-cache] worker loadShard failed", e);
  } finally {
    pendingFullTextVault.set(null);
    fullTextLoading.set(false);
  }
}

/**
 * 진행 중 reloadNotes 중복 호출 guard.
 * 예: 모달/액션이 직접 await reloadNotes를 부르는 동안 file watcher의
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

/**
 * **강제 재구축** — fingerprint 디스크 캐시를 무시하고 vault 전체를 다시 읽어 모든 인덱스를
 * 처음부터 재빌드한다(+ 캐시 덮어쓰기). 풀텍스트 워커도 `clearIndexes()`로 비운 뒤 다시 채워
 * stale shard 잔존 가능성까지 제거. 외부 대량 변경(예: frontmatter 정규화) 후 "확실히 새로",
 * 또는 fingerprint가 못 잡는 mtime·size 동일 in-place write 복구용. 커맨드 `rebuild-index`에서 호출.
 */
export async function forceReindex(): Promise<void> {
  if (reloadInFlight) return;
  reloadInFlight = true;
  try {
    await reloadNotesInner(true);
  } finally {
    reloadInFlight = false;
  }
}

async function reloadNotesInner(force = false): Promise<void> {
  const root = get(vaultPath);
  if (!root) return;
  // 쓸 수 있는 인덱스가 이미 떠 있으면 이번은 "재빌드"(watcher fallback / 수동 새로고침) →
  // blocking 오버레이 대신 백그라운드(progress strip만). 최초 빌드(linkIndex 없음)만 blocking.
  // 인덱스는 빌드 완료 후 atomic하게 .set 되므로 재빌드 중에도 이전 인덱스로 계속 탐색 가능.
  // 최초 빌드(인덱스 없음)와 **명시적 강제 재구축(force)**은 blocking 오버레이(+progress) — force는
  // 풀텍스트 shard를 in-place로 reset→refill해 검색이 torn이므로 사이드바·팔레트를 막아 혼란 방지.
  // watcher 증분/일반 새로고침은 non-blocking strip(읽던 인덱스로 계속 탐색).
  const buildState = force || get(linkIndex) === null ? indexBuilding : indexRefreshing;
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

  // 강제 재구축: 풀텍스트 워커를 먼저 비운다(stale shard 잔존 제거). 이후 miss 경로가
  // 전체 재읽기로 다시 채운다. (워커 메시지는 순서 보장 — resetAll → addToShard 순.)
  if (force) clearIndexes();

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
  buildState.set(true);
  try {
    // cold-start cacheLookup — 메타만 받음 (link_infos ~2-3MB). minisearch_json(30MB)은
    // lazy 시점에 별 명령으로. Tauri IPC + frontend JSON.parse 비용 큰 폭 단축.
    const [fp, meta] = await Promise.all([
      vaultFingerprint(root),
      readSearchCacheMeta(root),
    ]);
    fingerprint = fp.fingerprint;
    if (perf) tCacheCheckEnd = performance.now();

    let appliedFromCache = false;
    if (!force && meta && meta.fingerprint === fp.fingerprint) {
      // cache hit. link_infos는 즉시 사용. fullTextIndex는 lazy — pendingFullTextVault에
      // vault path만 박고 idle 시점에 minisearch_json 받아 loadJSON.
      const links = meta.link_infos;
      linkIndex.set(await buildIndexChunked(links));
      await nextTick();
      tagIndex.set(buildTagIndex(links));
      await nextTick();
      const facets = buildFacetCounts(links);
      docKindCounts.set(facets.docKindCounts);
      topicCounts.set(facets.topicCounts);
      await nextTick();
      quickEntries.set(buildQuickEntries(links));
      fullTextIndexReady.set(false);
      // meta.shard_count는 cache miss 시 결정한 동적 값. lazy load가 같은 수로 순차 로드.
      activeShardCount = meta.shard_count;
      pendingFullTextVault.set({ vault: root, shardCount: meta.shard_count });
      scheduleLazyFullTextLoad();
      appliedFromCache = true;
      cacheMode = "hit";
      if (perf) {
        console.debug(
          `[lapis-perf] search-cache HIT fp=${fp.fingerprint} ` +
            `files=${fp.file_count} links=${links.length} ` +
            `(minisearch_json + loadJSON deferred → idle)`,
        );
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

      linkIndex.set(await buildIndexChunked(links));
      await nextTick();

      tagIndex.set(buildTagIndex(links));
      await nextTick();

      const facets = buildFacetCounts(links);
      docKindCounts.set(facets.docKindCounts);
      topicCounts.set(facets.topicCounts);
      await nextTick();

      // rebuildIndexes — 동적 shardCount 반환 (vault 크기 기반)
      const shardCount = await rebuildIndexes(links, contents);
      activeShardCount = shardCount;

      // 캐시 저장 — 진짜 fire-and-forget. setTimeout(0)으로 macrotask 분리.
      const fpForSave = fp.fingerprint;
      const linksForSave = links;
      setTimeout(() => {
        void saveSearchCache(root, linksForSave, shardCount, fpForSave).catch((e) =>
          console.warn("[search-cache] write failed", e),
        );
      }, 0);
    }
  } catch (e) {
    console.error("link/search index build failed", e);
    linkIndex.set(null);
    clearTagIndex();
    clearIndexes();
    clearFacetCounts();
    clearFilters();
  } finally {
    buildState.set(false);
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

/**
 * 풀텍스트 디스크 캐시 저장 (meta + shard JSON). cache-miss 풀 빌드와 증분 갱신 후
 * 재저장이 공유. worker.toJSONShard는 worker thread 직렬화 → main freeze 0.
 */
async function saveSearchCache(
  root: string,
  links: import("$lib/tauri/notes").LinkInfo[],
  shardCount: number,
  fingerprint: string,
): Promise<void> {
  if (!get(fullTextIndexReady)) return;
  await writeSearchCacheMeta(root, fingerprint, links, shardCount);
  for (let i = 0; i < shardCount; i++) {
    const json = await workerToJSONShard(i);
    if (!json) continue;
    await writeSearchCacheShard(root, i, json);
  }
  if (import.meta.env.DEV) {
    console.debug(`[lapis-perf] search-cache saved fp=${fingerprint} shards=${shardCount}`);
  }
}

/**
 * 외부 파일 변경(watcher)을 **in-memory 인덱스에 증분 반영**.
 *
 * 기존엔 변경 1건에도 `read_vault_bundle`로 vault 전체(12000+노트 body)를 다시 읽어
 * 모든 인덱스를 재빌드 → 메인 스레드 수 초 점유(인덱스 빌드 스피너 freeze)였다.
 * 이제:
 *  - **풀텍스트**: 바뀐 노트만 worker add/replace/discard (전체 재빌드·재읽기 없음)
 *  - **파생(resolver/backlinks/relations/tag/facet/quick)**: 현재 `byPath`(메모리)로 재계산
 *    (IPC 재읽기 없음, buildIndexChunked는 청크 yield)
 *  - **트리**: listNotes만 (본문 미읽음, 저렴)
 *  - **디스크 캐시**: 백그라운드 재저장(다음 launch 캐시 HIT 유지)
 *
 * 인덱스 미준비 / 대량 burst / shardCount 임계 변동 시 `reloadNotes`(풀 빌드)로 fallback.
 *
 * @returns true=처리 완료(또는 fallback 수행), false=다른 reload/reindex 진행 중(caller가 재시도).
 */
export async function reindexIncremental(
  changed: string[],
  removed: string[],
): Promise<boolean> {
  if (reloadInFlight) return false; // 다른 reload/reindex 진행 중 — caller가 변경분 재큐
  const root = get(vaultPath);
  if (!root) return true;
  const idx = get(linkIndex);
  if (!idx) {
    await reloadNotes(); // 인덱스 없음 → 풀 빌드
    return true;
  }

  // 노트 수 추정 → shardCount 변동(임계 통과) 또는 대량 변경이면 풀 빌드가 더 안전/단순.
  const addCount = changed.filter((p) => !idx.byPath.has(p)).length;
  const delCount = removed.filter((p) => idx.byPath.has(p)).length;
  const newNoteCount = idx.byPath.size + addCount - delCount;
  if (
    changed.length + removed.length > INCREMENTAL_MAX ||
    decideShardCount(newNoteCount) !== activeShardCount
  ) {
    await reloadNotes();
    return true;
  }

  reloadInFlight = true;
  indexRefreshing.set(true); // 백그라운드 진행 표시(progress strip만) — 오버레이 없음
  try {
    // 트리 갱신 (listNotes — 본문 미읽음, ~수십 ms)
    await refreshTreeOnly();

    // 풀텍스트 worker는 캐시 로드가 끝나야 증분 가능(pending이면 먼저 로드). 로드 못 하면
    // (캐시 없음/진행 중) 풀텍스트 증분은 건너뛰고 파생만 갱신 → 다음 풀 빌드가 정정.
    await ensureFullTextIndex();
    const ftReady = get(fullTextIndexReady);

    // byPath 사본에 증분 적용 → 파생 재빌드 입력(원본은 final set 전까지 보존).
    const infosMap = new Map(idx.byPath);
    for (const path of removed) {
      infosMap.delete(path);
      if (ftReady) {
        try {
          await workerRemoveDoc(computeShardId(path, activeShardCount), path);
        } catch (e) {
          console.warn("[reindex] removeDoc 실패", path, e);
        }
      }
    }
    for (const path of changed) {
      try {
        const info = await scanLinkSingle(root, path);
        infosMap.set(info.source_path, info);
        if (ftReady) {
          const body = await readNote(path);
          await workerUpdateDoc(computeShardId(path, activeShardCount), {
            id: path,
            name: info.source_name,
            body,
          });
        }
      } catch (e) {
        console.warn("[reindex] scan/update 실패", path, e);
      }
    }

    // 파생 인덱스 재빌드 — in-memory(IPC 재읽기 없음). buildIndexChunked는 청크 yield.
    const infos = Array.from(infosMap.values());
    linkIndex.set(await buildIndexChunked(infos));
    tagIndex.set(buildTagIndex(infos));
    const facets = buildFacetCounts(infos);
    docKindCounts.set(facets.docKindCounts);
    topicCounts.set(facets.topicCounts);
    quickEntries.set(buildQuickEntries(infos));
    clearBacklinkCache();

    // 디스크 캐시 백그라운드 재저장 → 다음 launch 캐시 HIT 유지(변경 fingerprint 반영).
    if (ftReady) {
      const infosForSave = infos;
      const shardForSave = activeShardCount;
      setTimeout(() => {
        void (async () => {
          try {
            const fp = await vaultFingerprint(root);
            await saveSearchCache(root, infosForSave, shardForSave, fp.fingerprint);
          } catch (e) {
            console.warn("[reindex] 캐시 재저장 실패", e);
          }
        })();
      }, 0);
    }
  } finally {
    reloadInFlight = false;
    indexRefreshing.set(false);
  }
  return true;
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
    // 탭에서 제거 + 활성이었으면 인접 탭으로(또는 빈 상태).
    await closeTab(path);
    await refreshTreeOnly();
    clearBacklinkCache(); // 백링크 스니펫 즉시 무효화 (watcher 디바운스 갭 제거)
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
    clearBacklinkCache(); // rename/링크갱신 전후 백링크 스니펫 즉시 무효화 (watcher 갭 제거)

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
    clearBacklinkCache(); // source path 변경 → 백링크 캐시 키 무효화
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

export async function selectNote(
  path: string,
  opts: { fromHistory?: boolean; replaceCurrentTab?: boolean } = {},
): Promise<void> {
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

  // 탭 교체(⌘P)는 **덮어쓸 자리**를 알아야 하므로 currentNotePath가 바뀌기 전에 잡는다.
  const prevPath = get(currentNotePath);

  try {
    const content = await readNote(path);
    currentNotePath.set(path);
    currentNoteContent.set(content);
    // editor 상태 동기화 — 새 노트 기준으로 dirty 해제
    if (editor) editor.markSaved(content);
    pushRecent(path);
    // ⌘P는 활성 탭을 갈아끼우고(잠깐 보기), 그 밖의 모든 경로는 탭을 추가한다(붙잡기).
    if (opts.replaceCurrentTab) replaceTab(prevPath, path);
    else registerTab(path);
    persistTabs();
    // "안 본 사이 바뀜" 기준점 갱신 + 표시 해제. 읽은 직후이므로 지금이 기준이다.
    markOpened(path, Date.now());
    // 뒤로/앞으로 이동(fromHistory)이 아닌 일반 열기만 히스토리에 기록.
    if (!opts.fromHistory) recordNavigation(path);
  } catch (e) {
    console.error("read_note failed", e);
    currentNoteContent.set("");
  }
}

/** 뒤로 가기 — 직전 방문 노트로. 히스토리엔 재기록하지 않음. */
export async function goBackNote(): Promise<void> {
  const cur = get(currentNotePath);
  const path = navBack();
  if (path && path !== cur) await selectNote(path, { fromHistory: true });
}

/** 앞으로 가기 — 뒤로 갔다가 되돌아온 노트로. 히스토리엔 재기록하지 않음. */
export async function goForwardNote(): Promise<void> {
  const cur = get(currentNotePath);
  const path = navForward();
  if (path && path !== cur) await selectNote(path, { fromHistory: true });
}

/** 히스토리 목록에서 특정 index로 점프. 히스토리엔 재기록하지 않음. */
export async function goToHistory(index: number): Promise<void> {
  const cur = get(currentNotePath);
  const path = navJumpTo(index);
  if (path && path !== cur) await selectNote(path, { fromHistory: true });
}

/**
 * 탭 닫기 — 목록에서 제거하고, 닫은 게 활성 탭이면 인접 탭으로 전환.
 * 마지막 탭을 닫으면 빈 상태.
 */
export async function closeTab(path: string): Promise<void> {
  if (!path) return;
  const wasActive = get(currentNotePath) === path;
  const nextActive = unregisterTab(path, get(currentNotePath));
  if (!wasActive) {
    persistTabs(); // 비활성 탭 닫기 — 목록만 변경, 저장
    return;
  }
  if (nextActive) {
    await selectNote(nextActive, { fromHistory: true }); // selectNote가 persistTabs 호출
  } else {
    currentNotePath.set(null);
    currentNoteContent.set("");
    persistTabs();
  }
}

/** 현재 vault의 열린 탭 + 활성 노트를 localStorage에 저장. */
function persistTabs(): void {
  saveTabsFor(get(vaultPath) ?? "", get(openTabs), get(currentNotePath));
}

/** 탭 드래그 재정렬 — from 위치 탭을 to로 이동. */
export function moveTab(from: number, to: number): void {
  openTabs.update((t) => reorderTabs(t, from, to));
  persistTabs();
}

/** 다른 탭 모두 닫기 — path만 남기고 그 탭을 활성화. */
export async function closeOtherTabs(path: string): Promise<void> {
  openTabs.set(closeOthers(get(openTabs), path));
  if (get(currentNotePath) !== path) {
    await selectNote(path, { fromHistory: true }); // selectNote가 persistTabs 호출
  } else {
    persistTabs();
  }
}

/** 오른쪽 탭 모두 닫기 — path까지 유지. 활성이 잘려나갔으면 path로 전환. */
export async function closeTabsToRight(path: string): Promise<void> {
  const kept = keepUpTo(get(openTabs), path);
  openTabs.set(kept);
  const active = get(currentNotePath);
  if (active && !kept.includes(active)) {
    await selectNote(path, { fromHistory: true });
  } else {
    persistTabs();
  }
}

export async function restoreLastVault(): Promise<void> {
  if (typeof localStorage === "undefined") return;
  // 지난 실행에서 열려 있던 보조 창(w2, w3…)의 키는 아무도 회수하지 않는다 —
  // Tauri가 재시작 때 만드는 창은 `main` 하나뿐이라 여기서 걷어낸다.
  pruneOrphanScopedKeys(VAULT_KEY_BASE);
  const last = localStorage.getItem(STORAGE_KEY);
  if (!last) return;
  try {
    await openVault(last);
  } catch (e) {
    console.warn("restoreLastVault failed", e);
    localStorage.removeItem(STORAGE_KEY);
  }
}
