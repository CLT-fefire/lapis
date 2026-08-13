/**
 * 테스트 픽스처 — 작은 v7 캐시를 임시 디렉터리에 만든다.
 *
 * 라이브 앱 상태에 의존하지 않는다. 실제 캐시로 테스트하면 ⓐ 앱이 언제든 재빌드해서
 * fingerprint가 바뀌고 ⓑ 19,000노트라 느리고 ⓒ 개인 문서 내용이 단정문에 박힌다.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import MiniSearch from "minisearch";
import { FULLTEXT_OPTIONS, type FullTextDoc, type LinkInfo } from "./entry.ts";
import { CACHE_VERSION } from "./cache.ts";

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
  const vaultRoot = opts.vaultRoot ?? path.join(cacheDir, "vault");
  const key = "fixturekey000001";
  const fingerprint = opts.fingerprint ?? "f1f1f1f1f1f1f1f1";

  const stemToAbs = new Map<string, string>();
  for (const n of notes) stemToAbs.set(basename(n.rel), `${vaultRoot}/${n.rel}`);

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
    props: Object.fromEntries(
      Object.entries(n.related ?? {}).map(([field, vals]) => [field, vals]),
    ),
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

  const shardCount = opts.shardCount ?? 1;
  const writeShards = opts.writeShards ?? shardCount;
  for (let i = 0; i < writeShards; i++) {
    const docs: FullTextDoc[] = notes
      .filter((_, idx) => idx % Math.max(1, shardCount) === i)
      .map((n) => ({ id: `${vaultRoot}/${n.rel}`, name: basename(n.rel), body: n.body }));
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
  opts: { key: string; version: number; noteCount: number; vaultRoot: string },
): void {
  const infos = Array.from({ length: opts.noteCount }, (_, i) => ({
    source_path: `${opts.vaultRoot}/n${i}.md`,
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
  writeGz(path.join(fx.cacheDir, `${opts.key}.meta.json.gz`), {
    version: opts.version,
    fingerprint: "s1s1s1s1s1s1s1s1",
    link_infos: infos,
    shard_count: 1,
  });
}

function writeGz(file: string, obj: unknown): void {
  writeFileSync(file, gzipSync(JSON.stringify(obj)));
}

const basename = (rel: string): string => rel.split("/").pop()!.replace(/\.md$/, "");

/** 판정 4문항을 축소 재현한 표준 픽스처. */
export const SAMPLE_NOTES: FixtureNote[] = [
  {
    rel: "proj/adr/001-abandoned.md",
    title: "ADR-001 폐기 결정",
    doc_kind: "adr",
    topic: "graph",
    body: "그래프 뷰를 폐기한다.",
  },
  {
    rel: "proj/adr/002-revived.md",
    doc_kind: "adr",
    topic: "graph",
    targets: ["001-abandoned"],
    related: { amends: ["001-abandoned"] },
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
