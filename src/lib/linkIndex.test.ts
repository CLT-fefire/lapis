import { describe, it, expect } from "vitest";
import { buildIndex, buildIndexChunked, resolveTarget } from "./linkIndex";
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

/**
 * 같은 이름의 노트가 둘 이상일 때 어느 것으로 해소되나.
 *
 * ## 무엇이 틀렸었나
 *
 * `resolver`가 평평한 전역 Map(이름 → 경로 하나)이고 **먼저 넣은 것이 이겼다.** 순서는
 * vault walk 순서라, `knowledge/lapis/`가 `knowledge/slate/`보다 먼저 온다는 이유만으로
 * slate 문서의 `[[feature-map]]`이 **lapis 문서로** 갔다.
 *
 * 링크가 깨진 게 아니라 엉뚱한 곳으로 간다 — 조용한 쪽이다. 실측: 고아 8건 중 6건이
 * slate였고, 그건 안 엮여서가 아니라 이름을 뺏겨서였다.
 *
 * ## 규칙
 *
 * **티어(alias > title > stem) → 같은 티어 안에서 가장 가까운 것 → 경로 오름차순.**
 *
 * ⚠️ 티어가 먼저인 이유는 **기존 동작 보존**이다. alias는 사람이 일부러 단 이름이고,
 * 충돌이 없던 vault에서도 alias와 stem이 겹칠 수 있다. 근접을 티어보다 앞에 두면
 * 그런 vault의 링크가 조용히 다른 곳을 가리키게 된다.
 */
describe("이름 충돌 해소", () => {
  const twoProjects = [
    mkInfo("/v/k/lapis/ref/feature-map.md", { title: "Lapis 기능 지도" }),
    mkInfo("/v/k/slate/ref/feature-map.md", { title: "Slate 기능 지도" }),
    mkInfo("/v/k/slate/ref/editor.md", { targets: ["feature-map"] }),
    mkInfo("/v/k/lapis/ref/ipc.md", { targets: ["feature-map"] }),
  ];

  it("링크한 노트와 같은 프로젝트의 것을 고른다", () => {
    const idx = buildIndex(twoProjects);
    expect(resolveTarget("feature-map", idx, "/v/k/slate/ref/editor.md")).toBe(
      "/v/k/slate/ref/feature-map.md",
    );
    expect(resolveTarget("feature-map", idx, "/v/k/lapis/ref/ipc.md")).toBe(
      "/v/k/lapis/ref/feature-map.md",
    );
  });

  it("백링크가 제 프로젝트로 간다", () => {
    const idx = buildIndex(twoProjects);
    expect([...(idx.backlinks.get("/v/k/slate/ref/feature-map.md") ?? [])]).toEqual([
      "/v/k/slate/ref/editor.md",
    ]);
    expect([...(idx.backlinks.get("/v/k/lapis/ref/feature-map.md") ?? [])]).toEqual([
      "/v/k/lapis/ref/ipc.md",
    ]);
  });

  /** 새는 곳이 여기였다 — slate 문서 9개의 `related`가 전부 lapis로 갔다. */
  it("프론트매터 related도 같은 규칙을 탄다", () => {
    const idx = buildIndex([
      mkInfo("/v/k/lapis/ref/feature-map.md"),
      mkInfo("/v/k/slate/ref/feature-map.md"),
      mkInfo("/v/k/slate/STATE.md", { props: { related: ["feature-map"] } }),
    ]);
    const incoming = idx.relations.incoming.get("/v/k/slate/ref/feature-map.md") ?? [];
    expect(incoming.map((r) => r.path)).toEqual(["/v/k/slate/STATE.md"]);
    expect(idx.relations.incoming.get("/v/k/lapis/ref/feature-map.md") ?? []).toEqual([]);
  });

  /** ⚠️ 기존 동작 보존 — 근접이 티어를 이기면 안 된다. */
  it("alias가 더 먼 곳에 있어도 stem을 이긴다", () => {
    const idx = buildIndex([
      mkInfo("/v/far/away.md", { aliases: ["foo"] }),
      mkInfo("/v/near/foo.md"),
    ]);
    expect(resolveTarget("foo", idx, "/v/near/here.md")).toBe("/v/far/away.md");
  });

  it("거리가 같으면 경로 오름차순", () => {
    const idx = buildIndex([mkInfo("/v/b/dup.md"), mkInfo("/v/a/dup.md")]);
    expect(resolveTarget("dup", idx, "/v/z/from.md")).toBe("/v/a/dup.md");
  });

  it("충돌이 없으면 fromPath와 무관하게 같은 답", () => {
    const idx = buildIndex([mkInfo("/v/x/only.md"), mkInfo("/v/y/other.md")]);
    for (const from of ["/v/x/a.md", "/v/y/b.md", "/v/deep/c/d.md"]) {
      expect(resolveTarget("only", idx, from)).toBe("/v/x/only.md");
    }
  });

  it("없는 이름은 여전히 null", () => {
    const idx = buildIndex([mkInfo("/v/x/only.md")]);
    expect(resolveTarget("nope", idx, "/v/x/a.md")).toBeNull();
  });
});
