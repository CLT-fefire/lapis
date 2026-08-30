import { describe, it, expect, vi } from "vitest";
import { readBodies } from "./readBodies";

/**
 * 🔴 **분모가 조용히 줄어들면 안 된다.**
 *
 * 미완 작업 집계는 본문을 읽어야 한다. 캐시에 있는 노트가 디스크에서 사라졌거나 권한이
 * 막히면 읽기가 실패하는데, 예전엔 두 소비자가 그걸 **그냥 건너뛰었다.**
 * "미완 12건"이 나오면 그게 전부인지 아닌지를 아무도 모른다.
 *
 * 6차의 `unusedCommands` 와 같은 모양이다 — **모르면 모른다고 한다.**
 */

describe("다 읽히면", () => {
  it("전부 담고 못 읽은 것은 0", () => {
    const r = readBodies(["/a.md", "/b.md"], (p) => `본문 ${p}`);
    expect(r.bodies).toEqual([
      { path: "/a.md", body: "본문 /a.md" },
      { path: "/b.md", body: "본문 /b.md" },
    ]);
    expect(r.unreadable).toBe(0);
  });

  it("빈 목록이면 빈 결과", () => {
    const r = readBodies([], () => "");
    expect(r.bodies).toEqual([]);
    expect(r.unreadable).toBe(0);
  });
});

describe("🔴 못 읽은 것을 센다", () => {
  const read = (p: string) => {
    if (p.includes("사라진")) throw new Error("ENOENT");
    return "본문";
  };

  it("실패한 노트를 세서 돌려준다", () => {
    const r = readBodies(["/a.md", "/사라진.md", "/b.md"], read);
    expect(r.unreadable, "조용히 건너뛰었다 — 분모가 틀린다").toBe(1);
  });

  /** ⚠️ 하나가 실패해도 **나머지는 읽는다.** 통째로 포기하면 아무것도 못 센다. */
  it("실패해도 나머지는 읽는다", () => {
    const r = readBodies(["/a.md", "/사라진.md", "/b.md"], read);
    expect(r.bodies.map((b) => b.path)).toEqual(["/a.md", "/b.md"]);
  });

  it("전부 실패해도 안 던진다", () => {
    const r = readBodies(["/사라진1.md", "/사라진2.md"], read);
    expect(r.bodies).toEqual([]);
    expect(r.unreadable).toBe(2);
  });

  /**
   * ⚠️ vault 가 크면 실패도 많을 수 있다. **줄마다 로그를 남기지 않는다** —
   * 수천 줄이 되면 그게 또 다른 잡음이다. 수만 돌려주고 부르는 쪽이 한 번 말한다.
   */
  it("로그를 쏟지 않는다", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    readBodies(["/사라진1.md", "/사라진2.md", "/사라진3.md"], read);
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    warn.mockRestore();
    err.mockRestore();
  });
});
