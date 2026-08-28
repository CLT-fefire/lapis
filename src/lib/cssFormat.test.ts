import { describe, it, expect } from "vitest";
import { formatCss, CssFormatError } from "./cssFormat";

/**
 * 사용자 정의 CSS 포매팅 — **테스트가 0이었다.**
 *
 * ⚠️ 이건 **사용자가 쓴 것을 고쳐 쓰는** 함수다. 조용히 틀리면 사용자의 CSS 가 망가진다.
 * 특히 경계 둘이 위험하다:
 *
 * - **빈 입력** — prettier 는 개행 하나를 돌려준다. 그대로 두면 "저장 안 했는데 내용이
 *   바뀐" 상태가 되어 편집기가 dirty 로 보이고, 사용자는 뭘 바꿨는지 모른다.
 * - **파싱 실패** — 던져야 오류 표시가 된다. 원본을 조용히 돌려주면 "정돈했는데 아무
 *   일도 안 일어났다"가 된다.
 */

describe("정돈", () => {
  it("뭉개진 CSS 를 편다", async () => {
    const out = await formatCss("a{color:red}");
    expect(out).toContain("\n");
    expect(out).toMatch(/color:\s*red/);
  });

  /** ⚠️ 끝 개행을 안 다듬으면 저장값과 편집값이 매번 달라져 dirty 로 남는다. */
  it("끝에 개행을 안 남긴다", async () => {
    const out = await formatCss("a{color:red}");
    expect(out.endsWith("\n")).toBe(false);
  });

  /** 이미 정돈된 것을 다시 넣어도 그대로여야 한다 — 아니면 누를 때마다 dirty 가 된다. */
  it("멱등이다", async () => {
    const once = await formatCss("a{color:red}");
    expect(await formatCss(once)).toBe(once);
  });

  it("여러 규칙을 다 편다", async () => {
    const out = await formatCss("a{color:red}b{color:blue}");
    expect(out).toMatch(/color:\s*red/);
    expect(out).toMatch(/color:\s*blue/);
  });

  it("주석을 지우지 않는다", async () => {
    expect(await formatCss("/* 남겨야 한다 */\na{color:red}")).toContain("남겨야 한다");
  });
});

describe("빈 입력", () => {
  it("빈 문자열을 낸다 — 개행 하나가 아니다", async () => {
    expect(await formatCss("")).toBe("");
  });

  it("공백만이어도 빈 문자열", async () => {
    expect(await formatCss("   \n\n  ")).toBe("");
  });
});

describe("파싱 실패", () => {
  /** ⚠️ 조용히 원본을 돌려주면 "정돈했는데 아무 일도 안 일어났다"가 된다. */
  it("깨진 CSS 는 던진다", async () => {
    await expect(formatCss("a{color:red")).rejects.toBeInstanceOf(CssFormatError);
  });

  it("메시지가 비어 있지 않다 — 화면에 그대로 보인다", async () => {
    try {
      await formatCss("a{{{");
      expect.unreachable("던졌어야 한다");
    } catch (e) {
      expect(e).toBeInstanceOf(CssFormatError);
      expect((e as Error).message.length).toBeGreaterThan(0);
    }
  });

  /**
   * ⚠️ **파싱은 되는데 뜻이 없는 것은 안 잡는다.** 브라우저도 조용히 무시하는 것이고,
   * 사용자 CSS 에서는 그게 맞는 동작이다 — 여기가 린터가 되면 안 된다.
   */
  it("오타 속성은 통과시킨다", async () => {
    expect(await formatCss("a{colr:red}")).toMatch(/colr/);
  });
});
