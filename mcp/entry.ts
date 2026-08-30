/**
 * 앱 코드에서 **재사용하는 것만** 모아 노출하는 번들 진입점.
 *
 * MCP는 인덱스를 **다시 만들지 않는다** — 앱이 만든 캐시를 읽고, 그 위에서 앱과 **같은
 * 함수**로 파생 구조를 세운다. 여기 열거된 것 외에 앱 코드를 끌어오지 않는다.
 *
 * ⚠️ `$lib` 별칭과 확장자 없는 상대 import 때문에 Node가 이 트리를 직접 못 읽는다.
 * `lapis-mcp` 래퍼가 esbuild로 `--alias:$lib=src/lib`를 걸어 번들한다(16 KB).
 * **번들은 호출 시점에 만든다** — 커밋된 산출물을 두면 소스와 어긋나도 아무 신호가 없다.
 * 캐시 skew(CACHE_VERSION v7)로 이미 겪은 계열의 결함이다.
 */

export { buildIndex } from "$lib/linkIndex";
// ⚠️ 둘 다 예전엔 `stores/` 에서 왔다. 스토어를 안 만지는 순수 함수인데 그 파일에 얹혀
//    있어서, 이 함수 하나 때문에 **Svelte 가 통째로 딸려 왔다.** 순수 모듈로 뗐다.
//    `scripts/arch-gate.mjs` 가 되돌아오는 것을 막는다.
export { buildTagIndex } from "$lib/tagIndex";
export { applyFilters, emptySelection } from "$lib/filterSelection";
export { collectOpenTasks, countOpenTasks } from "$lib/openTasks";
export { koBigramTokenize, normalizeTerm } from "$lib/koTokenize";
export {
  FULLTEXT_OPTIONS,
  unionRank,
  unionRankDetailed,
  type FullTextDoc,
} from "$lib/fullTextOptions";
export type { LinkInfo } from "$lib/tauri/notes";
export type { LinkIndex } from "$lib/linkIndex";
