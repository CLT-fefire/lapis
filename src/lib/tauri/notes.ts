import { invoke } from "$lib/tauri/invoke";

export interface NoteEntry {
  path: string;
  rel_path: string;
  name: string;
  is_dir: boolean;
  children: NoteEntry[] | null;
}

/**
 * 디버그 빌드 여부. 릴리즈 앱과 디버그 앱을 동시에 띄울 때 구분 표식을 켜는 데 쓴다.
 *
 * ⚠️ `import.meta.env.DEV`로 대신하지 말 것 — 그건 **프론트 번들** 모드라
 * `tauri build --debug`처럼 Rust만 디버그인 조합에서 창 제목(Rust가 붙인다)과
 * UI 배지가 어긋난다. 판정의 단일 진실은 Rust의 `cfg!(debug_assertions)`다.
 */
export function isDebugBuild(): Promise<boolean> {
  return invoke<boolean>("is_debug_build");
}

export function listNotes(vaultPath: string): Promise<NoteEntry[]> {
  return invoke<NoteEntry[]>("list_notes", { vaultPath });
}

export function readNote(path: string): Promise<string> {
  return invoke<string>("read_note", { path });
}

export function writeNote(vaultPath: string, path: string, content: string): Promise<void> {
  return invoke<void>("write_note", { vaultPath, path, content });
}

/**
 * 임의 경로에 바이너리 파일 atomic 저장 (mermaid PNG 내보내기 등).
 * 경로는 save 다이얼로그로 사용자가 고른 것 — vault confine 비적용.
 * `Array.from(bytes)`로 number[] JSON 직렬화 → Rust `Vec<u8>`.
 */
export function writeBinaryFile(path: string, bytes: Uint8Array): Promise<void> {
  return invoke<void>("write_binary_file", { path, bytes: Array.from(bytes) });
}

/** parent_dir(vault 상대 또는 절대) 안에 새 .md 노트 생성. 생성된 절대 경로 반환. */
export function createNote(
  vaultPath: string,
  parentDir: string,
  fileName: string,
  content: string,
): Promise<string> {
  return invoke<string>("create_note", { vaultPath, parentDir, fileName, content });
}

/** parent_dir 안에 새 폴더 생성. 절대 경로 반환. */
export function createFolder(
  vaultPath: string,
  parentDir: string,
  folderName: string,
): Promise<string> {
  return invoke<string>("create_folder", { vaultPath, parentDir, folderName });
}

/** 시스템 휴지통으로 이동. 파일·폴더 모두 가능. */
export function deleteNote(vaultPath: string, path: string): Promise<void> {
  return invoke<void>("delete_note", { vaultPath, path });
}

/** 같은 디렉토리 안에서 이름 변경. 새 절대 경로 반환. */
export function renameNote(
  vaultPath: string,
  oldPath: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_note", { vaultPath, oldPath, newName });
}

/** 다른 폴더로 이동. 새 절대 경로 반환. */
export function moveNote(
  vaultPath: string,
  path: string,
  newParentDir: string,
): Promise<string> {
  return invoke<string>("move_note", { vaultPath, path, newParentDir });
}

export interface LinkInfo {
  source_path: string;
  source_name: string;
  title: string | null;
  aliases: string[];
  targets: string[]; // wikilink `[[...]]` + md link `[text](file.md)` 통합. last segment + .md 제거된 형태
  tags: string[];    // frontmatter `tags` 만 (Phase 3.0부터 본문 #tag 폐기). kebab-case + nested(`/`) 허용
  // SharedDocs 4키 스키마 (Markdown-Tag-Management-Guide.md §2)
  doc_kind: string | null; // requirements | spec | plan | solution | analysis | brainstorm | howto | reference | meeting-notes
  topic: string | null;    // kebab-case 단일 도메인
  related: string[];       // 파일 stem 배열 (cross-ref)
  // Phase A 지식 그래프 — 모든 top-level frontmatter 키 → 값 목록 (generic).
  // 그룹핑(필드 렌즈)·관계 감지의 원천. 값 정규화(경로/콤마/꼬리주석)는 normalizeRef에서.
  props: Record<string, string[]>;
}

// `scanLinks` / `readAllNotes` wrapper는 `readVaultBundle` 도입 후 호출자 0 → 제거.
// 백엔드도 같은 PR에서 Tauri 명령 제거. 단일 노트 link 추출은 `scanLinkSingle` 유지.

/** 단일 노트의 LinkInfo만 추출 — file watcher 증분 갱신용 */
export function scanLinkSingle(vaultPath: string, path: string): Promise<LinkInfo> {
  return invoke<LinkInfo>("scan_link_single", { vaultPath, path });
}

export interface NoteContent {
  path: string;
  name: string;
  body: string;
}

export interface VaultBundleStats {
  walk_ms: number;
  read_ms: number;
  file_count: number;
}

/**
 * `scan_links` + `read_all_notes`를 한 번에. cold-start 묶음.
 *
 * 이전: Promise.all([scanLinks, readAllNotes])는 같은 파일을 2번 read +
 * 2번 walk + 2번 IPC. 본 함수는 1번 walk + rayon 병렬 read 1번 + 1번 IPC.
 * 한 read에서 LinkInfo + NoteContent 둘 다 추출.
 *
 * `stats`는 측정용 — `LAPIS_PERF=1` Rust stderr 로그와 함께 응답에도 동봉.
 */
export interface VaultBundle {
  links: LinkInfo[];
  contents: NoteContent[];
  stats: VaultBundleStats;
}

export function readVaultBundle(vaultPath: string): Promise<VaultBundle> {
  return invoke<VaultBundle>("read_vault_bundle", { vaultPath });
}

export interface VaultFingerprintResult {
  fingerprint: string;
  file_count: number;
  walk_ms: number;
}

/**
 * vault의 모든 .md (rel_path, mtime_ms, size) 누적 hash. read 없음, stat만.
 * search-cache invalidate 키로 사용 — 같은 fingerprint면 인덱스 재사용 가능.
 */
export function vaultFingerprint(vaultPath: string): Promise<VaultFingerprintResult> {
  return invoke<VaultFingerprintResult>("vault_fingerprint", { vaultPath });
}

/**
 * 주어진 경로들의 mtime(ms)만 stat. 전체 vault를 걷지 않는다.
 * 삭제됐거나 vault 밖인 경로는 **결과에서 조용히 빠진다**(에러 아님).
 */
export function notesMtimes(
  vaultPath: string,
  paths: string[],
): Promise<[string, number][]> {
  return invoke<[string, number][]>("notes_mtimes", { vaultPath, paths });
}

/** 파일 1건의 stat — 기동 델타 재조정의 원자료. `path`는 `LinkInfo.source_path`와 같은 절대 경로. */
export interface FileStat {
  path: string;
  mtime_ms: number;
  size: number;
}

export interface VaultFileStatsResult {
  /** 이 목록과 **같은 walk**에서 계산한 fingerprint. */
  fingerprint: string;
  files: FileStat[];
  walk_ms: number;
}

/**
 * vault 전량의 파일 stat + 같은 walk의 fingerprint.
 *
 * ⚠️ **fingerprint가 어긋났을 때만 부른다.** 19,000건 목록을 매 기동 IPC로 넘기면
 * "안 바뀐 vault"까지 그 비용을 낸다 — hit 경로는 `vaultFingerprint`로 끝난다.
 */
export function vaultFileStats(vaultPath: string): Promise<VaultFileStatsResult> {
  return invoke<VaultFileStatsResult>("vault_file_stats", { vaultPath });
}

/** cold-start cacheLookup — 가벼운 메타만 (minisearch_json 제외). v4부터 shard_count 포함. */
export interface SearchCacheMeta {
  version: number;
  fingerprint: string;
  link_infos: LinkInfo[];
  shard_count: number;
}

/** cold-start 단계 — fingerprint 비교 + link/tag/facet 빌드 즉시 가능. */
export function readSearchCacheMeta(vaultPath: string): Promise<SearchCacheMeta | null> {
  return invoke<SearchCacheMeta | null>("read_search_cache_meta", { vaultPath });
}

/** meta 저장 — cache miss 풀 빌드 후 + cache hit 시 fingerprint 갱신. */
export function writeSearchCacheMeta(
  vaultPath: string,
  fingerprint: string,
  link_infos: LinkInfo[],
  shard_count: number,
): Promise<void> {
  return invoke<void>("write_search_cache_meta", {
    vaultPath,
    fingerprint,
    linkInfos: link_infos,
    shardCount: shard_count,
  });
}

/**
 * 이전 스냅샷의 파일 stat 목록. `expect_fingerprint`(= meta의 것)와 어긋나면 `null`.
 * 없으면(= 이 기능 이전에 저장된 캐시) `null` — 호출자는 예전처럼 풀 빌드로 떨어진다.
 */
export function readSearchCacheStats(
  vaultPath: string,
  expect_fingerprint: string,
): Promise<FileStat[] | null> {
  return invoke<FileStat[] | null>("read_search_cache_stats", {
    vaultPath,
    expectFingerprint: expect_fingerprint,
  });
}

/** stats 저장 — **meta보다 먼저**. meta가 커밋 지점이다. */
export function writeSearchCacheStats(
  vaultPath: string,
  fingerprint: string,
  files: FileStat[],
): Promise<void> {
  return invoke<void>("write_search_cache_stats", { vaultPath, fingerprint, files });
}

/** lazy load — 특정 shard의 MiniSearch JSON 문자열. 1.8s 단위로 progressive load 가능. */
export function readSearchCacheShard(
  vaultPath: string,
  shard_id: number,
  expect_fingerprint: string,
): Promise<string | null> {
  return invoke<string | null>("read_search_cache_shard", {
    vaultPath,
    shardId: shard_id,
    expectFingerprint: expect_fingerprint,
  });
}

/** shard 저장 — worker.toJSONShard 결과 디스크 박제. */
export function writeSearchCacheShard(
  vaultPath: string,
  shard_id: number,
  fingerprint: string,
  minisearch_json: string,
): Promise<void> {
  return invoke<void>("write_search_cache_shard", {
    vaultPath,
    shardId: shard_id,
    fingerprint,
    minisearchJson: minisearch_json,
  });
}

/** 노트와 같은 폴더에서 같은 stem으로 시작하는 이미지(svg/png/jpg/jpeg/gif/webp) — Phase 4.4.b */
export interface AssetInfo {
  name: string;
  abs_path: string;
  kind: string;
}

export function findAssetsForNote(
  vaultPath: string,
  notePath: string,
): Promise<AssetInfo[]> {
  return invoke<AssetInfo[]>("find_assets_for_note", { vaultPath, notePath });
}

/**
 * 링크 자동 갱신 전 affected 노트의 원본을 vault 안의 hidden 디렉토리로 백업.
 * 백업 디렉토리 절대 경로 반환.
 *
 * `backupDirRel`은 vault 상대 경로 — 관례상 `.lapis/link-rewrite-backup/<ISO-ts>`.
 * `.`로 시작하므로 `list_notes`/트리에서 자동 제외.
 */
export function backupNotes(
  vaultPath: string,
  sourcePaths: string[],
  backupDirRel: string,
): Promise<string> {
  return invoke<string>("backup_notes", { vaultPath, sourcePaths, backupDirRel });
}

/**
 * 링크 자동 갱신 백업(`.lapis/link-rewrite-backup/`)에서 최신 `maxKeep`개를
 * 제외한 오래된 것 삭제. 반환: 삭제된 디렉토리 수.
 *
 * 백업 누적 → vault 디스크 부담 방지. backup 직후 또는 vault 열 때 호출.
 */
export function pruneLinkRewriteBackups(
  vaultPath: string,
  maxKeep: number,
): Promise<number> {
  return invoke<number>("prune_link_rewrite_backups", { vaultPath, maxKeep });
}
