import { describe, it, expect } from "vitest";
import {
  parseSavedQuery,
  SAVED_QUERY_DEFAULT_LIMIT,
  SAVED_QUERY_MAX_LIMIT,
} from "./savedQuery";

/**
 * 저장된 질의의 **파서**. 고르는 일은 `tableView.ts` 의 `filterRows` 가 하므로
 * 여기서 잴 것은 "글자가 축으로 제대로 옮겨지나"와 **"틀린 것을 틀렸다고 하나"** 다.
 *
 * 🔴 두 번째가 이 파일의 이유다. 모르는 키를 조용히 넘기면 결과가 안 나올 때 사용자는
 * **vault 에 그런 노트가 없다고 읽는다** — 오타가 사실로 둔갑한다.
 */

const ok = (s: string) => {
  const r = parseSavedQuery(s);
  if (!r.ok) throw new Error("파싱 실패: " + r.errors.join(" / "));
  return r.query;
};
const errs = (s: string) => {
  const r = parseSavedQuery(s);
  if (r.ok) throw new Error("오류를 기대했는데 통과했다");
  return r.errors;
};

describe("축으로 옮긴다", () => {
  it("한 줄짜리", () => {
    expect(ok("doc_kind: plan")).toEqual({
      docKinds: ["plan"],
      topics: [],
      tags: [],
      text: "",
      limit: SAVED_QUERY_DEFAULT_LIMIT,
    });
  });

  it("쉼표로 여럿", () => {
    expect(ok("doc_kind: plan, adr ,  reference").docKinds).toEqual(["plan", "adr", "reference"]);
  });

  it("축 여럿을 같이", () => {
    const q = ok("doc_kind: plan\ntopic: overview\ntag: subject/ui\ntext: 초성\nlimit: 5");
    expect(q).toEqual({
      docKinds: ["plan"],
      topics: ["overview"],
      tags: ["subject/ui"],
      text: "초성",
      limit: 5,
    });
  });

  /**
   * 🔴 **태그는 `tag` 다.** 판정은 `$lib/tagMatch` 가 하고, 그건 앱 필터와
   * `core/query.ts` 의 `tag` 축도 쓰는 **같은 모듈**이다. 여기서 따로 판정했다면
   * 같은 태그 질의가 표면마다 다른 답을 냈을 것이다.
   */
  it("태그를 축으로 받는다", () => {
    expect(ok("tag: subject/ui").tags).toEqual(["subject/ui"]);
    expect(ok("tag: a, b ,c").tags).toEqual(["a", "b", "c"]);
  });

  it("키는 대소문자를 안 가린다", () => {
    expect(ok("DOC_KIND: plan").docKinds).toEqual(["plan"]);
  });

  /** ⚠️ 값 안의 `:` 은 값의 일부다 — 첫 `:` 에서만 가른다. */
  it("값 안의 콜론을 안 자른다", () => {
    expect(ok("text: 시각: 08:30").text).toBe("시각: 08:30");
  });

  it("빈 줄과 주석을 넘긴다", () => {
    const q = ok("# 이건 설명\n\ndoc_kind: plan\n\n# 끝");
    expect(q.docKinds).toEqual(["plan"]);
  });
});

describe("🔴 틀린 것을 틀렸다고 한다", () => {
  it("모르는 키는 오류다", () => {
    // ⚠️ 복수형 `tags` 는 흔한 오타다 — 프론트매터 필드 이름이 `tags` 라서 더 그렇다.
    const e = errs("tags: lapis");
    expect(e[0]).toContain("모르는 키");
    expect(e[0], "쓸 수 있는 것을 같이 말해야 고칠 수 있다").toContain("doc_kind");
  });

  /** ⚠️ 흔한 오타 — 하이픈과 밑줄. 조용히 넘어가면 "결과 없음"으로 보인다. */
  it("`doc-kind` 는 `doc_kind` 가 아니다", () => {
    expect(errs("doc-kind: plan")[0]).toContain("모르는 키");
  });

  it("`키: 값` 꼴이 아니면 줄 번호를 말한다", () => {
    expect(errs("doc_kind: plan\n그냥 글")[0]).toContain("2번째 줄");
  });

  it("값이 비면 오류다", () => {
    expect(errs("topic:")[0]).toContain("비어 있다");
  });

  /**
   * 🔴 **빈 질의를 전량으로 읽지 않는다.** 노트 한 칸에 vault 가 통째로 쏟아지는 것은
   * 사용자가 원한 것일 리 없고, 오타와 구별도 안 된다.
   */
  it("고르는 값이 하나도 없으면 오류다", () => {
    expect(errs("")[0]).toContain("고르는 값이 하나도 없다");
    expect(errs("# 주석뿐")[0]).toContain("고르는 값이 하나도 없다");
  });

  it("limit 은 1 이상 정수여야 한다", () => {
    expect(errs("doc_kind: plan\nlimit: 0")[0]).toContain("1 이상");
    expect(errs("doc_kind: plan\nlimit: 2.5")[0]).toContain("1 이상");
    expect(errs("doc_kind: plan\nlimit: 많이")[0]).toContain("1 이상");
  });

  /** ⚠️ 조용히 자르면 "결과가 이게 전부"로 읽힌다. 상한을 넘으면 **말한다.** */
  it("limit 상한을 넘으면 조용히 자르지 않고 말한다", () => {
    const e = errs(`doc_kind: plan\nlimit: ${SAVED_QUERY_MAX_LIMIT + 1}`);
    expect(e[0]).toContain("상한");
    expect(e[0]).toContain(String(SAVED_QUERY_MAX_LIMIT));
  });

  /** 오류가 여럿이면 여럿 다 말한다 — 하나씩 고치게 만들지 않는다. */
  it("오류를 모아서 낸다", () => {
    expect(errs("tags: x\nfoo: y")).toHaveLength(2);
  });
});
