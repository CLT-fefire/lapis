import { describe, it, expect } from "vitest";
import { buildIndex, buildIndexChunked } from "./linkIndex";
import type { LinkInfo } from "$lib/tauri/notes";

function mkInfo(path: string, extra: Partial<LinkInfo> = {}): LinkInfo {
  const segs = path.split("/").filter(Boolean);
  return {
    source_path: path,
    source_name: (segs[segs.length - 1] ?? path).replace(/\.md$/i, ""),
    title: null,
    aliases: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    targets: [],
    props: {},
    ...extra,
  };
}

describe("buildIndexChunked ≡ buildIndex", () => {
  // 청크 버전(프로덕션, main thread freeze 방지용)이 sync 버전과 동일한 결과를 내야 한다.
  // sync는 테스트가 검증하므로, 동치만 잠그면 청크 버전도 안전.
  it("produces an identical index (resolver/backlinks/relations)", async () => {
    const infos: LinkInfo[] = [
      mkInfo("/v/a.md", {
        title: "Alpha",
        aliases: ["al"],
        targets: ["beta", "gamma"],
        props: { related: ["b"], parent_plan: ["c"] },
      }),
      mkInfo("/v/b.md", { title: "Beta", targets: ["alpha"] }),
      mkInfo("/v/c.md", { aliases: ["gamma"], props: { depends_on: ["a"] } }),
    ];

    const sync = buildIndex(infos);
    const chunked = await buildIndexChunked(infos);

    expect(chunked.byPath).toEqual(sync.byPath);
    expect(chunked.resolver).toEqual(sync.resolver);
    expect(chunked.backlinks).toEqual(sync.backlinks);
    expect(chunked.relations.outgoing).toEqual(sync.relations.outgoing);
    expect(chunked.relations.incoming).toEqual(sync.relations.incoming);
  });

  it("matches on empty input", async () => {
    expect(await buildIndexChunked([])).toEqual(buildIndex([]));
  });

  it("matches across a chunk-yield boundary (>yieldEvery notes)", async () => {
    // buildRelationIndexChunked yieldEvery=1500 → 그 경계를 넘겨도 동일해야.
    const infos = Array.from({ length: 1600 }, (_, i) =>
      mkInfo(`/v/n${i}.md`, {
        targets: i > 0 ? [`n${i - 1}`] : [],
        props: i % 2 === 0 ? { related: [`n${(i + 1) % 1600}`] } : {},
      }),
    );
    const sync = buildIndex(infos);
    const chunked = await buildIndexChunked(infos);
    expect(chunked.backlinks).toEqual(sync.backlinks);
    expect(chunked.relations.outgoing).toEqual(sync.relations.outgoing);
    expect(chunked.relations.incoming).toEqual(sync.relations.incoming);
  });
});
