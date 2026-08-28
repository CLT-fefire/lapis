import { describe, it, expect } from "vitest";
import { findOpenTasks, collectOpenTasks, countOpenTasks } from "./openTasks";

/**
 * vault 전체의 미완 작업.
 *
 * 실측: 미완 **90건**이 **5노트**에 흩어져 있다. 그 노트를 열기 전에는 남은 일이 몇
 * 개인지 알 방법이 없었다.
 */

describe("findOpenTasks", () => {
  it("미완만 모으고 완료는 센다", () => {
    const g = findOpenTasks("/v/a.md", "- [ ] 하나\n- [x] 끝\n- [ ] 둘");
    expect(g.open.map((t) => t.text)).toEqual(["하나", "둘"]);
    expect(g.done).toBe(1);
  });

  it("줄 번호를 0-based 로 남긴다", () => {
    const g = findOpenTasks("/v/a.md", "머리말\n\n- [ ] 하나");
    expect(g.open[0].line).toBe(2);
  });

  it("`*` 불릿도 본다", () => {
    expect(findOpenTasks("/v/a.md", "* [ ] 별표").open).toHaveLength(1);
  });

  it("대문자 X 는 완료", () => {
    const g = findOpenTasks("/v/a.md", "- [X] 끝");
    expect(g.open).toHaveLength(0);
    expect(g.done).toBe(1);
  });

  it("중첩 깊이를 센다", () => {
    const g = findOpenTasks("/v/a.md", "- [ ] 부모\n  - [ ] 자식\n    - [ ] 손자");
    expect(g.open.map((t) => t.depth)).toEqual([0, 1, 2]);
  });

  /** ⚠️ 탭과 공백이 섞이면 깊이가 뒤집힌다. */
  it("탭도 들여쓰기로 센다", () => {
    const g = findOpenTasks("/v/a.md", "- [ ] 부모\n\t- [ ] 자식");
    expect(g.open[1].depth).toBe(2);
  });

  /**
   * 🔴 **코드 펜스 안은 안 센다.** 이 vault 는 코드블록이 63노트에 있고 셸 예시에
   * `- [ ]` 가 들어가는 일이 있다. 세면 **있지도 않은 할 일**이 목록에 뜬다.
   */
  it("코드 펜스 안은 안 센다", () => {
    const body = ["- [ ] 진짜", "```bash", "- [ ] 예시일 뿐", "```", "- [ ] 또 진짜"].join("\n");
    expect(findOpenTasks("/v/a.md", body).open.map((t) => t.text)).toEqual(["진짜", "또 진짜"]);
  });

  it("물결 펜스도 본다", () => {
    const body = ["~~~", "- [ ] 예시", "~~~", "- [ ] 진짜"].join("\n");
    expect(findOpenTasks("/v/a.md", body).open.map((t) => t.text)).toEqual(["진짜"]);
  });

  /** ⚠️ 다른 문자로 연 펜스는 안 닫는다 — 닫히면 그 뒤가 통째로 세어진다. */
  it("백틱 펜스를 물결이 안 닫는다", () => {
    const body = ["```", "~~~", "- [ ] 안에 있다", "```", "- [ ] 밖"].join("\n");
    expect(findOpenTasks("/v/a.md", body).open.map((t) => t.text)).toEqual(["밖"]);
  });

  it("체크박스가 없으면 빈 결과", () => {
    const g = findOpenTasks("/v/a.md", "- 그냥 목록\n문단");
    expect(g.open).toEqual([]);
    expect(g.done).toBe(0);
  });

  /** 문장 중간의 대괄호는 작업이 아니다. */
  it("문장 중간은 안 잡는다", () => {
    expect(findOpenTasks("/v/a.md", "- 앞 [ ] 뒤").open).toEqual([]);
  });
});

describe("collectOpenTasks", () => {
  const notes = [
    { path: "/v/few.md", body: "- [ ] 하나" },
    { path: "/v/many.md", body: "- [ ] 하나\n- [ ] 둘\n- [ ] 셋" },
    { path: "/v/none.md", body: "- [x] 다 끝냄" },
  ];

  it("미완이 많은 노트부터", () => {
    expect(collectOpenTasks(notes).map((g) => g.path)).toEqual(["/v/many.md", "/v/few.md"]);
  });

  /**
   * ⚠️ **미완이 0인 노트는 뺀다.** 남기면 "할 일 목록"이 아니라 "체크박스가 있는 노트
   * 목록"이 되고, 그러면 아무 질문에도 답하지 않는다.
   */
  it("전부 끝낸 노트는 안 낸다", () => {
    expect(collectOpenTasks(notes).map((g) => g.path)).not.toContain("/v/none.md");
  });

  it("동점은 경로순 — 같은 vault 가 매번 같은 답을 낸다", () => {
    const same = [
      { path: "/v/z.md", body: "- [ ] a" },
      { path: "/v/a.md", body: "- [ ] a" },
    ];
    expect(collectOpenTasks(same).map((g) => g.path)).toEqual(["/v/a.md", "/v/z.md"]);
  });

  it("빈 vault 는 빈 목록", () => {
    expect(collectOpenTasks([])).toEqual([]);
  });
});

describe("countOpenTasks", () => {
  it("미완과 완료를 각각 더한다", () => {
    const groups = collectOpenTasks([
      { path: "/v/a.md", body: "- [ ] 하나\n- [x] 끝" },
      { path: "/v/b.md", body: "- [ ] 둘\n- [ ] 셋\n- [x] 끝\n- [x] 끝2" },
    ]);
    expect(countOpenTasks(groups)).toEqual({ open: 3, done: 3 });
  });

  it("빈 목록은 0", () => {
    expect(countOpenTasks([])).toEqual({ open: 0, done: 0 });
  });
});
