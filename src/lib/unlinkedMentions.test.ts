import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { findUnlinkedMentions, maskNonProse, MIN_MENTION_LENGTH } from "./vaultAudit";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 링크 안 걸린 언급 — **오탐을 막는 규칙들**이 이 기능의 전부다.
 *
 * 조사한 사례(Obsidian)에서 알려진 약점이 정확히 오탐이었다: 제목 정확 일치로 잡으면 큰
 * vault에서 무관한 제안이 쏟아지고, **목록이 시끄러우면 아무도 안 본다.** 그러면 만든
 * 의미가 없다.
 *
 * 그래서 이 테스트의 대부분은 "무엇을 찾나"가 아니라 **"무엇을 안 찾나"** 다.
 */

const mk = (path: string, extra: Partial<LinkInfo> = {}): LinkInfo => {
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
};

const run = (infos: LinkInfo[], bodies: Record<string, string>) =>
  findUnlinkedMentions(buildIndex(infos), new Map(Object.entries(bodies)));

/** 결과를 읽기 쉬운 모양으로 — `target → [출처…]`. */
const shape = (rows: ReturnType<typeof findUnlinkedMentions>) =>
  rows.map((r) => `${r.name} ← ${r.sources.map((s) => s.path).join(",")}`);

describe("찾는 것", () => {
  it("다른 노트 이름을 링크 없이 말한 곳을 찾는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/설계.md": "여기서 캐시 계약 을 따른다.", "/v/캐시 계약.md": "본문" },
    );
    expect(shape(out)).toEqual(["캐시 계약 ← /v/설계.md"]);
  });

  it("한 대상에 여러 출처를 묶는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/a.md"), mk("/v/b.md")],
      { "/v/캐시 계약.md": "x", "/v/a.md": "캐시 계약 참고", "/v/b.md": "캐시 계약 도" },
    );
    expect(out).toHaveLength(1);
    expect(out[0].sources.map((s) => s.path)).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("frontmatter title 과 alias 도 이름으로 본다", () => {
    const out = run(
      [
        mk("/v/note-a.md", { title: "캐시 계약", aliases: ["캐시규약"] }),
        mk("/v/설계.md"),
      ],
      { "/v/note-a.md": "x", "/v/설계.md": "캐시규약 을 본다" },
    );
    expect(shape(out)).toEqual(["캐시규약 ← /v/설계.md"]);
  });

  /** 결정성 — 같은 입력이면 같은 순서. 인덱스가 담긴 순서에 흔들리면 안 된다. */
  it("대상은 이름 오름차순, 출처는 경로 오름차순", () => {
    const out = run(
      [mk("/v/zulu.md"), mk("/v/alpha.md"), mk("/v/z.md"), mk("/v/a.md")],
      {
        "/v/zulu.md": "x", "/v/alpha.md": "x",
        "/v/z.md": "zulu 와 alpha", "/v/a.md": "alpha 와 zulu",
      },
    );
    expect(out.map((r) => r.name)).toEqual(["alpha", "zulu"]);
    expect(out[0].sources.map((s) => s.path)).toEqual(["/v/a.md", "/v/z.md"]);
  });
});

describe("⚠️ 안 찾는 것 — 오탐 방지", () => {
  /**
   * **가장 큰 오탐원.** 후보가 둘 이상인 이름은 어느 노트를 말한 건지 모른다.
   * #220에서 링크 해소가 같은 규칙으로 거부한다 — 여기도 같아야 한다.
   */
  it("모호한 이름은 제안하지 않는다", () => {
    const out = run(
      [mk("/v/x/공통.md"), mk("/v/y/공통.md"), mk("/v/설계.md")],
      { "/v/x/공통.md": "a", "/v/y/공통.md": "b", "/v/설계.md": "공통 이야기" },
    );
    expect(out).toEqual([]);
  });

  it("짧은 이름은 제안하지 않는다", () => {
    const short = "가".repeat(MIN_MENTION_LENGTH - 1);
    const out = run(
      [mk(`/v/${short}.md`), mk("/v/설계.md")],
      { [`/v/${short}.md`]: "x", "/v/설계.md": `${short} 이야기` },
    );
    expect(out).toEqual([]);
  });

  it("자기 이름을 쓴 것은 언급이 아니다", () => {
    const out = run([mk("/v/캐시 계약.md")], { "/v/캐시 계약.md": "캐시 계약 은 …" });
    expect(out).toEqual([]);
  });

  it("이미 링크된 자리는 세지 않는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "[[캐시 계약]] 과 [캐시 계약](./x.md)" },
    );
    expect(out).toEqual([]);
  });

  /** `state`가 변수명일 뿐인 경우 — 코드에서 잡으면 목록이 코드로 뒤덮인다. */
  it("코드펜스 안은 세지 않는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "```\n캐시 계약\n```\n" },
    );
    expect(out).toEqual([]);
  });

  it("인라인 코드 안도 세지 않는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "`캐시 계약` 이라는 이름" },
    );
    expect(out).toEqual([]);
  });

  /** `title: 캐시 계약`이 자기 언급으로 잡히면 모든 노트가 자기를 언급한 게 된다. */
  it("frontmatter 안은 세지 않는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      {
        "/v/캐시 계약.md": "x",
        "/v/설계.md": "---\nrelated: 캐시 계약\n---\n\n본문",
      },
    );
    expect(out).toEqual([]);
  });

  /** `한글`이 `한글날` 안에 있는 것은 언급이 아니다. */
  it("단어 중간에 박힌 것은 세지 않는다", () => {
    const out = run(
      [mk("/v/한글.md"), mk("/v/설계.md")],
      { "/v/한글.md": "x", "/v/설계.md": "한글날 은 공휴일" },
    );
    expect(out).toEqual([]);
  });
});

describe("⚠️ 한국어 조사 — 지금은 못 잡는다", () => {
  /**
   * 단어 경계 규칙 때문에 조사가 붙은 형태(`캐시 계약을`)는 안 잡힌다.
   *
   * **이건 알고 넘어가는 한계다.** 놓침은 조용하지만 해롭지 않고, 조사 목록은 손으로
   * 유지하는 사전이라 이 저장소가 두 번 거절한 부류다(동의어 사전 · 단수/복수 정규화).
   *
   * 이 테스트는 그 한계를 **박제한다** — 나중에 조사를 지원하면 여기가 빨개져서,
   * 결정이 바뀐 것을 아무도 모르고 지나가지 않는다.
   */
  it("조사가 붙으면 못 잡는다 (알려진 한계)", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "캐시 계약을 따른다" },
    );
    expect(out, "조사 지원을 넣었다면 이 테스트와 계획서를 같이 고쳐라").toEqual([]);
  });

  it("띄어 쓰면 잡는다 — 영어와 같은 경로", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "캐시 계약 을 따른다" },
    );
    expect(out).toHaveLength(1);
  });
});

describe("긴 이름 우선", () => {
  /**
   * ⚠️ 정규식 교대는 **왼쪽 우선**이다. 짧은 이름이 앞에 있으면 긴 이름이 영영 안 잡힌다 —
   * `검색`이 `검색 캐시 계약`을 가려 버린다.
   */
  it("겹치는 이름 중 긴 쪽을 잡는다", () => {
    const out = run(
      [mk("/v/검색.md"), mk("/v/검색 캐시 계약.md"), mk("/v/설계.md")],
      { "/v/검색.md": "x", "/v/검색 캐시 계약.md": "y", "/v/설계.md": "검색 캐시 계약 참고" },
    );
    expect(out.map((r) => r.name)).toEqual(["검색 캐시 계약"]);
  });
});

describe("결과 모양", () => {
  it("줄 번호와 미리보기를 담는다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "머리말\n\n여기서 캐시 계약 을 따른다.\n" },
    );
    expect(out[0].sources[0].line).toBe(3);
    expect(out[0].sources[0].preview).toContain("캐시 계약");
  });

  it("한 노트가 같은 이름을 여러 번 말하면 건수로 센다", () => {
    const out = run(
      [mk("/v/캐시 계약.md"), mk("/v/설계.md")],
      { "/v/캐시 계약.md": "x", "/v/설계.md": "캐시 계약 하나\n캐시 계약 둘" },
    );
    expect(out[0].sources).toHaveLength(1);
    expect(out[0].sources[0].count).toBe(2);
  });
});

describe("⚠️ 이미 연결된 노트 — 실측으로 찾은 오탐", () => {
  /**
   * 실제 vault에서 나온 5건 중 **3건이 이 모양**이었다. 링크는 파일 이름으로 걸고
   * 설명은 제목으로 쓴 줄 — 링크된 자리는 덮이지만 바로 옆 제목은 안 덮인다.
   */
  it("같은 줄에서 파일 이름으로 링크하고 제목으로 부른 것", () => {
    const out = run(
      [
        mk("/v/cache.md", { title: "캐시 계약" }),
        mk("/v/설계.md", { targets: ["cache"] }),
      ],
      { "/v/cache.md": "x", "/v/설계.md": "- [[cache]] — 캐시 계약" },
    );
    expect(out).toEqual([]);
  });

  /** 간선이 이미 있으면 어느 줄에서 다시 말하든 그래프는 이어져 있다. */
  it("멀리 떨어진 줄에서 말해도 마찬가지다 — 줄이 아니라 노트 단위로 본다", () => {
    const out = run(
      [
        mk("/v/cache.md", { title: "캐시 계약" }),
        mk("/v/설계.md", { targets: ["cache"] }),
      ],
      { "/v/cache.md": "x", "/v/설계.md": "[[cache]]\n\n한참 뒤에 캐시 계약 이야기" },
    );
    expect(out).toEqual([]);
  });

  /** frontmatter 관계도 연결이다 — 백링크 인덱스에는 안 잡힌다(Phase A-2). */
  it("frontmatter 로 선언한 관계도 연결로 본다", () => {
    const out = run(
      [
        mk("/v/cache.md", { title: "캐시 계약" }),
        mk("/v/설계.md", { props: { related: ["cache"] } }),
      ],
      { "/v/cache.md": "x", "/v/설계.md": "캐시 계약 이야기" },
    );
    expect(out).toEqual([]);
  });

  it("연결이 없으면 그대로 잡는다 — 위 셋이 통째로 죽은 게 아님을 본다", () => {
    const out = run(
      [mk("/v/cache.md", { title: "캐시 계약" }), mk("/v/설계.md")],
      { "/v/cache.md": "x", "/v/설계.md": "캐시 계약 이야기" },
    );
    expect(out).toHaveLength(1);
  });
});

describe("⚠️ 마스킹은 길이를 보존한다", () => {
  /**
   * 줄 번호는 **원본 오프셋**으로 센다. 마스킹이 길이를 바꾸면 예외 없이 조용히
   * 어긋난 줄을 가리킨다 — 그럴듯해서 아무도 못 알아챈다.
   */
  const CASES = [
    "---\ntitle: x\n---\n\n본문",
    "앞\n```ts\ncode()\n```\n뒤",
    "인라인 `code` 뒤",
    "[[wiki]] 와 [텍스트](./a.md)",
    "닫히지 않은 ```펜스\n다음 줄",
    "",
  ];
  for (const c of CASES) {
    it(`길이·줄수 보존: ${JSON.stringify(c).slice(0, 32)}`, () => {
      const m = maskNonProse(c);
      expect(m.length).toBe(c.length);
      expect(m.split("\n")).toHaveLength(c.split("\n").length);
    });
  }
});

describe("⚠️ 자기 제목 줄 — 실측으로 찾은 세 번째 오탐", () => {
  /**
   * 두 프로젝트가 같은 개념을 각자 문서로 두면 **제목이 겹친다.** 그때 한쪽의 h1 이
   * 다른 쪽의 title 과 같은 낱말이 되고, 감사는 그걸 "남을 언급했다"고 읽는다.
   *
   * 실측: slate 의 `autonomous-loop` 은 frontmatter title 이 다른데 h1 이 lapis 쪽 title 과
   * 같았다. 자기 제목 줄이 남의 언급으로 잡혔다.
   */
  it("본문 첫 h1 은 언급이 아니다", () => {
    const out = run(
      [mk("/v/대상.md", { title: "어떤 개념" }), mk("/v/여기.md", { title: "다른 제목" })],
      { "/v/대상.md": "x", "/v/여기.md": "# 어떤 개념\n\n본문" },
    );
    expect(out).toEqual([]);
  });

  /** ⚠️ 본문에서 진짜로 말하면 여전히 잡는다 — 위 규칙이 통째로 죽이면 안 된다. */
  it("h1 이 아닌 곳에서 말하면 잡는다", () => {
    const out = run(
      [mk("/v/대상.md", { title: "어떤 개념" }), mk("/v/여기.md")],
      { "/v/대상.md": "x", "/v/여기.md": "# 다른 제목\n\n어떤 개념 을 참고" },
    );
    expect(out).toHaveLength(1);
  });

  /** h2 이하는 절 제목이라 남을 가리킬 수 있다. */
  it("h2 는 덮지 않는다", () => {
    const out = run(
      [mk("/v/대상.md", { title: "어떤 개념" }), mk("/v/여기.md")],
      { "/v/대상.md": "x", "/v/여기.md": "# 제목\n\n## 어떤 개념\n본문" },
    );
    expect(out).toHaveLength(1);
  });
});
