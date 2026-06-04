import { readNote, type LinkInfo } from "$lib/tauri/notes";
import { extractSnippetAround } from "$lib/snippet";

/**
 * 백링크 칩을 펼쳤을 때 보여줄 컨텍스트.
 * - source: 인용한 노트
 * - snippet: ±60자 발췌. matched=false면 빈 문자열
 * - matched: 본문에 stem/title/alias 중 하나라도 매칭됐는지
 */
export interface BacklinkContext {
  source: LinkInfo;
  snippet: string;
  matched: boolean;
}

/**
 * 메모리 캐시 — 같은 (source, target stem) 쌍은 한 번만 fetch.
 * key 형식: `${sourcePath}::${targetStem}` (source 본문 발췌라 source 변경에만 의존).
 *
 * 무효화 경로 (모두 연결됨):
 * - 외부 변경: watcher `onPathChanged`/`onPathRemoved` → `invalidateCacheBySource(path)`
 * - 앱 내 편집: `saveCurrentNote` → `reloadNotes` → `clearBacklinkCache()`
 * - 앱 내 rename/delete/move: 각 함수가 `refreshTreeOnly` 직후 `clearBacklinkCache()` 호출
 *   (watcher 디바운스/활성 여부와 무관하게 즉시 무효화)
 */
const snippetCache = new Map<string, BacklinkContext>();

function cacheKey(sourcePath: string, targetStem: string): string {
  return `${sourcePath}::${targetStem}`;
}

/**
 * source 노트의 본문에서 target 노트를 인용한 첫 위치 발췌.
 * targetNote의 source_name(stem), title, aliases 모두 매칭 후보.
 */
export async function fetchBacklinkContext(
  source: LinkInfo,
  targetNote: LinkInfo,
  radius = 60,
): Promise<BacklinkContext> {
  const key = cacheKey(source.source_path, targetNote.source_name);
  const cached = snippetCache.get(key);
  if (cached) return cached;

  const terms: string[] = [];
  if (targetNote.source_name) terms.push(targetNote.source_name);
  if (targetNote.title) terms.push(targetNote.title);
  for (const a of targetNote.aliases) {
    if (a) terms.push(a);
  }

  let body: string;
  try {
    body = await readNote(source.source_path);
  } catch (e) {
    console.warn(`fetchBacklinkContext: readNote failed for ${source.source_path}`, e);
    body = "";
  }

  const { snippet, matched } = extractSnippetAround(body, terms, radius);
  const result: BacklinkContext = { source, snippet, matched };
  snippetCache.set(key, result);
  return result;
}

/** 특정 노트가 외부에서 변경되거나 rename되면 호출 — 그 노트가 source인 캐시 항목을 모두 제거. */
export function invalidateCacheBySource(sourcePath: string): void {
  const prefix = `${sourcePath}::`;
  for (const k of [...snippetCache.keys()]) {
    if (k.startsWith(prefix)) snippetCache.delete(k);
  }
}

/** target 노트가 rename되거나 변경되면 캐시 키의 target stem 부분이 달라짐 — 전체 클리어가 안전. */
export function clearBacklinkCache(): void {
  snippetCache.clear();
}
