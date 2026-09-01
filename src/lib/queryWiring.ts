import { get } from "svelte/store";
import { m } from "$lib/paraglide/messages.js";
import { linkIndex, vaultPath } from "$lib/stores/vault";
import type { QueryContext } from "$lib/queryRuntime";

/**
 * 저장된 질의를 **스토어와 문구에 붙이는 한 곳.**
 *
 * ⚠️ `queryRuntime` 은 순수하게 둔다 — 스토어도 i18n 도 import 하지 않는다. 그래야
 * 메시지 묶음 없이 테스트가 돌고, 본문 칸과 옆칸이 **같은 배선**을 쓴다.
 * 두 칸이 각자 배선하면 언젠가 한쪽만 고쳐진다.
 */

/** 인덱스가 아직 없으면 `null` — 그때는 화면이 "아직 인덱스가 없다"고 말한다. */
export function queryContext(): QueryContext | null {
  const idx = get(linkIndex);
  const root = get(vaultPath);
  if (!idx || !root) return null;
  return { infos: [...idx.byPath.values()], vaultRoot: root };
}

/** 런타임에 넘길 문구. */
export function queryText(): {
  badQuery: string;
  noIndex: string;
  empty: string;
  count: (n: number) => string;
} {
  return {
    badQuery: m.query_bad(),
    noIndex: m.query_no_index(),
    empty: m.query_empty(),
    count: (n: number) => m.query_count({ n: String(n) }),
  };
}
