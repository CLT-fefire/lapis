import { describe, it, expect } from "vitest";
import { joinNotePath } from "./assetPath";

describe("joinNotePath — POSIX", () => {
  it("상대 src를 노트 부모에 붙인다", () => {
    expect(joinNotePath("/vault/note.md", "img.png")).toBe("/vault/img.png");
    expect(joinNotePath("/vault/a/note.md", "img/x.png")).toBe("/vault/a/img/x.png");
  });
  it("`.` `..` 정리", () => {
    expect(joinNotePath("/vault/a/note.md", "./img.png")).toBe("/vault/a/img.png");
    expect(joinNotePath("/vault/a/note.md", "../img.png")).toBe("/vault/img.png");
    expect(joinNotePath("/vault/a/b/note.md", "../../img.png")).toBe("/vault/img.png");
  });
  it("절대 src는 그대로", () => {
    expect(joinNotePath("/vault/note.md", "/other/img.png")).toBe("/other/img.png");
  });
});

describe("joinNotePath — Windows 드라이브 경로", () => {
  it("드라이브 지정자를 보존한다", () => {
    expect(joinNotePath("C:/vault/note.md", "img.png")).toBe("C:/vault/img.png");
    expect(joinNotePath("D:/notes/a/note.md", "img/x.png")).toBe("D:/notes/a/img/x.png");
  });

  it("`..`이 드라이브를 먹지 않는다", () => {
    expect(joinNotePath("C:/vault/a/note.md", "../img.png")).toBe("C:/vault/img.png");
    // 루트를 넘어서는 `..`은 루트에서 멈춘다 — 드라이브가 사라지면 안 된다.
    expect(joinNotePath("C:/a/note.md", "../../../img.png")).toBe("C:/img.png");
  });

  it("앞 슬래시가 붙지 않는다", () => {
    // 회귀 방지 — `/C:/vault/img.png`는 존재하지 않는 경로다.
    expect(joinNotePath("C:/vault/note.md", "img.png")).not.toMatch(/^\//);
  });

  it("드라이브 절대 src는 그대로", () => {
    expect(joinNotePath("C:/vault/note.md", "D:/shared/img.png")).toBe("D:/shared/img.png");
  });
});
