import { lapisQuery, type QueryArgs } from "../mcp/query.ts";
import { resolveVault, checkStale } from "../mcp/cache.ts";
import { buildIndex } from "../mcp/entry.ts";
import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";

import type { ParsedCommand } from "./args.ts";
import { FACETS } from "./spec.ts";
import { renderResults, renderFacet, renderBroken, table } from "./render.ts";

/**
 * 명령 핸들러 — 질의 핵을 부르고 렌더 결과를 `Out`으로 넘긴다.
 *
 * ⚠️ **`main.ts`와 분리한 이유는 테스트다.** `main.ts`는 모듈 최상위에서 `main(argv)`를
 * 부르므로 import 하는 순간 실행된다. 그러면 "spec의 모든 명령에 핸들러가 있나"를
 * 검사할 수 없다 — 그 가드가 없으면 명령을 추가하고 핸들러를 빼먹어도 **도움말에는
 * 보이는데 부르면 아무 일도 안 일어나는** 상태가 된다.
 *
 * 출력은 `Out`을 통해서만 한다. `process.stdout`을 직접 만지지 않아 호출부가 갈아끼울 수 있다.
 */

export interface Out {
  json: boolean;
  line(text: string): void;
  json_(value: unknown): void;
  fail(kind: string, message: string, remedy: string | undefined, code: number): never;
}

/** 공통 옵션을 `QueryArgs`로. 명령별 핸들러가 자기 것만 얹는다. */
function baseArgs(p: ParsedCommand): QueryArgs {
  const o = p.options;
  return {
    ...(typeof o.vault === "string" ? { vault: o.vault } : {}),
    ...(typeof o.limit === "number" ? { limit: o.limit } : {}),
    ...(o["include-archive"] === true ? { include_archive: true } : {}),
  };
}

function vaultOf(p: ParsedCommand): string | undefined {
  return typeof p.options.vault === "string" ? p.options.vault : undefined;
}

export function cmdSearch(p: ParsedCommand, out: Out): void {
  const o = p.options;
  const res = lapisQuery({
    ...baseArgs(p),
    ...(p.positional[0] ? { text: p.positional[0] } : {}),
    ...(typeof o.tag === "string" ? { tag: o.tag } : {}),
    ...(typeof o["doc-kind"] === "string" ? { doc_kind: o["doc-kind"] } : {}),
    ...(typeof o.topic === "string" ? { topic: o.topic } : {}),
    ...(typeof o["min-rel"] === "number" ? { min_rel: o["min-rel"] } : {}),
    ...(Array.isArray(o.exclude) ? { exclude: o.exclude } : {}),
  });
  if (out.json) return out.json_(res);
  if (res.list !== undefined) return out.line(renderFacet(res.values));

  out.line(renderResults(res.results));
  // ⚠️ 자른 게 있으면 **말한다.** 조용히 자르면 "이게 전부"로 읽힌다.
  if (res.truncated) out.line("\n(상한에 걸려 잘림 — --limit 으로 늘릴 수 있다)");
  // 낡았다고 막지 않는다. 보고만 한다 — `mcp/README.md`와 같은 태도다.
  if (res.stale) out.line("(캐시가 vault보다 낡았다 — 'lapis status' 참조)");
}

export function cmdBacklinks(p: ParsedCommand, out: Out): void {
  const res = lapisQuery({ ...baseArgs(p), backlinks_of: p.positional[0] });
  if (out.json) return out.json_(res);
  if (res.list !== undefined) return out.line(renderFacet(res.values));
  out.line(renderResults(res.results));
  if (res.truncated) out.line("\n(상한에 걸려 잘림)");
}

export function cmdList(p: ParsedCommand, out: Out): void {
  const facet = p.positional[0];
  if (!(FACETS as readonly string[]).includes(facet)) {
    out.fail("no_criteria", `모르는 facet: ${facet}`, `쓸 수 있는 값: ${FACETS.join(" · ")}`, 2);
  }
  // CLI는 `doc-kinds`(하이픈), 질의 핵은 `doc_kinds`(밑줄). 표면이 갈리는 건 의도다 —
  // 다른 옵션이 전부 하이픈인데 여기만 밑줄이면 손이 틀린다.
  const kind = facet === "doc-kinds" ? "doc_kinds" : facet;
  const res = lapisQuery({ ...baseArgs(p), list: kind as "topics" | "tags" | "doc_kinds" });
  if (out.json) return out.json_(res);
  if (res.list === undefined) return out.line(renderResults(res.results));
  out.line(renderFacet(res.values));
  if (res.truncated) out.line(`\n(${res.total_distinct}개 중 ${res.returned}개만 표시 — --limit)`);
}

export function cmdLinks(p: ParsedCommand, out: Out): void {
  if (p.options.broken !== true) {
    out.fail("no_criteria", "무엇을 볼지 지정하지 않았다", "지금은 --broken 하나뿐이다", 2);
  }
  const vc = resolveVault(vaultOf(p));
  const groups = findBrokenLinks(buildIndex(vc.infos));
  if (out.json) {
    return out.json_({
      vault: vc.root,
      targets: groups.length,
      links: countBrokenLinks(groups),
      groups,
    });
  }
  out.line(renderBroken(groups));
  if (groups.length > 0) {
    out.line(`\n대상 ${groups.length}개 · 링크 ${countBrokenLinks(groups)}개`);
  }
}

export function cmdStatus(p: ParsedCommand, out: Out): void {
  const vc = resolveVault(vaultOf(p));
  const stale = checkStale(vc);
  if (out.json) {
    return out.json_({
      vault: vc.root,
      cache: vc.dir,
      fingerprint: vc.fingerprint,
      shards: vc.shardCount,
      notes: vc.infos.length,
      stale,
    });
  }
  out.line(
    table([
      ["vault", vc.root],
      ["캐시", vc.dir],
      ["fingerprint", vc.fingerprint],
      ["shard", String(vc.shardCount)],
      ["노트", String(vc.infos.length)],
      [
        "상태",
        stale.changed
          ? `낡음 (노트 ${stale.total}개 중 ${stale.newer_count}개가 캐시보다 새롭다)`
          : "최신",
      ],
    ]),
  );
}

/**
 * 명령 이름 → 핸들러.
 *
 * ⚠️ `spec.ts`의 `COMMANDS`와 **키가 정확히 같아야 한다.** 한쪽에만 있으면 도움말에는
 * 보이는데 부르면 아무 일도 안 일어나거나, 그 반대가 된다. 테스트가 이걸 고정한다.
 */
export const HANDLERS: Record<string, (p: ParsedCommand, out: Out) => void> = {
  search: cmdSearch,
  backlinks: cmdBacklinks,
  list: cmdList,
  links: cmdLinks,
  status: cmdStatus,
};
