import { describe, it, expect } from "vitest";
import { computeReplacePreview, ReplacePatternError } from "./replacePlan";

const notes = (o: Record<string, string>) => new Map(Object.entries(o));

describe("리터럴 치환", () => {
  it("바뀐 파일만 낸다", () => {
    const p = computeReplacePreview(
      notes({ "/v/a.md": "창을 열다", "/v/b.md": "관계없음" }),
      "창",
      "윈도우",
      { regex: false },
    );
    expect(p.items.map((i) => i.path)).toEqual(["/v/a.md"]);
    expect(p.items[0].newContent).toBe("윈도우을 열다");
    expect(p.totalOccurrences).toBe(1);
  });

  it("한 파일 안의 모든 매치를 바꾼다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "a b a b a" }), "a", "X", {
      regex: false,
    });
    expect(p.items[0].newContent).toBe("X b X b X");
    expect(p.items[0].occurrences).toBe(3);
  });

  /**
   * ⚠️ **리터럴 모드에서 `$`는 글자다.** JS `String.replace`는 치환문의 `$&` · `$1` ·
   * `$$`를 특수 문자로 읽는다. 이스케이프하지 않으면 "리터럴로 바꿨는데 매치가 끼어드는"
   * 결과가 나온다 — 조용히 틀리는 부류다.
   */
  it("리터럴 모드에서 치환문의 $ 를 글자로 다룬다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "값: X" }), "X", "$& 원가 $1 $$", {
      regex: false,
    });
    expect(p.items[0].newContent).toBe("값: $& 원가 $1 $$");
  });

  it("리터럴 모드에서 패턴의 정규식 문자도 글자다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "a.c abc" }), "a.c", "Z", {
      regex: false,
    });
    // `.`이 임의 문자면 `abc`도 바뀐다. 리터럴이므로 `a.c`만 바뀌어야 한다.
    expect(p.items[0].newContent).toBe("Z abc");
  });

  it("대소문자를 무시할 수 있다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "Cache cache" }), "cache", "저장소", {
      regex: false,
      caseSensitive: false,
    });
    expect(p.items[0].newContent).toBe("저장소 저장소");
  });

  it("단어 단위로 좁힐 수 있다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "cat category" }), "cat", "dog", {
      regex: false,
      wholeWord: true,
    });
    expect(p.items[0].newContent).toBe("dog category");
  });
});

describe("정규식 치환", () => {
  it("캡처 그룹을 참조한다", () => {
    const p = computeReplacePreview(
      notes({ "/v/a.md": "2026-08-26" }),
      String.raw`(\d{4})-(\d{2})-(\d{2})`,
      "$3/$2/$1",
      { regex: true },
    );
    expect(p.items[0].newContent).toBe("26/08/2026");
  });

  /** ⚠️ 잘못된 정규식을 조용히 리터럴로 떨어뜨리면 엉뚱한 것을 바꾼다. */
  it("읽을 수 없는 정규식은 던진다", () => {
    expect(() =>
      computeReplacePreview(notes({ "/v/a.md": "x" }), "(unclosed", "y", { regex: true }),
    ).toThrow(ReplacePatternError);
  });

  /**
   * ⚠️ `.`은 줄바꿈을 넘지 않는다(`s` 플래그를 켜지 않는다). 켜면 한 줄짜리 의도가
   * 문서 전체를 삼킬 수 있다 — 되돌릴 수 없는 쓰기에서 그건 너무 큰 기본값이다.
   * 여러 줄을 노리면 `\n`을 명시한다.
   */
  it(". 은 줄바꿈을 넘지 않는다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "a\nb" }), "a.b", "Z", { regex: true });
    expect(p.items).toHaveLength(0);
  });

  it("줄바꿈을 명시하면 여러 줄에 걸친다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "a\nb" }), String.raw`a\nb`, "Z", {
      regex: true,
    });
    expect(p.items[0].newContent).toBe("Z");
  });

  /** 겹치는 매치는 왼쪽부터 겹치지 않게 — 결정적이어야 한다. */
  it("겹치는 매치는 왼쪽부터", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "aaaa" }), "aa", "b", { regex: true });
    expect(p.items[0].newContent).toBe("bb");
    expect(p.items[0].occurrences).toBe(2);
  });

  it("^ 와 $ 는 줄 단위로 본다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "x\nx" }), "^x$", "y", { regex: true });
    expect(p.items[0].newContent).toBe("y\ny");
  });
});

describe("위험 신호", () => {
  /**
   * 치환문이 패턴에 다시 걸리면 **다시 돌릴 때마다 증식한다.** JS `replace`는 원본을
   * 훑으므로 한 번 실행이 무한 루프가 되지는 않지만, 사람이 두 번 누르면 두 번 자란다.
   * 되돌릴 수 없는 쓰기에서는 미리 말해줘야 한다.
   */
  it("치환문이 다시 매치되면 알린다", () => {
    const grow = computeReplacePreview(notes({ "/v/a.md": "a" }), "a", "aa", { regex: false });
    expect(grow.selfMatching).toBe(true);
    expect(grow.items[0].newContent).toBe("aa");

    const safe = computeReplacePreview(notes({ "/v/a.md": "a" }), "a", "b", { regex: false });
    expect(safe.selfMatching).toBe(false);
  });

  /**
   * ⚠️ 프론트매터를 건드리면 YAML이 깨질 수 있다. 막지는 않는다 — `2026`을 `2027`로
   * 바꾸는 것처럼 의도적인 경우가 있다. 대신 **몇 건인지 알린다.**
   */
  it("프론트매터 안의 매치 수를 따로 센다", () => {
    const p = computeReplacePreview(
      notes({ "/v/a.md": "---\ntitle: X\n---\n본문 X" }),
      "X",
      "Y",
      { regex: false },
    );
    expect(p.totalOccurrences).toBe(2);
    expect(p.frontmatterOccurrences).toBe(1);
  });

  it("프론트매터가 없으면 0", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "본문 X" }), "X", "Y", { regex: false });
    expect(p.frontmatterOccurrences).toBe(0);
  });

  /** 빈 패턴은 모든 위치에 매치된다 — 거부한다. */
  it("빈 패턴은 던진다", () => {
    expect(() => computeReplacePreview(notes({ "/v/a.md": "x" }), "", "y", {})).toThrow(
      ReplacePatternError,
    );
  });

  it("패턴과 치환문이 같으면 바뀌는 게 없다", () => {
    const p = computeReplacePreview(notes({ "/v/a.md": "x" }), "x", "x", { regex: false });
    expect(p.items).toEqual([]);
    expect(p.totalOccurrences).toBe(0);
  });
});

describe("결정성", () => {
  it("파일 순서는 경로 오름차순 — 입력 순서와 무관하다", () => {
    const fwd = computeReplacePreview(
      notes({ "/v/z.md": "x", "/v/a.md": "x", "/v/m.md": "x" }),
      "x",
      "y",
      { regex: false },
    ).items.map((i) => i.path);
    const rev = computeReplacePreview(
      notes({ "/v/m.md": "x", "/v/a.md": "x", "/v/z.md": "x" }),
      "x",
      "y",
      { regex: false },
    ).items.map((i) => i.path);
    expect(fwd).toEqual(["/v/a.md", "/v/m.md", "/v/z.md"]);
    expect(rev).toEqual(fwd);
  });
});
