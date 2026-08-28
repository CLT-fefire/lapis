/**
 * 테스트 픽스처 — 작은 v7 캐시를 임시 디렉터리에 만든다.
 *
 * 라이브 앱 상태에 의존하지 않는다. 실제 캐시로 테스트하면 ⓐ 앱이 언제든 재빌드해서
 * fingerprint가 바뀌고 ⓑ 19,000노트라 느리고 ⓒ 개인 문서 내용이 단정문에 박힌다.
 */

import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import MiniSearch from "minisearch";
import { FULLTEXT_OPTIONS, type FullTextDoc, type LinkInfo } from "./entry.ts";
import { CACHE_VERSION, fingerprintOf, normPath, normalizeVaultArg } from "./cache.ts";

export interface FixtureNote {
  rel: string;
  body: string;
  title?: string | null;
  doc_kind?: string | null;
  topic?: string | null;
  tags?: string[];
  /** 본문 wikilink 대상 (노트 stem). */
  targets?: string[];
  /** frontmatter cross-ref — `{ 필드: [노트 stem] }`. */
  related?: Record<string, string[]>;
  /**
   * 그 밖의 frontmatter 필드 — `{ 필드: [값] }`.
   *
   * ⚠️ `related`와 나눠 둔 이유: `related`는 **관계**로 해소되지만 이쪽은 그냥 값이다.
   * 시간축 테스트가 `date`를 넣는 데 쓴다.
   */
  props?: Record<string, string[]>;
}

/**
 * 만든 임시 디렉터리 목록. ⚠️ 이게 없으면 테스트가 돌 때마다 `$TMPDIR`에 디렉터리가
 * 쌓인다 — 실제로 470여 개가 남아 있었다. 테스트 훅에서 `cleanupFixtures()`를 부른다.
 */
const created: string[] = [];

/** 이 실행에서 만든 픽스처 디렉터리를 전부 지운다. 실패는 무시(임시 파일일 뿐이다). */
export function cleanupFixtures(): void {
  for (const dir of created.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 무시 */
    }
  }
}

export interface Fixture {
  cacheDir: string;
  vaultRoot: string;
  key: string;
  fingerprint: string;
}

/**
 * @param opts.shardCount meta에 기록할 값. 실제로 쓴 shard 수와 **다르게** 줘서
 *   결손·skew 경로를 시험할 수 있다.
 * @param opts.corruptShardFingerprint 이 shard의 fingerprint를 어긋내 skew를 만든다.
 */
export function makeFixture(
  notes: FixtureNote[],
  opts: {
    fingerprint?: string;
    shardCount?: number;
    writeShards?: number;
    corruptShardFingerprint?: number;
    corruptShardId?: number;
    metaVersion?: number;
    vaultRoot?: string;
  } = {},
): Fixture {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "lapis-mcp-fixture-"));
  created.push(cacheDir);
  // ⚠️ `/` 정규화한 뒤 쓴다. Windows에서 `path.join`은 `\` 구분자를 내는데,
  // 캐시가 담는 경로와 MCP가 내보내는 경로는 항상 `/`다(`normPath`). 픽스처만
  // 원본 구분자를 쓰면 테스트가 프로덕션과 다른 계약을 검증하게 된다.
  const vaultRoot = normPath(opts.vaultRoot ?? path.join(cacheDir, "vault"));
  const key = "fixturekey000001";

  const infos: LinkInfo[] = notes.map((n) => ({
    source_path: `${vaultRoot}/${n.rel}`,
    source_name: basename(n.rel),
    title: n.title ?? null,
    aliases: [],
    targets: n.targets ?? [],
    tags: n.tags ?? [],
    doc_kind: n.doc_kind ?? null,
    topic: n.topic ?? null,
    related: Object.values(n.related ?? {}).flat(),
    props: {
      ...Object.fromEntries(Object.entries(n.related ?? {}).map(([f, v]) => [f, v])),
      ...(n.props ?? {}),
    },
  })) as unknown as LinkInfo[];

  // vault 파일도 실제로 쓴다 — 스니펫이 디스크를 읽고, staleness가 mtime을 본다.
  for (const n of notes) {
    const abs = path.join(vaultRoot, n.rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    const fm = [
      "---",
      ...(n.title ? [`title: ${n.title}`] : []),
      ...(n.doc_kind ? [`doc_kind: ${n.doc_kind}`] : []),
      ...(n.topic ? [`topic: ${n.topic}`] : []),
      ...(n.tags?.length ? ["tags:", ...n.tags.map((t) => `  - ${t}`)] : []),
      ...Object.entries(n.related ?? {}).map(([f, v]) => `${f}: ${v.join(", ")}`),
      "---",
      "",
    ].join("\n");
    writeFileSync(abs, fm + n.body + "\n");
  }

  // ⚠️ fingerprint는 **방금 쓴 파일들에서 계산한다.** 임의의 상수를 박아두면 v8부터
  // `checkStale`이 이걸 실제 vault와 대조하므로 모든 픽스처가 영구 `changed`가 된다 —
  // 앱이 하는 일(같은 walk에서 계산해 meta에 커밋)과 같아야 테스트가 계약을 검증한다.
  const fingerprint = opts.fingerprint ?? fingerprintOf(fixtureEntries(vaultRoot, notes));

  const shardCount = opts.shardCount ?? 1;
  const writeShards = opts.writeShards ?? shardCount;
  for (let i = 0; i < writeShards; i++) {
    const docs: FullTextDoc[] = notes
      .filter((_, idx) => idx % Math.max(1, shardCount) === i)
      .map((n) => ({
        id: `${vaultRoot}/${n.rel}`,
        name: basename(n.rel),
        title: n.title ?? "",
        body: n.body,
      }));
    const ms = new MiniSearch<FullTextDoc>(FULLTEXT_OPTIONS);
    ms.addAll(docs);
    writeGz(path.join(cacheDir, `${key}.shard${i}.json.gz`), {
      version: CACHE_VERSION,
      shard_id: opts.corruptShardId === i ? i + 99 : i,
      fingerprint: opts.corruptShardFingerprint === i ? "deadbeefdeadbeef" : fingerprint,
      minisearch_json: JSON.stringify(ms),
    });
  }

  writeGz(path.join(cacheDir, `${key}.meta.json.gz`), {
    version: opts.metaVersion ?? CACHE_VERSION,
    fingerprint,
    link_infos: infos,
    shard_count: shardCount,
  });

  return { cacheDir, vaultRoot, key, fingerprint };
}

/**
 * 이미 만든 픽스처 디렉터리에 **다른 vault의 meta**를 하나 더 놓는다.
 * 여러 vault가 캐시된 상황(잔재 포함)을 시험한다.
 */
export function addSiblingMeta(
  fx: Fixture,
  opts: {
    key: string;
    version: number;
    noteCount: number;
    vaultRoot: string;
    /** meta 파일 mtime을 이만큼(ms) 밀어 "더 최신"으로 만든다. */
    ageOffsetMs?: number;
  },
): void {
  const infos = Array.from({ length: opts.noteCount }, (_, i) => ({
    source_path: `${normalizeVaultArg(opts.vaultRoot)}/n${i}.md`,
    source_name: `n${i}`,
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
  }));
  const file = path.join(fx.cacheDir, `${opts.key}.meta.json.gz`);
  writeGz(file, {
    version: opts.version,
    fingerprint: "s1s1s1s1s1s1s1s1",
    link_infos: infos,
    shard_count: 1,
  });
  if (opts.ageOffsetMs !== undefined) {
    const t = new Date(statSync(file).mtimeMs + opts.ageOffsetMs);
    utimesSync(file, t, t);
  }
}

function writeGz(file: string, obj: unknown): void {
  writeFileSync(file, gzipSync(JSON.stringify(obj)));
}

const basename = (rel: string): string => rel.split("/").pop()!.replace(/\.md$/, "");

/** 판정 4문항을 축소 재현한 표준 픽스처. */
/**
 * 방금 쓴 vault 파일들의 `(rel, mtime, size)` — `fingerprintOf` 입력.
 *
 * 앱의 `walk_md_stats`와 같은 정규형이어야 한다: `rel`은 `/` 구분자, `mtime`은 **버림**한
 * 정수 ms, 정렬은 `rel` 오름차순.
 */
function fixtureEntries(
  vaultRoot: string,
  notes: FixtureNote[],
): { rel: string; mtimeMs: number; size: number }[] {
  return notes
    .map((n) => {
      const st = statSync(path.join(vaultRoot, n.rel));
      return { rel: normPath(n.rel), mtimeMs: Math.floor(st.mtimeMs), size: st.size };
    })
    .sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

export const SAMPLE_NOTES: FixtureNote[] = [
  {
    rel: "proj/adr/001-abandoned.md",
    title: "ADR-001 폐기 결정",
    doc_kind: "adr",
    topic: "graph",
    // 임의 frontmatter 축 테스트용 — 실측 vault 의 `status` 를 본떴다.
    props: { status: ["완료"] },
    body: "그래프 뷰를 폐기한다.",
  },
  {
    rel: "proj/adr/002-revived.md",
    doc_kind: "adr",
    topic: "graph",
    targets: ["001-abandoned"],
    related: { amends: ["001-abandoned"] },
    props: { status: ["진행 중"] },
    body: "ADR-001을 개정해 다시 도입한다.",
  },
  {
    rel: "proj/plans/rework.md",
    doc_kind: "plan",
    topic: "graph",
    related: { superseded_by: ["001-abandoned"] },
    body: "이 계획은 폐기됐다.",
  },
  {
    rel: "proj/solutions/tag-drift.md",
    title: "본문 태그는 안 잡힌다",
    doc_kind: "solution",
    topic: "tag-system",
    tags: ["issue/silent-failure", "subject/tags"],
    body: "규칙이 인덱서와 어긋나 태그 체계를 바꿨다. 그런데 그 태그는 아무 데도 안 들어간다.",
  },
  {
    rel: "proj/solutions/vitest-css.md",
    doc_kind: "solution",
    topic: "build",
    tags: ["tech/vitest"],
    body: "vitest에서 css raw 임포트는 빈 문자열이다.",
  },
  {
    rel: "_memories/2026-06/session-noise.md",
    body: "태그 체계 이야기를 잠깐 했다. vitest css raw 언급도 있다.",
  },
];
