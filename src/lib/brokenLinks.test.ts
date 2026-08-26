import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { findBrokenLinks, countBrokenLinks } from "./brokenLinks";
import type { LinkInfo } from "$lib/tauri/notes";

function note(partial: Partial<LinkInfo> & { source_path: string }): LinkInfo {
  return {
    source_name: partial.source_path.split("/").pop()!.replace(/\.md$/, ""),
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: {},
    ...partial,
  };
}

const index = (infos: LinkInfo[]) => buildIndex(infos);

describe("findBrokenLinks", () => {
  it("해소되는 링크는 보고하지 않는다", () => {
    const idx = index([
      note({ source_path: "/v/a.md", targets: ["b"] }),
      note({ source_path: "/v/b.md" }),
    ]);
    expect(findBrokenLinks(idx)).toEqual([]);
  });

  it("해소되지 않는 링크를 보고한다", () => {
    const idx = index([note({ source_path: "/v/a.md", targets: ["없는노트"] })]);
    const broken = findBrokenLinks(idx);
    expect(broken).toHaveLength(1);
    expect(broken[0].target).toBe("없는노트");
    expect(broken[0].sources.map((s) => s.path)).toEqual(["/v/a.md"]);
  });

  it("alias 표기는 target 쪽으로 판정한다", () => {
    // `[[없는것|보이는이름]]` — 끊긴 건 `없는것`이지 `보이는이름`이 아니다.
    const idx = index([note({ source_path: "/v/a.md", targets: ["없는것|보이는이름"] })]);
    expect(findBrokenLinks(idx)[0].target).toBe("없는것");
  });

  it("대소문자 무시로 해소한다 — resolver와 같은 정규형", () => {
    const idx = index([
      note({ source_path: "/v/a.md", targets: ["Target"] }),
      note({ source_path: "/v/target.md" }),
    ]);
    expect(findBrokenLinks(idx)).toEqual([]);
  });

  it("alias·title로도 해소된다 — 파일 stem만 보지 않는다", () => {
    const idx = index([
      note({ source_path: "/v/a.md", targets: ["별칭"] }),
      note({ source_path: "/v/b.md", aliases: ["별칭"] }),
    ]);
    expect(findBrokenLinks(idx)).toEqual([]);
  });

  it("같은 대상을 여러 노트가 가리키면 하나로 묶는다", () => {
    const idx = index([
      note({ source_path: "/v/a.md", targets: ["없음"] }),
      note({ source_path: "/v/b.md", targets: ["없음"] }),
    ]);
    const broken = findBrokenLinks(idx);
    expect(broken).toHaveLength(1);
    expect(broken[0].sources).toHaveLength(2);
  });

  it("한 노트가 같은 대상을 여러 번 가리켜도 한 번만 센다", () => {
    // 본문에 세 번 쓴 노트가 세 곳에서 참조된 것처럼 보이면 우선순위가 왜곡된다.
    const idx = index([note({ source_path: "/v/a.md", targets: ["없음", "없음", "없음"] })]);
    expect(findBrokenLinks(idx)[0].sources).toHaveLength(1);
  });

  it("참조 수 내림차순 — 위에서부터 고치는 게 효율 순이다", () => {
    const idx = index([
      note({ source_path: "/v/a.md", targets: ["드묾", "흔함"] }),
      note({ source_path: "/v/b.md", targets: ["흔함"] }),
      note({ source_path: "/v/c.md", targets: ["흔함"] }),
    ]);
    const broken = findBrokenLinks(idx);
    expect(broken.map((b) => b.target)).toEqual(["흔함", "드묾"]);
  });

  it("frontmatter는 감사하지 않는다 — 평범한 스칼라가 전부 잡힌다", () => {
    // `relations.ts`의 denylist는 allowlist가 아니라, 해소 실패가 곧 "관계 아님"이다.
    const idx = index([
      note({ source_path: "/v/a.md", props: { status: ["welcome"], priority: ["high"] } }),
    ]);
    expect(findBrokenLinks(idx)).toEqual([]);
  });

  it("표시 이름은 title 우선, 없으면 파일 stem", () => {
    const idx = index([
      note({ source_path: "/v/a.md", title: "제목 있음", targets: ["없음"] }),
      note({ source_path: "/v/b.md", targets: ["없음"] }),
    ]);
    const names = findBrokenLinks(idx)[0].sources.map((s) => s.name).sort();
    expect(names).toEqual(["b", "제목 있음"]);
  });
});

describe("countBrokenLinks", () => {
  it("대상 수가 아니라 링크 수를 센다", () => {
    const idx = index([
      note({ source_path: "/v/a.md", targets: ["x", "y"] }),
      note({ source_path: "/v/b.md", targets: ["x"] }),
    ]);
    const broken = findBrokenLinks(idx);
    expect(broken).toHaveLength(2);       // 대상 x, y
    expect(countBrokenLinks(broken)).toBe(3); // 링크 a→x, b→x, a→y
  });
});
