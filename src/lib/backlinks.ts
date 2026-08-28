import { readNote, type LinkInfo } from "$lib/tauri/notes";
import { extractSnippetAround } from "$lib/snippet";
import { logWarn } from "$lib/stores/usage";

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
 * 메모리 캐시 — 같은 (source, target) 쌍은 한 번만 fetch.
 * key 형식: `${sourcePath}::${targetPath}`.
 *
 * ⚠️ **target 은 stem 이 아니라 경로여야 한다.** 발췌를 만드는 항목이 target 의
 * stem · title · aliases 셋이라 stem 만으로는 target 을 구별 못 한다. 이름이 같은 노트가
 * 둘이면(이 vault 는 7쌍) 두 target 이 **같은 키**를 쓰고, 먼저 계산된 쪽이 이겨
 * 두 번째 노트가 **남의 발췌**를 받는다. 에러는 없다.
 *
 * 무효화 경로 (모두 연결됨):
 * - 외부 변경: watcher `onPathChanged`/`onPathRemoved` → `invalidateCacheBySource(path)`
 * - 앱 내 편집: `saveCurrentNote` → `reloadNotes` → `clearBacklinkCache()`
 * - 앱 내 rename/delete/move: 각 함수가 `refreshTreeOnly` 직후 `clearBacklinkCache()` 호출
 *   (watcher 디바운스/활성 여부와 무관하게 즉시 무효화)
 */
const snippetCache = new Map<string, BacklinkContext>();

function cacheKey(sourcePath: string, targetPath: string): string {
  return `${sourcePath}::${targetPath}`;
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
  const key = cacheKey(source.source_path, targetNote.source_path);
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
    logWarn("backlinks", `fetchBacklinkContext: readNote failed for ${source.source_path}`, e);
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

/** target 이 rename 되면 그 경로를 키로 쓴 항목이 남는다 — 전체 클리어가 안전. */
export function clearBacklinkCache(): void {
  snippetCache.clear();
}
