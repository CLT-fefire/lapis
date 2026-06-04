import { describe, it, expect } from "vitest";
import {
  matchWikilinkPrefix,
  buildWikilinkCompletions,
  computeWikilinkInsert,
  type WikilinkCandidate,
} from "./wikilinkComplete";

describe("matchWikilinkPrefix", () => {
  it("`[[` 직후 빈 query 매칭", () => {
    expect(matchWikilinkPrefix("foo [[")).toEqual({ from: 6, query: "" });
  });

  it("`[[` 이후 검색어 캡처", () => {
    expect(matchWikilinkPrefix("see [[Pro")).toEqual({ from: 6, query: "Pro" });
  });

  it("한글 검색어", () => {
    expect(matchWikilinkPrefix("[[회의")).toEqual({ from: 2, query: "회의" });
  });

  it("`|` 뒤에선 비매칭(별칭 입력 중)", () => {
    expect(matchWikilinkPrefix("[[stem|별칭")).toBeNull();
  });

  it("`]` 포함되면 비매칭(이미 닫힘)", () => {
    expect(matchWikilinkPrefix("[[stem]")).toBeNull();
  });

  it("`[[` 없으면 비매칭", () => {
    expect(matchWikilinkPrefix("just text")).toBeNull();
  });

  it("단일 `[`는 비매칭(일반 마크다운 링크)", () => {
    expect(matchWikilinkPrefix("[link")).toBeNull();
  });
});

const cands: WikilinkCandidate[] = [
  { stem: "Project Alpha", title: "Project Alpha", aliases: [] },
  { stem: "alpha-notes", title: null, aliases: ["알파"] },
  { stem: "beta", title: "Beta Plan", aliases: [] },
];

describe("buildWikilinkCompletions", () => {
  it("빈 query → 전체 후보 반환", () => {
    expect(buildWikilinkCompletions("", cands)).toHaveLength(3);
  });

  it("접두 일치가 부분 일치보다 먼저", () => {
    // "alpha": "alpha-notes"(stem 접두, score 2) vs "Project Alpha"(title 부분, score 1)
    const r = buildWikilinkCompletions("alpha", cands);
    expect(r.map((c) => c.label)).toEqual(["alpha-notes", "Project Alpha"]);
  });

  it("alias로 매칭", () => {
    const r = buildWikilinkCompletions("알파", cands);
    expect(r.map((c) => c.label)).toEqual(["alpha-notes"]);
  });

  it("대소문자 무시", () => {
    expect(buildWikilinkCompletions("BETA", cands).map((c) => c.label)).toEqual(["beta"]);
  });

  it("매칭 없으면 빈 배열", () => {
    expect(buildWikilinkCompletions("xyz", cands)).toEqual([]);
  });

  it("detail: title이 stem과 다르면 title 표시", () => {
    expect(buildWikilinkCompletions("beta", cands)[0].detail).toBe("Beta Plan");
  });

  it("detail: title이 stem과 같으면 생략(rel 없을 때)", () => {
    expect(buildWikilinkCompletions("project", cands)[0].detail).toBeUndefined();
  });

  it("detail: title 없으면 rel(부모 폴더) fallback", () => {
    const withRel: WikilinkCandidate[] = [
      { stem: "daily", title: null, aliases: [], rel: "journal" },
    ];
    expect(buildWikilinkCompletions("daily", withRel)[0].detail).toBe("journal");
  });
});

describe("computeWikilinkInsert", () => {
  it("닫는 `]]` 없으면 추가하고 커서를 뒤로", () => {
    expect(computeWikilinkInsert("Foo", "")).toEqual({ insert: "Foo]]", cursorRel: 5 });
  });

  it("이미 `]]`가 있으면 중복 추가 안 함", () => {
    expect(computeWikilinkInsert("Foo", "]]")).toEqual({ insert: "Foo", cursorRel: 5 });
  });

  it("뒤가 다른 텍스트면 `]]` 추가", () => {
    expect(computeWikilinkInsert("Bar", " x")).toEqual({ insert: "Bar]]", cursorRel: 5 });
  });
});
