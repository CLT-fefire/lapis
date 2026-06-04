import { describe, it, expect } from "vitest";
import {
  EMPTY_NAV,
  pushEntry,
  goBack,
  goForward,
  currentPath,
  canBack,
  canForward,
  type NavState,
} from "./navHistory";

/** 헬퍼 — 여러 path를 순서대로 방문한 상태 생성. */
function visit(paths: string[], limit = 50): NavState {
  return paths.reduce((s, p) => pushEntry(s, p, limit), EMPTY_NAV);
}

describe("pushEntry", () => {
  it("선형 방문 — entries 누적, cursor는 끝", () => {
    const s = visit(["a", "b", "c"]);
    expect(s).toEqual({ entries: ["a", "b", "c"], cursor: 2 });
  });

  it("현재 위치와 동일 path 재방문은 no-op", () => {
    const s = pushEntry(visit(["a", "b"]), "b", 50);
    expect(s).toEqual({ entries: ["a", "b"], cursor: 1 });
  });

  it("뒤로 간 뒤 새 노트 방문 → forward 분기 폐기", () => {
    // a→b→c 방문 후 b로 뒤로(cursor=1), 거기서 d 방문 → c 버려짐
    let s = visit(["a", "b", "c"]);
    s = goBack(s); // cursor=1 (b)
    s = pushEntry(s, "d", 50);
    expect(s).toEqual({ entries: ["a", "b", "d"], cursor: 2 });
  });

  it("limit 초과 시 앞에서 잘라내고 cursor 보정", () => {
    const s = visit(["a", "b", "c", "d"], 3);
    expect(s).toEqual({ entries: ["b", "c", "d"], cursor: 2 });
  });

  it("빈 path는 무시", () => {
    expect(pushEntry(visit(["a"]), "", 50)).toEqual({ entries: ["a"], cursor: 0 });
  });
});

describe("goBack / goForward", () => {
  it("뒤로 → cursor 감소, 스택 보존", () => {
    const s = goBack(visit(["a", "b", "c"]));
    expect(s).toEqual({ entries: ["a", "b", "c"], cursor: 1 });
  });

  it("맨 앞에서 뒤로는 변화 없음", () => {
    const s = visit(["a"]);
    expect(goBack(s)).toEqual(s);
  });

  it("빈 상태에서 뒤로는 변화 없음", () => {
    expect(goBack(EMPTY_NAV)).toEqual(EMPTY_NAV);
  });

  it("앞으로 → cursor 증가", () => {
    let s = visit(["a", "b", "c"]);
    s = goBack(goBack(s)); // cursor=0
    expect(goForward(s)).toEqual({ entries: ["a", "b", "c"], cursor: 1 });
  });

  it("맨 끝에서 앞으로는 변화 없음", () => {
    const s = visit(["a", "b"]);
    expect(goForward(s)).toEqual(s);
  });
});

describe("currentPath / canBack / canForward", () => {
  it("currentPath — 현재 커서 위치", () => {
    expect(currentPath(visit(["a", "b"]))).toBe("b");
    expect(currentPath(EMPTY_NAV)).toBeNull();
  });

  it("canBack — 커서가 0보다 클 때", () => {
    expect(canBack(EMPTY_NAV)).toBe(false);
    expect(canBack(visit(["a"]))).toBe(false);
    expect(canBack(visit(["a", "b"]))).toBe(true);
  });

  it("canForward — 커서가 끝이 아닐 때", () => {
    const s = visit(["a", "b", "c"]);
    expect(canForward(s)).toBe(false);
    expect(canForward(goBack(s))).toBe(true);
  });
});
