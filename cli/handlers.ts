import { collectOpenTasks, countOpenTasks } from "$lib/openTasks";
import {
  lapisQuery,
  isAudit,
  resolveNotePath,
  vaultTimeOf,
  type QueryArgs,
} from "../mcp/query.ts";
import { parseSince, partitionSince, sortRecent, sortPath, SinceError } from "$lib/recency";
import { spawnSync } from "node:child_process";
import {
  resolveVault,
  readSettings,
  writeSetting,
  checkStale,
  type VaultCache,
  type Staleness,
  disableCustomCss,
  settingsFileCandidates,
  LapisError,
} from "../mcp/cache.ts";
import { buildIndex } from "../mcp/entry.ts";
import { findBrokenLinks, countBrokenLinks } from "$lib/brokenLinks";
import {
  findOrphans,
  findTagIssues,
  findAmbiguousNames,
  findUnlinkedMentions,
  findFrontmatterIssues,
} from "$lib/vaultAudit";
import { computeTagRewritePreview } from "$lib/tagRewrite";
import { computeReplacePreview, ReplacePatternError } from "$lib/replacePlan";
import { backupAndWrite, describeFailure } from "$lib/safeWrite";
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { UsageAnalyzer } from "$lib/usageAnalyzer";
import { applyTemplate, defaultBody, TEMPLATE_DIR } from "$lib/noteTemplate";
import { usageDirs } from "../mcp/cache.ts";
import nodePath from "node:path";
import { makeCliIo } from "./io.ts";
import { runIndex, IndexError } from "./indexRun.ts";
import { runExport, ExportError } from "./exportRun.ts";
import { launchOpen, LaunchError } from "./appLaunch.ts";

import type { ParsedCommand } from "./args.ts";
import { FACETS, TAG_ACTIONS, PROPS_ACTIONS, COMMANDS } from "./spec.ts";
import {
  renderResults,
  renderFacet,
  renderBroken,
  renderTagPreview,
  renderReplacePreview,
  renderOrphans,
  renderTagIssues,
  renderAmbiguous,
  renderUnlinked,
  renderFrontmatterIssues,
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

/**
 * 인덱스가 vault보다 낡았을 때 내는 한 줄.
 *
 * ## ⚠️ 왜 질의 명령 **전부**에 붙나
 *
 * 예전에는 `cmdSearch` **하나에만** 있었다. 그래서 `links --orphans`나 `tag audit`이 낡은
 * 인덱스로 **자신 있게 틀린 숫자**를 냈다 — 실제로 그것 때문에 "vault가 깨끗하다"는 잘못된
 * 결론이 나온 적이 있다. 인덱싱 후 다시 돌리니 답이 달랐다.
 *
 * 답이 바뀐 게 아니라 **처음 답이 틀렸던 것**이고, 그걸 알려주는 신호가 없었다.
 *
 * 막지 않는 이유는 기존 계약 그대로다 — 살아 있는 vault는 몇 초 사이에도 낡으므로,
 * 읽기를 하드 실패시키면 도구를 못 쓴다.
 */
const STALE_LINE = "(캐시가 vault보다 낡았다 — 'lapis index' 로 갱신)";

/** 질의 핵을 안 거치는 명령(감사·치환)용. 낡았으면 한 줄 낸다. */
function reportStale(out: Out, vc: VaultCache): void {
  if (checkStale(vc).changed) out.line(STALE_LINE);
}

/** `--json` 출력에 실을 낡음 정보. 낡지 않았으면 아무 키도 안 넣는다. */
function staleField(vc: VaultCache): { stale?: Staleness } {
  const st = checkStale(vc);
  return st.changed ? { stale: st } : {};
}

/**
 * 쓰기 전에 인덱스가 신선한지 확인한다. 낡았으면 **거절**한다.
 *
 * ## ⚠️ 읽기와 다르게 대하는 이유
 *
 * `replace`와 `tag rename`은 **인덱스의 노트 목록**을 훑는다(`vc.infos`). 내용은 디스크에서
 * 새로 읽지만 **목록이 낡았으면 마지막 인덱싱 뒤에 만든 노트가 조용히 빠진다.**
 * 그런데 보고는 `노트 12개 · 34건`이라고 한다 — 무엇이 빠졌는지는 어디에도 안 나온다.
 *
 * 읽기가 조금 낡으면 다시 읽으면 된다. 쓰기가 조금 낡으면 **일부만 바뀐 vault가 남고**
 * 무엇이 빠졌는지는 아무도 모른다. 값이 다르므로 기본값도 달라야 한다.
 *
 * `--allow-stale`로 길은 남긴다 — 자동화에서 인덱싱을 이미 보장했을 수 있다.
 * **막되 막다른 길로 만들지는 않는다.**
 */
function requireFreshIndex(out: Out, vc: VaultCache, p: ParsedCommand): void {
  if (p.options["allow-stale"] === true) return;
  const st = checkStale(vc);
  if (!st.changed) return;
  out.fail(
    "stale_index",
    `인덱스가 vault보다 낡았다 (노트 ${st.total}개 중 ${st.newer_count}개가 새롭다)`,
    "먼저 `lapis index` 를 돌려라 — 지금 쓰면 새 노트가 조용히 빠진다. 알면서 진행하려면 --allow-stale",
    2,
  );
}

/**
 * vault의 모든 노트 본문. **캐시 목록 기준**이라 낡았으면 그만큼 덜 읽는다(그건 낡음 보고가 말한다).
 *
 * ⚠️ 감사 중 `--unlinked` 하나만 본문이 필요하다. 나머지는 인덱스만으로 되므로 이 함수를
 * 부르는 곳을 늘리기 전에 정말 본문이 필요한지 먼저 본다 — 큰 vault에서 비용을 지배한다.
 */
function readBodies(vc: VaultCache): Map<string, string> {
  const bodies = new Map<string, string>();
  for (const info of vc.infos) {
    try {
      bodies.set(info.source_path, readFileSync(info.source_path, "utf8"));
    } catch {
      // 캐시에는 있는데 디스크에서 사라진 노트. 그 노트만 빠진다.
    }
  }
  return bodies;
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

/**
 * `--props status=완료 --props status=반영됨` → `{ status: ["완료", "반영됨"] }`.
 *
 * ⚠️ 값에 `=` 가 들어갈 수 있다(`date=2026-08-28`은 아니지만 자유 텍스트 축은 그럴 수 있다).
 * **첫 `=` 에서만** 가른다.
 * ⚠️ `=` 가 없는 인자는 **조용히 버리지 않는다** — 무시하면 사용자는 필터가 먹은 줄 안다.
 */
export function parseProps(pairs: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const raw of pairs) {
    const at = raw.indexOf("=");
    if (at <= 0) {
      throw new Error(`--props 는 필드=값 꼴이어야 한다: ${raw}`);
    }
    const field = raw.slice(0, at).trim();
    const value = raw.slice(at + 1).trim();
    if (!field || !value) throw new Error(`--props 는 필드=값 꼴이어야 한다: ${raw}`);
    (out[field] ??= []).push(value);
  }
  return out;
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
    ...(Array.isArray(o.props) ? { props: parseProps(o.props) } : {}),
    ...(Array.isArray(o.under) ? { under: o.under } : {}),
    ...(Array.isArray(o.exclude) ? { exclude: o.exclude } : {}),
  });
  if (out.json) return out.json_(res);
  // ⚠️ CLI 는 `audit` 을 안 준다. 그래도 좁힌다 — 유니온이 자랐고, "지금은 안 준다"는
  //    타입이 아니라 관습이다. 관습은 다음 사람이 깬다.
  if (isAudit(res)) return out.fail("internal", "감사 응답이 왔다", "저장소 버그다", 1);
  if (res.list !== undefined) return out.line(renderFacet(res.values));

  out.line(renderResults(res.results));
  // ⚠️ 자른 게 있으면 **말한다.** 조용히 자르면 "이게 전부"로 읽힌다.
  if (res.truncated) out.line("\n(상한에 걸려 잘림 — --limit 으로 늘릴 수 있다)");
  // 낡았다고 막지 않는다. 보고만 한다 — `mcp/README.md`와 같은 태도다.
  if (res.stale) out.line(STALE_LINE);
}

export function cmdBacklinks(p: ParsedCommand, out: Out): void {
  const res = lapisQuery({ ...baseArgs(p), backlinks_of: p.positional[0] });
  if (out.json) return out.json_(res);
  // ⚠️ CLI 는 `audit` 을 안 준다. 그래도 좁힌다 — 유니온이 자랐고, "지금은 안 준다"는
  //    타입이 아니라 관습이다. 관습은 다음 사람이 깬다.
  if (isAudit(res)) return out.fail("internal", "감사 응답이 왔다", "저장소 버그다", 1);
  if (res.list !== undefined) return out.line(renderFacet(res.values));
  out.line(renderResults(res.results));
  if (res.truncated) out.line("\n(상한에 걸려 잘림)");
  if (res.stale) out.line(STALE_LINE);
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
  // ⚠️ CLI 는 `audit` 을 안 준다. 그래도 좁힌다 — 유니온이 자랐고, "지금은 안 준다"는
  //    타입이 아니라 관습이다. 관습은 다음 사람이 깬다.
  if (isAudit(res)) return out.fail("internal", "감사 응답이 왔다", "저장소 버그다", 1);
  if (res.list === undefined) return out.line(renderResults(res.results));
  out.line(renderFacet(res.values));
  if (res.truncated) out.line(`\n(${res.total_distinct}개 중 ${res.returned}개만 표시 — --limit)`);
  if (res.stale) out.line(STALE_LINE);
}

export function cmdLinks(p: ParsedCommand, out: Out): void {
  const broken = p.options.broken === true;
  const orphans = p.options.orphans === true;
  const unlinked = p.options.unlinked === true;
  if (!broken && !orphans && !unlinked) {
    out.fail(
      "no_criteria",
      "무엇을 볼지 지정하지 않았다",
      "--broken · --orphans · --unlinked 중 하나",
      2,
    );
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

  if (unlinked) {
    // ⚠️ 본문을 전부 읽는다. 다른 감사 셋은 인덱스만으로 되지만 이건 본문이 있어야 한다 —
    //    그래서 `--unlinked`가 눈에 띄게 느리고, 도움말에도 그렇게 적어 뒀다.
    const rows = findUnlinkedMentions(index, readBodies(vc)).map((r) => ({
      ...r,
      target: rel(r.target),
      sources: r.sources.map((x) => ({ ...x, path: rel(x.path) })),
    }));
    if (out.json) {
      return out.json_({
        vault: vc.root,
        ...staleField(vc),
        names: rows.length,
        mentions: rows.reduce((n, r) => n + r.total, 0),
        rows,
      });
    }
    out.line(renderUnlinked(rows));
    if (rows.length > 0) {
      out.line(`\n이름 ${rows.length}개 · 언급 ${rows.reduce((n, r) => n + r.total, 0)}곳`);
      // ⚠️ 고치라고 하지 않는다 — 감사 셋과 같은 태도다.
      out.line("모호한 이름과 코드·frontmatter는 제외했다. 링크로 바꾸는 것은 손으로 한다.");
    }
    reportStale(out, vc);
    return;
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
        ...staleField(vc),
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
    reportStale(out, vc);
    return;
  }

  const groups = findBrokenLinks(index).map((g) => ({
    ...g,
    sources: g.sources.map((src) => ({ ...src, path: rel(src.path) })),
  }));
  if (out.json) {
    return out.json_({
      vault: vc.root,
      ...staleField(vc),
      targets: groups.length,
      links: countBrokenLinks(groups),
      groups,
    });
  }
  out.line(renderBroken(groups));
  if (groups.length > 0) {
    out.line(`\n대상 ${groups.length}개 · 링크 ${countBrokenLinks(groups)}개`);
  }
  reportStale(out, vc);
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
  // ⚠️ 쓰기 직전에만 막는다. 미리보기는 낡아도 보여준다 — 무엇이 걸리는지 보는 게 목적이고,
  //    거기서 막으면 "먼저 인덱싱하라"는 말을 보려고 인덱싱을 해야 한다.
  if (apply) requireFreshIndex(out, vc, p);

  if (!apply) {
    if (out.json) {
      return out.json_({ vault: vc.root, dry_run: true, ...staleField(vc), ...preview });
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
    reportStale(out, vc);
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
    return out.json_({
      vault: vc.root,
      ...staleField(vc),
      tag_issues: issues,
      ambiguous_names: ambiguous,
    });
  }
  out.line(renderTagIssues(issues));
  out.line("");
  out.line(renderAmbiguous(ambiguous));
  if (issues.length > 0) {
    out.line("");
    out.line("`lapis tag rename <이전> <새이름>` 으로 합칠 수 있다 (기본은 미리보기).");
  }
  reportStale(out, vc);
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
      allowVersionSkew: p.options["allow-version-skew"] === true,
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
  if (result.versionSkew) {
    // ⚠️ 마지막 줄이 사람이 읽는 줄이다. "앱을 켜면 그대로 읽는다"만 남기면 어느 앱을
    //    말하는지가 빠진 채로 성공으로 읽힌다.
    out.line(
      result.committed
        ? `커밋했다 — 단, v${result.cacheVersion} 캐시라 이 CLI와 MCP는 못 읽는다. 그 앱만 읽는다.`
        : `만들기만 했다 — 캐시는 그대로다. 만들었다면 v${result.cacheVersion}였다.`,
    );
    return;
  }
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
/**
 * 노트 본문을 낸다.
 *
 * ## ⚠️ `cat` 이 못 하는 일
 *
 * `cat` 은 경로를 알아야 한다. 이 앱에서 노트를 부르는 이름은 **경로가 아니라 이름**이고
 * (`[[STATE]]`), 같은 이름이 둘이면 해소 규칙이 필요하다. 그 규칙은 `resolveNotePath` 에
 * 이미 있다 — `backlinks` · `open` 이 쓰는 **같은 함수**다.
 *
 * ⚠️ **기본은 본문만.** frontmatter 를 항상 붙이면 파이프로 넘길 때마다 잘라내야 한다.
 * 필요하면 `--meta`.
 */
function cmdRead(p: ParsedCommand, out: Out): void {
  /**
   * ⚠️ `-` 는 **표준입력에서 노트 이름을 읽는다**는 뜻이다.
   *
   * 명령이 스물인데 서로 못 엮였다. 이제 이렇게 된다:
   * `lapis search --json | jq -r .results[0].path | lapis read -`
   *
   * ⚠️ 첫 줄만 쓴다. 여러 줄을 받아 여러 노트를 내면 어디서 끊기는지 알 수 없다 —
   * 그건 `xargs` 가 할 일이다.
   */
  const target = p.positional[0] === "-" ? readStdinLine() : p.positional[0];
  if (!target) {
    return out.fail("usage", "노트를 못 읽었다", "표준입력이 비어 있다", 2);
  }
  const resolved = resolveNotePath(target, vaultOf(p));
  let raw: string;
  try {
    raw = readFileSync(resolved.path, "utf-8");
  } catch (e) {
    return out.fail(
      "read_failed",
      `노트를 못 읽었다: ${resolved.path}`,
      (e as Error)?.message ?? "",
      1,
    );
  }
  const withMeta = p.options.meta === true;
  const body = withMeta ? raw : stripFrontmatter(raw);
  if (out.json) return out.json_({ ...resolved, body });
  out.line(body);
}

/**
 * frontmatter 를 뗀다.
 *
 * ⚠️ **`---` 로 시작할 때만** 뗀다. 본문 중간의 수평선(`---`)을 구분자로 오인하면
 * 문서의 앞부분이 통째로 사라진다 — 에러 없이.
 */
function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return raw;
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return raw;
  const after = raw.indexOf("\n", end + 1);
  return after === -1 ? "" : raw.slice(after + 1);
}

/**
 * vault 한눈.
 *
 * ⚠️ `status` 와 **다른 질문**이다. 저쪽은 "어느 캐시를 어떻게 읽고 있나"(도구의 상태),
 * 이쪽은 "vault 에 무엇이 있나"(내용의 상태)다.
 */
function cmdStats(p: ParsedCommand, out: Out): void {
  const vc = resolveVault(vaultOf(p));
  const infos = vc.infos;

  const count = (pick: (i: (typeof infos)[number]) => string | null | undefined) => {
    const m = new Map<string, number>();
    for (const i of infos) {
      const v = pick(i);
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };

  const docKinds = count((i) => i.doc_kind);
  const topics = count((i) => i.topic);
  const tags = new Set<string>();
  for (const i of infos) for (const t of i.tags ?? []) tags.add(t);
  const openTasks = countOpenTasks(
    collectOpenTasks([...readBodies(vc)].map(([path, body]) => ({ path, body }))),
  );

  if (out.json) {
    return out.json_({
      vault: vc.root,
      notes: infos.length,
      doc_kinds: Object.fromEntries(docKinds),
      topics: Object.fromEntries(topics),
      tags: tags.size,
      tasks: openTasks,
      stale: checkStale(vc),
    });
  }

  const top = (rows: [string, number][], n = 8) =>
    rows.slice(0, n).map(([k, v]) => `${k} ${v}`).join(" · ") || "없음";

  out.line(
    table([
      ["vault", vc.root],
      ["노트", String(infos.length)],
      ["doc_kind", top(docKinds)],
      ["topic", top(topics)],
      ["태그", String(tags.size)],
      ["미완 작업", `${openTasks.open}건 미완 · ${openTasks.done}건 완료`],
    ]),
  );
}

/**
 * 사용 기록 요약.
 *
 * ## ⚠️ 앱이 쓰는 로그를 그대로 읽는다
 *
 * 집계는 `$lib/usageAnalyzer` — 앱이 `analysis.md` 를 만들 때 쓰는 **같은 클래스**다.
 * 여기서 따로 세면 두 숫자가 갈리고, 갈린 통계는 둘 다 못 믿게 된다.
 *
 * ⚠️ **달을 하나씩 흘려보낸다.** 월 파일 상한이 16 MB 라 열두 달을 한 배열로 모으면
 * 최악 192 MB 다.
 */
function cmdUsage(p: ParsedCommand, out: Out): void {
  const dirs = typeof p.options.dir === "string" ? [p.options.dir] : usageDirs();
  const dir = dirs.find((d) => existsSync(d));
  if (!dir) {
    return out.fail(
      "no_usage_log",
      "사용 기록이 없다",
      "앱을 한 번 켜면 로그가 쌓이기 시작한다",
      1,
    );
  }

  const months = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.log$/.test(f))
    .sort();
  if (months.length === 0) {
    return out.fail("no_usage_log", `${dir} 에 로그 파일이 없다`, "앱을 한 번 켜 볼 것", 1);
  }

  const analyzer = new UsageAnalyzer();
  for (const f of months) {
    const raw = readFileSync(nodePath.join(dir, f), "utf-8");
    analyzer.feedAll(raw.split(/\r?\n/).filter((l) => l.trim() !== ""));
  }
  const r = analyzer.result();
  const top = typeof p.options.limit === "number" ? p.options.limit : 10;

  if (out.json) return out.json_({ dir, months, ...r });

  const via = (m: Record<string, number>) =>
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ${v}`)
      .join(" · ") || "없음";

  out.line(
    table([
      ["로그", dir],
      ["기간", months.length === 1 ? months[0] : `${months[0]} ~ ${months.at(-1)}`],
      ["이벤트", String(r.events)],
      ["세션", String(r.sessions)],
      ["오류 · 경고", `${r.errorCount} · ${r.warnCount}`],
      ["못 읽은 줄", `깨짐 ${r.malformed} · 모르는 종류 ${r.unknownKind}`],
    ]),
  );
  out.line("");
  out.line("많이 쓴 명령");
  out.line(
    table(r.commands.slice(0, top).map((c) => ["  " + c.id, `${c.total} (${via(c.via)})`])) ||
      "  없음",
  );
  if (r.queries.empty.length > 0) {
    out.line("");
    out.line("결과가 0건이던 질의");
    out.line(
      table(r.queries.empty.slice(0, top).map((q) => ["  " + q.q, `${q.count}회 · ${q.kind}`])),
    );
  }
  if (r.perf.length > 0) {
    out.line("");
    out.line("성능");
    out.line(
      table(
        r.perf.map((x) => [
          "  " + x.op,
          `${x.count}회 · 평균 ${Math.round(x.avgMs)}ms · 최대 ${Math.round(x.maxMs)}ms`,
        ]),
      ),
    );
  }
}

/**
 * 노트를 만든다.
 *
 * ## ⚠️ 쓰기다 — 3층의 규율을 따른다
 *
 * `replace` · `tag rename` 과 같은 자리에 선다. 다만 훨씬 단순하다: **새 파일 하나**라
 * 백업할 것도 롤백할 것도 없다. 대신 두 가지를 지킨다.
 *
 * 1. **이미 있으면 거부한다.** 덮어쓰면 되돌릴 방법이 없다.
 * 2. **vault 밖으로 못 나간다.** `../` 가 섞인 이름을 그대로 이으면 vault 밖을 쓴다.
 *
 * ⚠️ 템플릿 적용은 `$lib/noteTemplate` — 앱이 새 노트를 만들 때 쓰는 **같은 함수**다.
 * 여기서 따로 채우면 앱과 CLI 가 다른 문서를 만든다.
 */
function cmdNew(p: ParsedCommand, out: Out): void {
  const vc = resolveVault(vaultOf(p));
  const raw = String(p.positional[0] ?? "").trim();
  if (!raw) return out.fail("usage", "이름이 필요하다", "lapis new <이름>", 2);

  const rel = raw.endsWith(".md") ? raw : `${raw}.md`;
  const target = nodePath.resolve(vc.root, rel);
  // 🔴 vault 밖으로 못 나간다. 문자열이 아니라 **해소한 경로**로 본다.
  const root = nodePath.resolve(vc.root);
  if (target !== root && !target.startsWith(root + nodePath.sep)) {
    return out.fail("outside_vault", `vault 밖이다: ${rel}`, "vault 안의 경로를 줄 것", 2);
  }
  if (existsSync(target)) {
    return out.fail("exists", `이미 있다: ${rel}`, "다른 이름을 쓰거나 직접 열어 볼 것", 1);
  }

  const title = typeof p.options.title === "string" ? p.options.title : nodePath.basename(rel, ".md");
  let body = defaultBody(title);
  const tpl = p.options.template;
  if (typeof tpl === "string" && tpl) {
    const tplPath = nodePath.join(vc.root, TEMPLATE_DIR, tpl.endsWith(".md") ? tpl : `${tpl}.md`);
    if (!existsSync(tplPath)) {
      return out.fail(
        "no_template",
        `템플릿이 없다: ${tpl}`,
        `${TEMPLATE_DIR} 안의 파일 이름을 줄 것`,
        1,
      );
    }
    body = applyTemplate(readFileSync(tplPath, "utf-8"), { title, now: new Date() });
  }

  try {
    mkdirSync(nodePath.dirname(target), { recursive: true });
    // ⚠️ `wx` — 있으면 던진다. 위 검사와 파일 생성 사이의 틈을 파일시스템이 막는다.
    writeFileSync(target, body, { encoding: "utf-8", flag: "wx" });
  } catch (e) {
    return out.fail("write_failed", `못 만들었다: ${rel}`, (e as Error)?.message ?? "", 1);
  }

  if (out.json) return out.json_({ vault: vc.root, path: target, created: true });
  out.line(`만들었다: ${rel}`);
  out.line("(앱의 인덱스는 아직 모른다 — `lapis index` 나 앱을 켜면 반영된다)");
}

/**
 * 셸 자동완성.
 *
 * ⚠️ **명령 목록을 손으로 안 적는다.** `COMMANDS` 에서 뽑는다 — 손으로 적으면 명령을
 * 추가할 때마다 여기를 잊고, 잊으면 새 명령만 완성이 안 된다(에러는 안 난다).
 */
function cmdCompletion(p: ParsedCommand, out: Out): void {
  const shell = String(p.positional[0] ?? "").toLowerCase();
  const names = COMMANDS.map((c) => c.name).join(" ");
  if (shell === "bash") {
    return out.line(
      [
        "_lapis() {",
        '  local cur="${COMP_WORDS[COMP_CWORD]}"',
        "  if [ $COMP_CWORD -eq 1 ]; then",
        `    COMPREPLY=( $(compgen -W "${names}" -- "$cur") )`,
        "  fi",
        "}",
        "complete -F _lapis lapis",
      ].join("\n"),
    );
  }
  if (shell === "zsh") {
    return out.line(
      [
        "#compdef lapis",
        "_lapis() {",
        `  local -a cmds; cmds=(${names})`,
        '  if (( CURRENT == 2 )); then _describe "명령" cmds; fi',
        "}",
        "compdef _lapis lapis",
      ].join("\n"),
    );
  }
  if (shell === "pwsh" || shell === "powershell") {
    return out.line(
      [
        "Register-ArgumentCompleter -Native -CommandName lapis -ScriptBlock {",
        "  param($wordToComplete, $commandAst, $cursorPosition)",
        `  @(${COMMANDS.map((c) => `'${c.name}'`).join(",")}) |`,
        "    Where-Object { $_ -like \"$wordToComplete*\" } |",
        "    ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }",
        "}",
      ].join("\n"),
    );
  }
  out.fail("usage", `모르는 셸: ${shell}`, "bash · zsh · pwsh 중 하나", 2);
}

/**
 * 앱 설정을 보고 바꾼다.
 *
 * ## ⚠️ 왜 CLI 에 있나
 *
 * `mcp_enabled` 를 **앱에서만** 켤 수 있었다. 그 토글이 조용히 안 먹은 적이 있고
 * (같은 값이면 아무것도 안 했고, dev/릴리스 설정이 갈렸다) 확인할 다른 경로가 없어서
 * 원인을 앱이 아닌 MCP 쪽에서 찾느라 시간을 썼다. **경로가 둘이면 그때 바로 갈린다.**
 *
 * ⚠️ 쓰기는 `writeSetting` 이 한다 — 모르는 키를 보존하고 후보 파일 전부에 쓴다.
 */
function cmdConfig(p: ParsedCommand, out: Out): void {
  const key = p.positional[0];
  const raw = p.positional[1];

  if (!key) {
    const s = readSettings();
    if (!s) {
      return out.fail(
        "cache_absent",
        "설정 파일이 없다",
        "Lapis 앱을 한 번 실행하면 만들어진다",
        1,
      );
    }
    if (out.json) return out.json_({ file: s.file, values: s.values });
    out.line(table([["파일", s.file]]));
    out.line("");
    out.line(
      table(Object.entries(s.values).map(([k, v]) => ["  " + k, summarizeValue(v)])),
    );
    return;
  }

  if (raw === undefined) {
    const s = readSettings();
    const v = s?.values[key];
    if (out.json) return out.json_({ key, value: v ?? null, file: s?.file ?? null });
    // ⚠️ `--quiet` 면 값만 낸다 — 스크립트가 받아쓰는 자리다.
    return out.line(p.options.quiet === true ? String(v ?? "") : `${key} = ${summarizeValue(v)}`);
  }

  const value = parseSettingValue(raw);
  const touched = writeSetting(key, value);
  if (touched.length === 0) {
    return out.fail(
      "cache_absent",
      "설정 파일이 없다",
      "Lapis 앱을 한 번 실행하면 만들어진다",
      1,
    );
  }
  if (out.json) return out.json_({ key, value, files: touched });
  out.line(`${key} = ${summarizeValue(value)}`);
  if (p.options.quiet !== true) {
    // ⚠️ 앱이 떠 있으면 메모리의 값이 이긴다 — 안 적으면 "썼는데 안 먹는다"가 된다.
    out.line(`  ${touched.length}개 파일에 썼다. 앱이 떠 있으면 다시 켜야 반영된다.`);
  }
}

/**
 * 표준입력의 **첫 줄**.
 *
 * ⚠️ 파이프가 아니면 여기서 멈춘다. 그래서 `-` 를 명시했을 때만 부른다.
 */
function readStdinLine(): string {
  try {
    const raw = readFileSync(0, "utf-8");
    return raw.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
  } catch {
    return "";
  }
}

/** `true` · `false` · 숫자는 그 타입으로, 나머지는 문자열. */
function parseSettingValue(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  return raw;
}

/** 긴 값(사용자 CSS 본문 등)은 줄여서 — 터미널을 덮지 않게. */
function summarizeValue(v: unknown): string {
  if (typeof v === "string" && v.length > 60) return `${v.slice(0, 57)}… (${v.length}자)`;
  return JSON.stringify(v) ?? String(v);
}

/**
 * 노트의 git 변경을 본다.
 *
 * ⚠️ **git 을 직접 부른다.** 앱의 `git_show_diff` 는 Tauri 커맨드라 여기서 못 쓴다.
 * 인자 모양은 앱 쪽과 같게 맞춘다 — 두 도구가 다른 diff 를 내면 안 된다.
 */
function cmdDiff(p: ParsedCommand, out: Out): void {
  const resolved = resolveNotePath(p.positional[0], vaultOf(p));
  const rev = typeof p.options.rev === "string" ? p.options.rev : "";
  const args = rev
    ? ["diff", rev, "--", resolved.path]
    : ["diff", "--", resolved.path];
  const r = spawnSync("git", args, { cwd: resolved.vault, encoding: "utf-8" });
  if (r.error) {
    return out.fail("internal", "git 을 못 불렀다", "git 이 PATH 에 있는지 볼 것", 1);
  }
  if (r.status !== 0 && r.stderr) {
    return out.fail("internal", r.stderr.trim(), "vault 가 git 저장소인지 볼 것", 1);
  }
  const diff = r.stdout ?? "";
  if (out.json) return out.json_({ ...resolved, rev: rev || null, diff });
  if (!diff.trim()) {
    // ⚠️ 변경이 없는 것은 **오류가 아니다.** 종료 코드 0 으로 끝낸다.
    return out.line(p.options.quiet === true ? "" : "변경 없음");
  }
  out.line(diff);
}

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
 * vault 전체 찾아 바꾸기.
 *
 * ⚠️ **기본은 dry-run이다.** `tag rename`과 같은 규율이고, 쓰기는 같은
 * `$lib/safeWrite` 트랜잭션을 탄다(백업 → 순차 쓰기 → 실패 시 롤백).
 *
 * ⚠️ `⌘⇧G`(Rust `regex`)와 **다른 엔진**(JS `RegExp`)이다. 그래서 grep 결과를 그대로
 * 믿지 않고 여기서 다시 찾아 자기 건수를 낸다 — 자세한 근거는 `$lib/replacePlan`.
 */
export async function cmdReplace(p: ParsedCommand, out: Out): Promise<void> {
  const [pattern, replacement] = p.positional;
  const vc = resolveVault(vaultOf(p));
  const prefix = typeof p.options.path === "string" ? p.options.path : null;

  // 미리보기 계산은 대상 노트를 전부 읽는다. 앱과 같은 이유로 명시적 단계다.
  const notes = new Map<string, string>();
  const rel = relativizer(vc.root);
  for (const info of vc.infos) {
    if (prefix !== null && !rel(info.source_path).startsWith(prefix)) continue;
    try {
      notes.set(info.source_path, readFileSync(info.source_path, "utf8"));
    } catch {
      // 한 파일을 못 읽었다고 전체를 세우지 않는다. 그 노트만 대상에서 빠진다.
    }
  }

  let preview;
  try {
    preview = computeReplacePreview(notes, pattern, replacement, {
      regex: p.options.regex === true,
      caseSensitive: p.options["ignore-case"] !== true,
      wholeWord: p.options["whole-word"] === true,
    });
  } catch (e) {
    if (e instanceof ReplacePatternError) {
      out.fail("no_criteria", e.message, "--regex 없이 리터럴로 찾을 수도 있다", 2);
    }
    throw e;
  }

  const rows = preview.items.map((i) => ({ path: rel(i.path), occurrences: i.occurrences }));
  const apply = p.options.apply === true;
  // ⚠️ 쓰기 직전에만 막는다 — `tag rename`과 같은 이유.
  if (apply) requireFreshIndex(out, vc, p);

  if (!apply) {
    if (out.json) {
      return out.json_({
        vault: vc.root,
        dry_run: true,
        ...staleField(vc),
        pattern,
        replacement,
        total_occurrences: preview.totalOccurrences,
        frontmatter_occurrences: preview.frontmatterOccurrences,
        self_matching: preview.selfMatching,
        items: rows,
      });
    }
    out.line(
      renderReplacePreview(pattern, replacement, rows, preview.totalOccurrences, {
        frontmatter: preview.frontmatterOccurrences,
        selfMatching: preview.selfMatching,
      }),
    );
    if (rows.length > 0) out.line("\n미리보기다 — 실제로 쓰려면 --apply");
    reportStale(out, vc);
    return;
  }

  if (preview.items.length === 0) {
    // 쓸 게 없는데 성공이라고 하면 "바뀐 줄 알았다"가 된다.
    out.fail(
      "path_not_indexed",
      `"${pattern}" 을(를) 쓰는 노트가 없다`,
      "--regex 여부와 --path 범위를 확인하라",
      1,
    );
  }

  const io2 = makeCliIo({
    settingsFile: nodePath.join(nodePath.dirname(vc.dir), "lapis-settings.json"),
  });
  const outcome = await backupAndWrite(vc.root, preview.items, io2);
  if (!outcome.ok) {
    out.fail("corrupt", describeFailure(outcome) ?? "쓰기 실패", "백업에서 회수할 수 있다", 1);
  }

  if (out.json) {
    return out.json_({
      vault: vc.root,
      applied: true,
      written: outcome.ok ? outcome.written : [],
    });
  }
  out.line(`${pattern} → ${replacement}: 노트 ${preview.items.length}개 갱신`);
  // ⚠️ 앱이 인덱스 생산자다. CLI가 쓴 것은 앱이 다시 읽어야 검색에 반영된다.
  out.line("앱이 떠 있으면 watcher가 반영한다. 아니면 다음에 vault를 열 때 재색인된다.");
}

/**
 * 명령 이름 → 핸들러.
 *
 * ⚠️ `spec.ts`의 `COMMANDS`와 **키가 정확히 같아야 한다.** 한쪽에만 있으면 도움말에는
 * 보이는데 부르면 아무 일도 안 일어나거나, 그 반대가 된다. 테스트가 이걸 고정한다.
 */
/**
 * `lapis doctor` — vault 건강 검진을 한 번에.
 *
 * ## 왜 있나
 *
 * 감사가 셋으로 흩어져 있고(`links --broken` · `links --orphans` · `tag audit`) 인덱스가
 * 낡았는지는 **넷째 명령**(`status`)이다. "내 vault 괜찮나"를 물으려면 넷을 따로 쳐야 했고,
 * 그러다 인덱스 확인을 빼먹으면 나머지 셋이 **자신 있게 틀린 답**을 낸다.
 *
 * ## ⚠️ 종료 코드에 뜻이 있다
 *
 * | 0 | 문제 없음 |
 * | 1 | 문제를 찾았다 |
 * | 2 | 돌리지 못했다 (vault 없음 · 인덱스 없음) — `resolveVault`가 던진다 |
 *
 * **"문제 있음"과 "못 돌렸음"을 가른다.** 섞으면 CI에서 vault 경로 오타가 위생 문제로
 * 보고된다. `grep` 관례와 같은 이유다.
 *
 * ## ⚠️ 고치지 않는다
 *
 * 이름이 고칠 것처럼 들리지만 "판단하지 않는다" 원칙은 그대로다. 되돌릴 수 없는 실행은
 * `tag rename` · `replace`가 맡고, 둘 다 미리보기를 거친다.
 *
 * **낡음은 문제로 세지 않는다.** 살아 있는 vault는 몇 초 사이에도 낡으므로, 세면 doctor가
 * 상시 1을 내며 훅에서 못 쓰게 된다. 대신 **맨 위에** 낸다 — 아래 숫자를 얼마나 믿을지가
 * 거기 달렸기 때문이다.
 */
export function cmdDoctor(p: ParsedCommand, out: Out): void {
  // ⚠️ **"문제 있음"(1)과 "못 돌렸음"(2)을 가른다.**
  //
  // 다른 명령은 `LapisError`가 그냥 1로 나간다 — 거기엔 "문제 있음"이라는 뜻이 없어서
  // 헷갈릴 일이 없기 때문이다. doctor는 1을 이미 쓰므로 같이 둘 수 없다. 섞으면 CI에서
  // **vault 경로 오타가 위생 문제로 보고된다.**
  let vc: VaultCache;
  try {
    vc = resolveVault(vaultOf(p));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const remedy = e instanceof LapisError ? e.remedy : "`lapis status` 로 vault와 캐시를 확인하라";
    out.fail(e instanceof LapisError ? e.kind : "internal", msg, remedy, 2);
  }
  const rel = relativizer(vc.root);
  const index = buildIndex(vc.infos);
  const st = checkStale(vc);

  const broken = findBrokenLinks(index).map((g) => ({
    ...g,
    sources: g.sources.map((src) => ({ ...src, path: rel(src.path) })),
  }));
  const orphans = findOrphans(index).map((o) => ({ ...o, path: rel(o.path) }));
  const tagIssues = findTagIssues(vc.infos);
  const ambiguous = findAmbiguousNames(index).map((a) => ({ ...a, paths: a.paths.map(rel) }));

  // ⚠️ **이 검사 하나만 본문을 읽는다.** 나머지 넷은 인덱스만 본다. 81노트 0.3 MB에서
  //    doctor 전체가 0.73 → 0.79초였다(+54 ms). 큰 vault에서는 이 항목이 비용을 지배한다.
  const fmIssues = findFrontmatterIssues(index);

  const unlinked = findUnlinkedMentions(index, readBodies(vc)).map((r) => ({
    ...r,
    target: rel(r.target),
    sources: r.sources.map((x) => ({ ...x, path: rel(x.path) })),
  }));

  const problems =
    broken.length +
    orphans.length +
    tagIssues.length +
    ambiguous.length +
    unlinked.length +
    fmIssues.length;

  if (out.json) {
    out.json_({
      vault: vc.root,
      ok: problems === 0,
      problems,
      stale: st,
      broken_links: { targets: broken.length, links: countBrokenLinks(broken), groups: broken },
      orphans: { count: orphans.length, notes: orphans },
      tag_issues: tagIssues,
      ambiguous_names: ambiguous,
      frontmatter_issues: fmIssues,
      unlinked_mentions: {
        names: unlinked.length,
        mentions: unlinked.reduce((n, r) => n + r.total, 0),
        rows: unlinked,
      },
    });
    // ⚠️ `json_`는 출력만 한다. 종료 코드는 여기서 정해야 한다.
    if (problems > 0) process.exitCode = 1;
    return;
  }

  // 낡음을 **맨 위에** 낸다 — 아래 숫자를 얼마나 믿을지가 여기 달렸다.
  if (st.changed) {
    out.line(`⚠️  ${STALE_LINE}`);
    out.line(`   노트 ${st.total}개 중 ${st.newer_count}개가 캐시보다 새롭다.`);
    out.line("   아래 숫자는 마지막 인덱싱 시점의 vault를 본 것이다.\n");
  }

  out.line(
    table([
      ["검사", "결과"],
      ["끊긴 링크", broken.length === 0 ? "없음" : `대상 ${broken.length}개`],
      ["고아 노트", orphans.length === 0 ? "없음" : `${orphans.length}개`],
      ["태그 중복", tagIssues.length === 0 ? "없음" : `${tagIssues.length}묶음`],
      ["모호한 이름", ambiguous.length === 0 ? "없음" : `${ambiguous.length}개`],
      ["안 걸린 언급", unlinked.length === 0 ? "없음" : `이름 ${unlinked.length}개`],
      ["frontmatter", fmIssues.length === 0 ? "없음" : `${fmIssues.length}묶음`],
    ]),
  );

  if (problems === 0) {
    out.line("\n문제 없음.");
    return;
  }
  out.line("\n자세히 보려면:");
  if (broken.length > 0) out.line("  lapis links --broken");
  if (orphans.length > 0) out.line("  lapis links --orphans");
  if (tagIssues.length > 0 || ambiguous.length > 0) out.line("  lapis tag audit");
  if (unlinked.length > 0) out.line("  lapis links --unlinked");
  if (fmIssues.length > 0) out.line("  lapis props audit");
  process.exitCode = 1;
}

/**
 * `lapis export --all --out-dir <디렉터리>` — vault 전체.
 *
 * ⚠️ **vault 구조를 그대로 만든다.** 평평하게 펴면 `a/노트.md` 와 `b/노트.md` 가 같은
 * 파일 이름을 놓고 다투고, 나중 것이 앞의 것을 **말없이 덮는다.**
 *
 * ⚠️ 출력 경로는 vault 상대 경로에서만 만든다 — 밖으로 새지 않는다. 그래도 한 번 더
 * 검사한다(`safeWrite` 와 같은 태도: 경로 이탈은 조용히 틀리는 부류다).
 */
function exportAll(p: ParsedCommand, out: Out, outDir: string): void {
  const vc = resolveVault(vaultOf(p));
  const repoRoot = process.env.LAPIS_REPO;
  if (!repoRoot) {
    out.fail("internal", "LAPIS_REPO 가 없다", "cli/lapis 로 실행하라", 2);
  }
  const index = buildIndex(vc.infos);
  const theme = pickColorTheme();
  const rel = relativizer(vc.root);
  const destRoot = nodePath.resolve(outDir);

  let written = 0;
  const failed: { note: string; why: string }[] = [];
  for (const info of vc.infos) {
    const relPath = rel(info.source_path);
    const dest = nodePath.resolve(destRoot, relPath.replace(/\.(md|mmd|markdown)$/i, ".html"));
    // ⚠️ 경로 이탈 검사. vault 상대 경로에서 만들었으니 새면 안 되지만, 새면 조용하다.
    if (!dest.startsWith(destRoot + nodePath.sep)) {
      failed.push({ note: relPath, why: "출력 디렉터리 밖" });
      continue;
    }
    try {
      mkdirSync(nodePath.dirname(dest), { recursive: true });
      const r = runExport({
        notePath: info.source_path,
        repoRoot,
        index,
        ...(theme !== undefined ? { colorTheme: theme } : {}),
      });
      writeFileSync(dest, r.html, "utf8");
      written++;
    } catch (e) {
      failed.push({ note: relPath, why: e instanceof Error ? e.message : String(e) });
    }
  }

  if (out.json) {
    out.json_({ vault: vc.root, out_dir: destRoot, written, failed, ...staleField(vc) });
  } else {
    out.line(`${written}장을 ${destRoot} 에 썼다.`);
    // ⚠️ 실패를 세어서 말한다. 조용히 빠지면 "전부 나왔다"로 읽힌다.
    for (const f of failed) out.line(`⚠️  ${f.note}: ${f.why}`);
    reportStale(out, vc);
  }
  if (failed.length > 0) process.exitCode = 1;
}

/**
 * 설정 파일에서 고른 색 테마를 읽는다. 없으면 `undefined`(기본 팔레트).
 *
 * ⚠️ 읽기 실패를 **삼킨다.** 테마를 못 읽어서 내보내기 전체를 막을 이유가 없다 —
 * 기본 팔레트로 나가는 것이 안 나가는 것보다 낫다. 다만 색이 다를 수 있다는 것은
 * `cli/README.md`가 말한다.
 */
function pickColorTheme(): string | undefined {
  for (const file of settingsFileCandidates()) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const t = parsed.color_theme;
      if (typeof t === "string" && t) return t;
    } catch {
      // 없거나 깨졌다. 다음 후보로.
    }
  }
  return undefined;
}

/**
 * `lapis export <노트>` — 자립 HTML 한 장.
 *
 * ⚠️ 앱의 내보내기와 **결과가 다를 수 있다**(mermaid · 사용자 CSS). 차이는
 * `exportRun.ts` 헤더와 `cli/README.md`에 표로 있다.
 */
export function cmdExport(p: ParsedCommand, out: Out): void {
  const all = p.options.all === true;
  const outDir = typeof p.options["out-dir"] === "string" ? p.options["out-dir"] : undefined;
  if (all && !outDir) {
    out.fail(
      "no_criteria",
      "--all 은 --out-dir 가 있어야 한다",
      "수백 장을 표준출력으로 이어 붙이면 쓸 수 없는 문서가 된다",
      2,
    );
  }
  if (!all && !p.positional[0]) {
    out.fail("no_criteria", "노트를 지정하지 않았다", "노트 이름 또는 --all", 2);
  }
  if (all) return exportAll(p, out, outDir!);

  const target = p.positional[0];
  const { path: notePath } = resolveNotePath(target, vaultOf(p));
  const repoRoot = process.env.LAPIS_REPO;
  if (!repoRoot) {
    out.fail(
      "internal",
      "LAPIS_REPO 가 없다 — 러너를 거치지 않고 실행됐다",
      "cli/lapis (또는 cli\lapis.cmd) 로 실행하라",
      2,
    );
  }

  const vc = resolveVault(vaultOf(p));
  let result;
  try {
    result = runExport({
      notePath,
      repoRoot,
      index: buildIndex(vc.infos),
      ...(pickColorTheme() !== undefined ? { colorTheme: pickColorTheme()! } : {}),
    });
  } catch (e) {
    if (e instanceof ExportError) out.fail("export_failed", e.message, e.remedy, 1);
    throw e;
  }

  const dest = typeof p.options.out === "string" ? p.options.out : undefined;
  if (!dest) {
    // ⚠️ `--json` 이어도 HTML 을 그대로 낸다. 파이프로 받는 쪽이 원하는 건 문서지
    //    문서를 감싼 JSON 이 아니다.
    return out.line(result.html);
  }

  try {
    writeFileSync(dest, result.html, "utf8");
  } catch (e) {
    out.fail("export_failed", `쓸 수 없다: ${dest}`, String(e), 1);
  }

  if (out.json) {
    return out.json_({ note: notePath, out: dest, images: result.images });
  }
  out.line(`${dest} 로 썼다.`);
  if (result.images.failed > 0) {
    // ⚠️ 조용히 원본 경로를 남기면 "자립"이 거짓이 된다.
    out.line(`⚠️  이미지 ${result.images.failed}개를 못 넣었다 — 그 자리는 원본 경로 그대로다.`);
  }
}

/**
 * `lapis props audit` — frontmatter 값이 갈린 곳.
 *
 * ⚠️ `tag audit`과 성격이 같지만 **대상이 다르다.** 저쪽은 태그, 이쪽은 거를 수 있는
 * 축(`doc_kind`·`topic`과 열거형처럼 쓰이는 props 필드)이다.
 */
export function cmdProps(p: ParsedCommand, out: Out): void {
  const action = p.positional[0];
  if (!(PROPS_ACTIONS as readonly string[]).includes(action)) {
    out.fail(
      "no_criteria",
      `모르는 동작: ${action}`,
      `쓸 수 있는 값: ${PROPS_ACTIONS.join(" · ")}`,
      2,
    );
  }
  const vc = resolveVault(vaultOf(p));
  const issues = findFrontmatterIssues(buildIndex(vc.infos));
  if (out.json) {
    return out.json_({ vault: vc.root, ...staleField(vc), issues });
  }
  out.line(renderFrontmatterIssues(issues));
  if (issues.length > 0) {
    // ⚠️ 고치라고 하지 않는다 — 감사 계열이 전부 그렇다.
    out.line("\n자유 서술이 섞인 값도 여기 걸린다. 그게 틀렸다는 뜻은 아니다 —");
    out.line("이 축으로 거르는 질의가 절반만 찾는다는 뜻이다.");
  }
  reportStale(out, vc);
}

/**
 * `lapis tasks audit` — 본문의 미완 `- [ ]`.
 *
 * ⚠️ **본문을 전부 읽는다.** `links --unlinked` 와 같은 부류다 — 인덱스로는 안 된다.
 * ⚠️ 코드 블록 안은 안 센다. 셸 예시의 `- [ ]` 를 할 일로 세면 목록을 못 믿게 된다.
 */
export function cmdTasks(p: ParsedCommand, out: Out): void {
  const action = p.positional[0];
  if (action !== "audit") {
    out.fail("no_criteria", `모르는 동작: ${action}`, "쓸 수 있는 값: audit", 2);
  }
  const vc = resolveVault(vaultOf(p));
  const groups = collectOpenTasks(
    vc.infos.flatMap((info) => {
      try {
        return [{ path: info.source_path, body: readFileSync(info.source_path, "utf8") }];
      } catch {
        // 캐시에는 있는데 디스크에서 사라진 노트. 그 노트만 빠진다.
        return [];
      }
    }),
  );
  const total = countOpenTasks(groups);

  if (out.json) {
    return out.json_({ vault: vc.root, ...staleField(vc), total, groups });
  }
  if (groups.length === 0) {
    out.line("미완 작업이 없다.");
  } else {
    out.line(`${total.open}건 미완 · ${total.done}건 완료`);
    for (const g of groups) {
      out.line("");
      out.line(`${g.path}  (${g.open.length})`);
      for (const t of g.open) {
        out.line(`${"  ".repeat(t.depth + 1)}- ${t.text}`);
      }
    }
  }
  reportStale(out, vc);
}

/**
 * `lapis css --off` — 사용자 정의 CSS를 끈다.
 *
 * ## 왜 CLI에 있나
 *
 * `[data-lapis="app"] { display: none }` 한 줄이면 앱이 안 보이고 설정에도 못 들어간다.
 * 앱 안의 패닉 단축키가 1차 방어선이고, **이건 그것도 못 누를 때**(앱이 아예 안 뜰 때)를
 * 위한 것이다.
 *
 * ⚠️ **내용은 지우지 않는다.** 끄기만 한다 — 사용자가 쓴 것을 도구가 말없이 날리면 안 된다.
 *
 * ⚠️ vault가 필요 없다. 앱 설정은 vault와 무관하고, 애초에 앱이 망가진 상황이라
 * vault 해소가 되는지도 기댈 수 없다.
 */
export function cmdCss(p: ParsedCommand, out: Out): void {
  if (p.options.off !== true) {
    out.fail(
      "no_criteria",
      "무엇을 할지 지정하지 않았다",
      "--off 로 사용자 정의 CSS 적용을 끈다",
      2,
    );
  }
  const touched = disableCustomCss();
  if (out.json) return out.json_({ disabled: touched.length > 0, files: touched });
  if (touched.length === 0) {
    // 설정 파일이 없거나 이미 꺼져 있다. **오류가 아니다** — 원하는 상태가 이미 그것이다.
    out.line("고칠 것이 없다 (설정 파일이 없거나 이미 꺼져 있다).");
    for (const f of settingsFileCandidates()) out.line(`  찾아본 곳: ${f}`);
    return;
  }
  out.line("사용자 정의 CSS 적용을 껐다. 내용은 그대로 남아 있다.");
  for (const f of touched) out.line(`  ${f}`);
  out.line("\n앱을 다시 켜면 반영된다. 설정에서 고쳐 다시 켤 수 있다.");
}

export const HANDLERS: Record<string, (p: ParsedCommand, out: Out) => void | Promise<void>> = {
  css: cmdCss,
  search: cmdSearch,
  doctor: cmdDoctor,
  backlinks: cmdBacklinks,
  list: cmdList,
  links: cmdLinks,
  tag: cmdTag,
  status: cmdStatus,
  export: cmdExport,
  props: cmdProps,
  tasks: cmdTasks,
  index: cmdIndex,
  open: cmdOpen,
  read: cmdRead,
  stats: cmdStats,
  usage: cmdUsage,
  new: cmdNew,
  completion: cmdCompletion,
  config: cmdConfig,
  diff: cmdDiff,
  replace: cmdReplace,
};
