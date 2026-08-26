import { lapisQuery, resolveNotePath, vaultTimeOf, type QueryArgs } from "../mcp/query.ts";
import { parseSince, partitionSince, sortRecent, sortPath, SinceError } from "$lib/recency";
import { resolveVault, checkStale } from "../mcp/cache.ts";
import { buildIndex } from "../mcp/entry.ts";
import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";
import { findOrphans, findTagIssues, findAmbiguousNames } from "$lib/vaultAudit";
import { computeTagRewritePreview } from "$lib/tagRewrite";
import { backupAndWrite, describeFailure } from "$lib/safeWrite";
import { readFileSync } from "node:fs";
import nodePath from "node:path";
import { makeCliIo } from "./io.ts";
import { runIndex, IndexError } from "./indexRun.ts";
import { launchOpen, LaunchError } from "./appLaunch.ts";

import type { ParsedCommand } from "./args.ts";
import { FACETS, TAG_ACTIONS } from "./spec.ts";
import {
  renderResults,
  renderFacet,
  renderBroken,
  renderTagPreview,
  renderOrphans,
  renderTagIssues,
  renderAmbiguous,
  table,
} from "./render.ts";

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
    // 시간축 — `search` · `backlinks` · `links`가 공유한다(`TIME_OPTS`).
    ...(typeof o.since === "string" ? { since: o.since } : {}),
    ...(typeof o.sort === "string" ? { sort: o.sort as "recent" | "path" | "score" } : {}),
    ...(typeof o.by === "string" ? { by: o.by as "mtime" | "date" } : {}),
  };
}

function vaultOf(p: ParsedCommand): string | undefined {
  return typeof p.options.vault === "string" ? p.options.vault : undefined;
}

/**
 * vault 상대 경로로. **출력 경로는 전부 상대다** — `lapisQuery`가 그렇게 내고,
 * 한 도구가 어떤 명령에서는 절대, 어떤 명령에서는 상대를 내면 스크립트가 갈린다.
 *
 * ⚠️ `$lib` 쪽 순수 함수는 **절대 경로를 낸다.** 앱은 절대 경로로 노트를 열기 때문이다.
 * 자르는 건 표면의 몫이다.
 */
function relativizer(root: string): (abs: string) => string {
  const cut = root.endsWith("/") ? root.length : root.length + 1;
  return (abs) => (abs.startsWith(root) ? abs.slice(cut) : abs);
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
  const broken = p.options.broken === true;
  const orphans = p.options.orphans === true;
  if (!broken && !orphans) {
    out.fail("no_criteria", "무엇을 볼지 지정하지 않았다", "--broken 또는 --orphans", 2);
  }
  const vc = resolveVault(vaultOf(p));
  const index = buildIndex(vc.infos);

  const rel = relativizer(vc.root);
  const since = typeof p.options.since === "string" ? p.options.since : undefined;
  const sort = typeof p.options.sort === "string" ? p.options.sort : undefined;
  const axis = p.options.by === "date" ? "date" : "mtime";

  // ⚠️ 시간 옵션은 고아 목록에만 뜻이 있다. 조용히 무시하면 도움말에 보이는 옵션이
  // 아무 일도 안 하고, 사용자는 먹은 줄 안다 — 실측에서 그렇게 나왔다.
  if (!orphans && (since !== undefined || sort !== undefined || p.options.by !== undefined)) {
    out.fail(
      "no_criteria",
      "시간 옵션은 --orphans 에만 쓸 수 있다",
      "끊긴 링크는 노트가 아니라 링크 대상별로 묶여 시간축이 없다",
      2,
    );
  }

  if (orphans) {
    // 시간축은 `lapisQuery`와 **같은 공급자**를 쓴다. 여기서 따로 짜면 축의 뜻이 갈린다.
    const needTime = since !== undefined || sort === "recent";
    const timeOf = needTime ? vaultTimeOf(vaultOf(p), axis) : () => null;

    let rows = findOrphans(index);
    let droppedNoTime = 0;
    let droppedOlder = 0;
    if (since !== undefined) {
      let cutoff: number;
      try {
        cutoff = parseSince(since, Date.now());
      } catch (e) {
        if (e instanceof SinceError) {
          out.fail("no_criteria", e.message, "7d · 24h · 2w · YYYY-MM-DD", 2);
        }
        throw e;
      }
      const part = partitionSince(rows, cutoff, timeOf);
      rows = part.kept;
      droppedNoTime = part.droppedNoTime;
      droppedOlder = part.droppedOlder;
    }
    if (sort === "recent") rows = sortRecent(rows, timeOf);
    else if (sort === "path") rows = sortPath(rows);

    const shown = rows.map((o) => ({ ...o, path: rel(o.path) }));
    if (out.json) {
      return out.json_({
        vault: vc.root,
        orphans: shown.length,
        notes: shown,
        ...(since !== undefined
          ? { since: { axis, dropped_older: droppedOlder, dropped_no_time: droppedNoTime } }
          : {}),
      });
    }
    out.line(renderOrphans(shown));
    if (shown.length > 0) {
      out.line(`\n${shown.length}개`);
      // ⚠️ 진입점은 정상적으로 여기 걸린다. 그걸 안 말해주면 목록을 안 믿게 된다.
      out.line("나가는 링크가 많은 것은 진입점(허브)일 수 있다 — 그건 정상이다.");
    }
    // ⚠️ 자른 건수를 **말한다.** 조용히 줄이면 왜 안 나오는지 알 방법이 없다.
    if (droppedOlder > 0 || droppedNoTime > 0) {
      out.line(
        `(${axis} 기준으로 ${droppedOlder}건이 기간 밖, ${droppedNoTime}건은 시간 값이 없어 제외)`,
      );
    }
    return;
  }

  const groups = findBrokenLinks(index).map((g) => ({
    ...g,
    sources: g.sources.map((src) => ({ ...src, path: rel(src.path) })),
  }));
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

  if (action === "audit") return cmdTagAudit(p, out);

  // ⚠️ 위치 인자 요구가 동작마다 다르므로 spec이 아니라 여기서 본다. 파서는 어떤
  // 동작인지 모른다.
  if (!oldTag || !newTag) {
    out.fail(
      "no_criteria",
      "rename에는 이전·새이름이 필요하다",
      "lapis tag rename <이전> <새이름>",
      2,
    );
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
 * 태그 위생 — **후보만 낸다.** 실행은 옆에 있는 `tag rename`이 맡는다.
 *
 * 모호한 이름도 여기서 함께 보고한다. 태그는 아니지만 같은 부류의 위생 문제이고,
 * 사람이 `lapis open`에서 그 이름으로 거부당하기 전에 알아야 한다.
 */
function cmdTagAudit(p: ParsedCommand, out: Out): void {
  const vc = resolveVault(vaultOf(p));
  const issues = findTagIssues(vc.infos);
  const rel = relativizer(vc.root);
  const ambiguous = findAmbiguousNames(buildIndex(vc.infos)).map((a) => ({
    ...a,
    paths: a.paths.map(rel),
  }));

  if (out.json) {
    return out.json_({ vault: vc.root, tag_issues: issues, ambiguous_names: ambiguous });
  }
  out.line(renderTagIssues(issues));
  out.line("");
  out.line(renderAmbiguous(ambiguous));
  if (issues.length > 0) {
    out.line("");
    out.line("`lapis tag rename <이전> <새이름>` 으로 합칠 수 있다 (기본은 미리보기).");
  }
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
 * 실행 중인 앱에서 노트를 연다. 앱이 꺼져 있으면 켠다.
 *
 * ⚠️ 노트 해소는 `resolveNotePath` — `backlinks`가 쓰는 **같은 함수**다. CLI가 자기
 * 규칙을 따로 두면 `lapis backlinks X`가 찾는 노트와 `lapis open X`가 여는 노트가
 * 달라진다. 그건 오류 없이 틀리는 부류다.
 *
 * ⚠️ **결과를 확인할 방법이 없다.** 떼어내 보내고 즉시 돌아오므로(`appLaunch.ts`), 앱이
 * 실제로 열었는지는 여기서 모른다. 그래서 "열었다"가 아니라 "보냈다"라고 말한다.
 */
function cmdOpen(p: ParsedCommand, out: Out): void {
  const target = p.positional[0];
  const resolved = resolveNotePath(target, vaultOf(p));
  try {
    const { exe } = launchOpen({ path: resolved.path, vault: resolved.vault });
    if (out.json) return out.json_({ ...resolved, sent: true, app: exe });
    out.line(`${resolved.path} 을(를) 앱에 보냈다`);
  } catch (e) {
    if (e instanceof LaunchError) {
      out.fail("app_not_found", e.message, e.remedy, 1);
    }
    throw e;
  }
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
  open: cmdOpen,
};
