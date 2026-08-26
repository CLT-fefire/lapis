import { lapisQuery, type QueryArgs } from "../mcp/query.ts";
import { resolveVault, checkStale } from "../mcp/cache.ts";
import { buildIndex } from "../mcp/entry.ts";
import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";
import { computeTagRewritePreview } from "$lib/tagRewrite";
import { backupAndWrite, describeFailure } from "$lib/safeWrite";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { makeCliIo } from "./io.ts";
import { runIndex, IndexError } from "./indexRun.ts";

import type { ParsedCommand } from "./args.ts";
import { FACETS, TAG_ACTIONS } from "./spec.ts";
import { renderResults, renderFacet, renderBroken, renderTagPreview, table } from "./render.ts";

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
 * 태그 이름 바꾸기.
 *
 * ⚠️ **기본은 dry-run이다.** `--apply` 없이는 아무것도 쓰지 않는다. 되돌릴 수 없는
 * 쓰기를 인자 하나 빠뜨렸다고 실행하면 안 된다 — 앱도 미리보기 → 확인 순서를 강제한다.
 *
 * 쓰기는 `$lib/safeWrite`를 탄다. **앱과 같은 트랜잭션**이다(백업 → 순차 쓰기 → 실패 시
 * 롤백). 규칙이 갈리면 고침이 한쪽에만 들어간다.
 */
export async function cmdTag(p: ParsedCommand, out: Out): Promise<void> {
  const [action, oldTag, newTag] = p.positional;
  if (!(TAG_ACTIONS as readonly string[]).includes(action)) {
    out.fail("no_criteria", `모르는 동작: ${action}`, `쓸 수 있는 값: ${TAG_ACTIONS.join(" · ")}`, 2);
  }
  if (oldTag === newTag) {
    out.fail("no_criteria", "이전 이름과 새 이름이 같다", "바꿀 이름을 다르게 주어라", 2);
  }

  const vc = resolveVault(vaultOf(p));

  // 미리보기 계산은 모든 노트를 읽는다. 앱과 같은 이유로 명시적 단계다.
  const notes = new Map<string, string>();
  for (const info of vc.infos) {
    try {
      notes.set(info.source_path, readFileSync(info.source_path, "utf8"));
    } catch {
      // 한 파일을 못 읽었다고 전체를 세우지 않는다. 그 노트만 대상에서 빠진다.
    }
  }
  const known = new Set<string>();
  for (const i of vc.infos) for (const t of i.tags ?? []) known.add(t);

  const preview = computeTagRewritePreview(notes, oldTag, newTag, known);
  const apply = p.options.apply === true;

  if (!apply) {
    if (out.json) {
      return out.json_({ vault: vc.root, dry_run: true, ...preview });
    }
    out.line(
      renderTagPreview(
        oldTag,
        newTag,
        preview.items.map((i) => ({ path: i.path, occurrences: i.occurrences })),
        preview.totalOccurrences,
        preview.merge,
      ),
    );
    if (preview.items.length > 0) out.line("\n미리보기다 — 실제로 쓰려면 --apply");
    return;
  }

  if (preview.items.length === 0) {
    // 쓸 게 없는데 성공이라고 하면 "바뀐 줄 알았다"가 된다.
    out.fail("path_not_indexed", `${oldTag} 을(를) 쓰는 노트가 없다`, "`lapis list tags`로 확인하라", 1);
  }

  const io = makeCliIo({ settingsFile: nodePath.join(nodePath.dirname(vc.dir), "lapis-settings.json") });
  const outcome = await backupAndWrite(vc.root, preview.items, io);
  if (!outcome.ok) {
    out.fail("corrupt", describeFailure(outcome) ?? "쓰기 실패", `백업에서 회수할 수 있다`, 1);
  }

  if (out.json) {
    return out.json_({ vault: vc.root, applied: true, written: outcome.ok ? outcome.written : [] });
  }
  out.line(`${oldTag} → ${newTag}: 노트 ${preview.items.length}개 갱신`);
  // ⚠️ 앱이 인덱스 생산자다. CLI가 쓴 것은 앱이 다시 읽어야 검색에 반영된다.
  out.line("앱이 떠 있으면 watcher가 반영한다. 아니면 다음에 vault를 열 때 재색인된다.");
}

/**
 * 앱 없이 인덱스를 다시 만든다.
 *
 * 다른 명령과 성격이 다르다 — 저 위의 것들은 **이미 있는 캐시를 읽고**, 이건 캐시를
 * **만든다.** 그래서 유일하게 설치된 앱 실행파일을 부른다(`indexRun.ts`).
 *
 * ⚠️ 진행 상황을 stderr로 낸다. 큰 vault에서 1분 넘게 조용하면 멈춘 것처럼 보이는데,
 * stdout에 섞으면 `--json` 출력이 오염된다.
 */
function cmdIndex(p: ParsedCommand, out: Out): void {
  const vault = vaultOf(p) ?? resolveVault().root;
  const dryRun = p.options["dry-run"] === true;

  let result;
  try {
    result = runIndex({
      vault,
      dryRun,
      onProgress: out.json ? undefined : (m) => process.stderr.write(`  ${m}\n`),
    });
  } catch (e) {
    if (e instanceof IndexError) {
      out.fail("index_failed", e.message, e.remedy, 1);
    }
    throw e;
  }

  if (out.json) return out.json_(result);

  out.line(
    table([
      ["vault", result.vaultRoot],
      ["노트", String(result.noteCount)],
      ["shard", `${result.shardCount}개 [${result.perShard.join(", ")}]`],
      ["fingerprint", result.fingerprint],
      ["캐시", `${result.cacheDir}/${result.cacheKey}.* (v${result.cacheVersion})`],
      [
        "소요",
        `스캔 ${result.exportMs}ms · 빌드 ${result.buildMs}ms` +
          (result.committed ? ` · 커밋 ${result.commitMs}ms` : ""),
      ],
    ]),
  );
  out.line("");
  out.line(
    result.committed
      ? "커밋했다. 앱을 켜면 이 인덱스를 그대로 읽는다(재색인 없음)."
      : "만들기만 했다 — 캐시는 그대로다.",
  );
}

/**
 * 명령 이름 → 핸들러.
 *
 * ⚠️ `spec.ts`의 `COMMANDS`와 **키가 정확히 같아야 한다.** 한쪽에만 있으면 도움말에는
 * 보이는데 부르면 아무 일도 안 일어나거나, 그 반대가 된다. 테스트가 이걸 고정한다.
 */
export const HANDLERS: Record<string, (p: ParsedCommand, out: Out) => void | Promise<void>> = {
  search: cmdSearch,
  backlinks: cmdBacklinks,
  list: cmdList,
  links: cmdLinks,
  tag: cmdTag,
  status: cmdStatus,
  index: cmdIndex,
};
