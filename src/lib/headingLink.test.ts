import { describe, it, expect } from "vitest";
import { headingLinkFor } from "./headingLink";

/**
 * 헤딩 링크 만들기.
 *
 * ## 🔴 깨진 링크를 주는 것보다 안 주는 것이 낫다
 *
 * 위키링크에 `]]` · `|` · `#` 가 섞이면 문법이 거기서 끊긴다. **에러는 안 나고** 엉뚱한
 * 자리로 가거나 아예 안 걸린다 — 붙여넣은 사람은 한참 뒤에야 안다.
 */

describe("만든다", () => {
  it("경로에서 이름만 쓴다", () => {
    expect(headingLinkFor("/v/knowledge/lapis/STATE.md", "현재")).toBe("[[STATE#현재]]");
  });

  it("확장자를 뗀다", () => {
    expect(headingLinkFor("/v/a.mmd", "머리말")).toBe("[[a#머리말]]");
  });

  it("공백을 다듬는다", () => {
    expect(headingLinkFor("/v/a.md", "  띄어쓰기  ")).toBe("[[a#띄어쓰기]]");
  });

  it("헤딩 안의 공백은 남긴다 — slug 는 해소하는 쪽이 만든다", () => {
    expect(headingLinkFor("/v/a.md", "두 낱말")).toBe("[[a#두 낱말]]");
  });
});

describe("만들 수 없으면 null", () => {
  it("빈 헤딩", () => {
    expect(headingLinkFor("/v/a.md", "")).toBeNull();
    expect(headingLinkFor("/v/a.md", "   ")).toBeNull();
  });

  it("빈 경로", () => {
    expect(headingLinkFor("", "가")).toBeNull();
  });

  /** 🔴 `]]` 가 링크를 거기서 끊는다. */
  it("헤딩에 닫는 괄호가 있으면", () => {
    expect(headingLinkFor("/v/a.md", "배열 x]] 끝")).toBeNull();
  });

  /** 🔴 `|` 는 위키링크의 별칭 구분자다. */
  it("헤딩에 파이프가 있으면", () => {
    expect(headingLinkFor("/v/a.md", "a | b")).toBeNull();
  });

  /** 🔴 `#` 는 헤딩 구분자다 — 또 있으면 어디서 끊길지 알 수 없다. */
  it("헤딩에 샵이 있으면", () => {
    expect(headingLinkFor("/v/a.md", "C# 이야기")).toBeNull();
  });

  it("노트 이름에 샵이나 파이프가 있으면", () => {
    expect(headingLinkFor("/v/C#.md", "가")).toBeNull();
    expect(headingLinkFor("/v/a|b.md", "가")).toBeNull();
  });
});
