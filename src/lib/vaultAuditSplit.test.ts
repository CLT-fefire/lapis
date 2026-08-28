import { describe, it, expect } from "vitest";
import { findFrontmatterIssues, MIN_ENUM_NOTES, ISSUE_VALUES_MAX } from "./vaultAudit";
import type { LinkIndex } from "./linkIndex";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 프론트매터 감사가 **이 vault 의 실제 갈림을 잡는가**.
 *
 * ## 왜 이 테스트가 있나 (2026-08-28 실측)
 *
 * `audit: props` 가 **0건**을 냈다. 그런데 `status` 는 이렇게 갈려 있었다:
 *
 * ```
 * 반영됨(19) · 완료(10) · 진행 중(10) · 구현 완료(1) · 해결됨(1) · 닫힘(1) · 이전됨(1) · 미착수(1)
 * ```
 *
 * 여덟 중 다섯이 "끝났다"를 뜻하는데 감사가 아무 말도 안 했다. 이유가 둘이다:
 *
 * 1. `prefix` 규칙이 **접두사만** 본다 — `완료` 는 `구현 완료` 의 **접미사**다
 * 2. 나머지(반영됨·해결됨·닫힘·이전됨)는 **동의어**라 문자열로는 안 걸린다
 *
 * ⚠️ 2번은 **고치지 않는다.** "반영됨과 해결됨이 같은 뜻"은 기계가 정할 수 없고, 이
 * 기능의 원칙은 "판단하지 않는다"다. 대신 **축이 안 굳었다는 사실 자체**를 신호로 낸다.
 */

function idx(field: string, values: Record<string, number>): LinkIndex {
  const byPath = new Map<string, LinkInfo>();
  let n = 0;
  for (const [value, count] of Object.entries(values)) {
    for (let i = 0; i < count; i++) {
      const path = `p/${n++}.md`;
      byPath.set(path, {
        source_path: path,
        source_name: String(n),
        title: null,
        doc_kind: "note",
        topic: null,
        tags: [],
        targets: [],
        related: [],
        props: { [field]: [value] },
      } as unknown as LinkInfo);
    }
  }
  // ⚠️ `relationFields` 가 `relations.outgoing` 을 읽는다 — 빈 인덱스라도 모양은 맞춰야 한다.
  return {
    byPath,
    relations: { outgoing: new Map(), incoming: new Map() },
  } as unknown as LinkIndex;
}

const kinds = (field: string, values: Record<string, number>) =>
  findFrontmatterIssues(idx(field, values))
    .filter((i) => i.field === field)
    .map((i) => i.kind);

describe("접미 — 실제로 걸린 갈림", () => {
  /** `완료` ⊂ `구현 완료`. 이게 이 PR 의 이유다. */
  it("뒤에서 겹치는 값을 잡는다", () => {
    expect(kinds("status", { "완료": 10, "구현 완료": 2 })).toContain("suffix");
  });

  /**
   * ⚠️ **경계에서 끊겨야 한다.** `prefix` 쪽 주석이 같은 이유를 적고 있다 —
   * 안 그러면 서로 다른 두 낱말을 갈린 값이라고 보고한다.
   */
  it("낱말 중간에서 겹치는 것은 안 잡는다", () => {
    expect(kinds("status", { "완료": 10, "미완료": 5 })).not.toContain("suffix");
  });

  it("접두사 쪽은 그대로 잡는다", () => {
    expect(kinds("status", { "완료": 10, "완료 — #232": 3 })).toContain("prefix");
  });
});

describe("sparse — 축이 안 굳었다", () => {
  /**
   * 실측값 그대로. 동의어는 판정하지 않지만, **여덟 중 다섯이 1회**라는 사실은 셀 수 있다.
   */
  it("1회 값이 절반 이상이면 신호를 낸다", () => {
    const k = kinds("status", {
      "반영됨": 19, "완료": 10, "진행 중": 10,
      "구현 완료": 1, "해결됨": 1, "닫힘": 1, "이전됨": 1, "미착수": 1,
    });
    expect(k).toContain("sparse");
  });

  /**
   * ⚠️ **건강한 축에는 안 울려야 한다.** 이 vault 의 `doc_kind` 는 여섯 종에 1회 값이
   * 하나도 없다. 여기서 울리면 감사 전체를 안 믿게 된다.
   */
  it("1회 값이 없으면 조용하다", () => {
    const k = kinds("doc_kind_like", {
      reference: 41, plan: 28, solution: 17, adr: 7, todos: 5, state: 2,
    });
    expect(k).not.toContain("sparse");
  });

  /** 1회 값이 둘뿐이면 표본이 아니라 우연이다. */
  it("1회 값이 너무 적으면 조용하다", () => {
    expect(kinds("status", { a: 10, b: 8, c: 1, d: 1 })).not.toContain("sparse");
  });

  /** 표본이 작으면 갈렸는지 판단할 근거가 없다 — 기존 문턱을 그대로 지킨다. */
  it("노트 수가 문턱 아래면 아예 안 본다", () => {
    const few: Record<string, number> = {};
    for (let i = 0; i < MIN_ENUM_NOTES - 1; i++) few[`v${i}`] = 1;
    expect(kinds("status", few)).toEqual([]);
  });
});

describe("벽이 되지 않게 자른다", () => {
  /**
   * ⚠️ 실측에서 `topic` 의 `sparse` 가 **17줄**이었다. 열일곱 줄을 다 읽는 사람은 없고,
   * 그러면 그 아래 진짜 갈림(`suffix`)까지 같이 안 보인다.
   */
  it("값이 상한을 넘으면 자르고 total 을 남긴다", () => {
    const many: Record<string, number> = { 흔한값: 20 };
    for (let i = 0; i < 17; i++) many[`v${i}`] = 1;
    // ⚠️ 필드 이름이 `topic` 이면 안 된다 — `doc_kind`·`topic` 은 **타입 있는 필드**라
    //    `info.topic` 에서 세고 `props` 쪽은 중복 방지로 건너뛴다. 픽스처는 props 를 채운다.
    const issue = findFrontmatterIssues(idx("area", many)).find((x) => x.kind === "sparse");
    expect(issue).toBeDefined();
    expect(issue!.values).toHaveLength(ISSUE_VALUES_MAX);
    expect(issue!.total).toBe(17);
  });

  /** ⚠️ 안 잘랐으면 `total` 이 **없어야** 한다 — 있으면 화면이 "외 0개 더"를 그린다. */
  it("안 잘랐으면 total 이 없다", () => {
    const issue = findFrontmatterIssues(idx("status", { a: 10, b: 1, c: 1, d: 1 })).find(
      (x) => x.kind === "sparse",
    );
    expect(issue).toBeDefined();
    expect(issue!.total).toBeUndefined();
  });
});
