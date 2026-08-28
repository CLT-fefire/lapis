import { describe, it, expect } from "vitest";
import {
  applyTemplate,
  valueOf,
  templateName,
  defaultBody,
  PLACEHOLDERS,
} from "./noteTemplate";

/**
 * 새 노트 템플릿.
 *
 * 실측: 이 vault 는 프론트매터 규약이 **100%** 다(`title`·`doc_kind`·`topic`·`tags` 가
 * 112/112). 매번 손으로 적고 있었다는 뜻이다.
 */

const NOW = new Date(2026, 7, 28, 9, 5); // 2026-08-28 09:05
const vars = { title: "새 노트", now: NOW };

describe("치환", () => {
  it("제목과 날짜를 채운다", () => {
    expect(applyTemplate("# {{title}}\n{{date}}", vars)).toBe("# 새 노트\n2026-08-28");
  });

  it("시각과 날짜시각도", () => {
    expect(valueOf("time", vars)).toBe("09:05");
    expect(valueOf("datetime", vars)).toBe("2026-08-28 09:05");
  });

  it("한 자리 월·일·시를 0으로 채운다", () => {
    const v = { title: "t", now: new Date(2026, 0, 3, 4, 7) };
    expect(valueOf("date", v)).toBe("2026-01-03");
    expect(valueOf("time", v)).toBe("04:07");
  });

  it("같은 자리를 여러 번 써도 다 채운다", () => {
    expect(applyTemplate("{{title}} / {{title}}", vars)).toBe("새 노트 / 새 노트");
  });

  /** 손으로 쓰는 것이라 공백이 들어간다. */
  it("중괄호 안의 공백을 허용한다", () => {
    expect(applyTemplate("{{ title }}", vars)).toBe("새 노트");
  });

  it("대소문자를 안 가린다", () => {
    expect(applyTemplate("{{TITLE}}", vars)).toBe("새 노트");
  });

  /**
   * 🔴 **모르는 이름은 그대로 남긴다.** 빈 문자열로 바꾸면 오타(`{{titel}}`)가 조용히
   * 사라져 사용자는 템플릿이 먹은 줄 안다. 남아 있으면 눈에 보인다.
   */
  it("모르는 자리는 안 건드린다", () => {
    expect(applyTemplate("{{titel}} {{author}}", vars)).toBe("{{titel}} {{author}}");
  });

  it("중괄호가 아닌 것은 안 건드린다", () => {
    expect(applyTemplate("{title} [[title]]", vars)).toBe("{title} [[title]]");
  });

  it("빈 본문도 안 죽는다", () => {
    expect(applyTemplate("", vars)).toBe("");
  });

  /** 아는 이름 목록이 곧 계약이다 — 늘어나면 여기가 먼저 운다. */
  it("아는 자리가 넷이다", () => {
    expect([...PLACEHOLDERS]).toEqual(["title", "date", "time", "datetime"]);
  });
});

describe("templateName", () => {
  it("파일명에서 확장자를 뗀다", () => {
    expect(templateName(".lapis/templates/계획.md")).toBe("계획");
    expect(templateName("x/y/diagram.mmd")).toBe("diagram");
  });

  it("경로가 없어도 안 죽는다", () => {
    expect(templateName("계획.md")).toBe("계획");
  });
});

describe("defaultBody", () => {
  /**
   * ⚠️ 템플릿을 **안 만든** 사용자의 동작이 바뀌면 안 된다. 이 기능은 더하는 것이지
   * 기존 흐름을 갈아치우는 것이 아니다.
   */
  it("예전 동작 그대로 h1 하나", () => {
    expect(defaultBody("제목")).toBe("# 제목\n\n");
  });
});
