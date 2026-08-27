import { describe, it, expect } from "vitest";
import { parseNote } from "./markdown";
import {
  EMBED_MAX_DEPTH,
  embedFailureText,
  isCycle,
  sliceSection,
} from "./embed";

/**
 * 트랜스클루전 — `![[노트]]` · `![[노트#헤딩]]`.
 *
 * #246에서 앵커 해소를 만들었고, 임베드는 그 위에 얹힌다.
 *
 * ⚠️ 이 파일은 **규칙과 파싱**만 본다. 채우기는 표면마다 다르다(앱은 DOM, CLI는 문자열).
 */

const html = (src: string) => parseNote(src).html;

describe("문법", () => {
  it("`![[노트]]` 를 자리표시자로 만든다", () => {
    const out = html("![[대상]]");
    expect(out).toContain('class="embed"');
    expect(out).toContain('data-embed-target="대상"');
    expect(out).not.toContain("data-embed-anchor");
  });

  it("앵커를 따로 담는다", () => {
    const out = html("![[대상#어떤 헤딩]]");
    expect(out).toContain('data-embed-target="대상"');
    expect(out).toContain('data-embed-anchor="어떤 헤딩"');
  });

  /** 별칭은 표시 텍스트라 임베드에는 뜻이 없다. */
  it("별칭을 버린다", () => {
    expect(html("![[대상|보이는 이름]]")).toContain('data-embed-target="대상"');
  });

  /**
   * ⚠️ **채우기가 안 돌아도 무엇이 안 됐는지 보여야 한다.** 빈 네모가 남으면 원래
   * 거기 뭐가 있었는지 알 길이 없다.
   */
  it("자리표시자 안에 원문을 남긴다", () => {
    expect(html("![[대상#헤딩]]")).toContain("![[대상#헤딩]]");
  });

  /**
   * ⚠️ **위키링크보다 먼저 잡아야 한다.** `![[x]]` 안에 `[[x]]` 가 들어 있어서, 순서가
   * 뒤집히면 `!` 만 글자로 남고 나머지가 평범한 링크가 된다 — 임베드가 조용히 링크로
   * 바뀐다.
   */
  it("임베드가 위키링크로 새지 않는다", () => {
    const out = html("![[대상]]");
    expect(out).not.toContain('class="wikilink"');
  });

  it("느낌표 없는 것은 그대로 위키링크다", () => {
    const out = html("[[대상]]");
    expect(out).toContain('class="wikilink"');
    expect(out).not.toContain('class="embed"');
  });

  /** 코드 안의 예시가 자리표시자가 되면 문서로 설명을 못 쓴다. */
  it("인라인 코드 안은 건드리지 않는다", () => {
    expect(html("`![[대상]]`")).not.toContain('class="embed"');
  });

  it("코드 펜스 안도 건드리지 않는다", () => {
    expect(html("```\n![[대상]]\n```")).not.toContain('class="embed"');
  });

  /** 이미지 문법과 헷갈리지 않는다. */
  it("마크다운 이미지는 그대로다", () => {
    const out = html("![대체](a.png)");
    expect(out).toContain("<img");
    expect(out).not.toContain('class="embed"');
  });
});

describe("sliceSection", () => {
  const BODY = [
    "# 제목",
    "머리말",
    "",
    "## 둘째",
    "둘째 본문",
    "",
    "### 둘째의 하위",
    "하위 본문",
    "",
    "## 셋째",
    "셋째 본문",
  ].join("\n");
  const HEADINGS = parseNote(BODY).headings;

  it("헤딩부터 같은 레벨의 다음 헤딩 앞까지", () => {
    const out = sliceSection(BODY, HEADINGS, "둘째");
    expect(out).toContain("둘째 본문");
    // ⚠️ 하위 헤딩은 **포함**한다 — 그게 그 절의 내용이다.
    expect(out).toContain("하위 본문");
    expect(out).not.toContain("셋째 본문");
  });

  /** 헤딩 줄 자체를 넣는다 — 빼면 어디서 온 조각인지 모른다. */
  it("헤딩 줄을 포함한다", () => {
    expect(sliceSection(BODY, HEADINGS, "둘째")?.startsWith("## 둘째")).toBe(true);
  });

  it("마지막 절은 끝까지", () => {
    expect(sliceSection(BODY, HEADINGS, "셋째")).toContain("셋째 본문");
  });

  it("문서 전체를 무는 헤딩도 된다", () => {
    const out = sliceSection(BODY, HEADINGS, "제목");
    expect(out).toContain("셋째 본문");
  });

  /** ⚠️ 없으면 null 이다. 통째로 가져오면 사용자가 오타를 눈치 못 챈다. */
  it("없는 헤딩은 null", () => {
    expect(sliceSection(BODY, HEADINGS, "없는헤딩")).toBeNull();
  });

  it("헤딩 글자 그대로 찾는다 (slug 아님)", () => {
    expect(sliceSection(BODY, HEADINGS, "둘째의 하위")).toContain("하위 본문");
  });
});

describe("순환과 깊이", () => {
  /** ⚠️ 체인 기준이다 — 한 문서가 같은 노트를 두 군데서 임베드하는 것은 정상이다. */
  it("체인에 있으면 순환", () => {
    expect(isCycle(["/a.md", "/b.md"], "/a.md")).toBe(true);
    expect(isCycle(["/a.md"], "/b.md")).toBe(false);
    expect(isCycle([], "/a.md")).toBe(false);
  });

  it("깊이 상한이 있다", () => {
    expect(EMBED_MAX_DEPTH).toBeGreaterThan(0);
  });

  /** ⚠️ 실패는 **이름과 함께** 보인다. 빈 자리로 두면 문장이 끊긴 것을 못 알아챈다. */
  it("실패마다 다른 문구가 있고 대상 이름이 들어간다", () => {
    const kinds = ["unresolved", "cycle", "too-deep", "no-section"] as const;
    const texts = kinds.map((k) => embedFailureText(k, "대상"));
    expect(new Set(texts).size).toBe(kinds.length);
    for (const t of texts) expect(t).toContain("대상");
  });
});
