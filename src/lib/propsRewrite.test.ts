import { describe, it, expect } from "vitest";
import { rewritePropInFrontmatter, rewritePropInNote, SCALAR_PROP_KEYS } from "./propsRewrite";

/**
 * frontmatter **스칼라 값** 바꾸기 — `props audit` 이 찾은 것을 고치는 짝.
 *
 * ## 🔴 진단만 있고 처방이 없었다
 *
 * `props audit` 은 실제 vault 에서 이런 것을 찾아낸다:
 *
 * ```
 * topic  (앞부분이 같음)   11 feature  ·  2 feature-selection
 * topic  (suffix)          5 platform ·  1 cross-platform
 * ```
 *
 * 태그는 `tag rename` 으로 고칠 수 있는데 **frontmatter 값에는 그 짝이 없었다.**
 * 앱도 `audit-props` 탭으로 보여주기만 했다. 13개 파일을 손으로 고쳐야 했다.
 *
 * ## ⚠️ YAML 을 파싱하지 않는다
 *
 * `tagRewrite.ts` 와 같은 이유다 — #184 에서 파싱 후 재직렬화가 실패해 노트의
 * frontmatter 가 **통째로 날아갔다.** 줄 단위 텍스트 편집만 한다. 모르는 필드·주석·
 * 따옴표 스타일은 손대지 않는다.
 *
 * ## ⚠️ 태그와 달리 **접두 계층이 없다**
 *
 * `tag rename tech` 는 `tech/svelte5` 도 옮긴다. `topic` 에는 계층이 없으므로
 * **정확히 일치할 때만** 바꾼다. `platform` 을 바꾸면서 `cross-platform` 을 건드리면
 * 감사가 "suffix" 로 묶어 준 것을 잘못 읽은 셈이 된다 — 그 둘은 다른 값이다.
 */

const FM = (body: string) => body;

describe("정확히 일치할 때만", () => {
  it("값을 바꾼다", () => {
    const r = rewritePropInFrontmatter("topic: feature-selection", "topic", "feature-selection", "feature");
    expect(r.text).toBe("topic: feature");
    expect(r.count).toBe(1);
  });

  /** 🔴 접두가 같다고 바꾸면 안 된다. */
  it("접두만 같은 값은 안 건드린다", () => {
    const r = rewritePropInFrontmatter("topic: feature-selection", "topic", "feature", "subject");
    expect(r.count).toBe(0);
    expect(r.text).toBe("topic: feature-selection");
  });

  /** ⚠️ `cross-platform` 은 `platform` 이 아니다. */
  it("접미만 같은 값도 안 건드린다", () => {
    const r = rewritePropInFrontmatter("topic: cross-platform", "topic", "platform", "os");
    expect(r.count).toBe(0);
  });

  /** ⚠️ 다른 키의 같은 값을 건드리면 안 된다. */
  it("다른 키는 안 본다", () => {
    const r = rewritePropInFrontmatter("doc_kind: plan\ntopic: plan", "topic", "plan", "spec");
    expect(r.count).toBe(1);
    expect(r.text).toBe("doc_kind: plan\ntopic: spec");
  });
});

describe("모양을 지킨다", () => {
  it("따옴표를 보존한다", () => {
    expect(rewritePropInFrontmatter(`topic: "old"`, "topic", "old", "new").text).toBe(`topic: "new"`);
    expect(rewritePropInFrontmatter(`topic: 'old'`, "topic", "old", "new").text).toBe(`topic: 'new'`);
  });

  /** ⚠️ 줄 끝 주석은 사람이 적은 것이다. 지우면 안 된다. */
  it("줄 끝 주석을 남긴다", () => {
    const r = rewritePropInFrontmatter("topic: old  # 왜 이 값인지", "topic", "old", "new");
    expect(r.text).toBe("topic: new  # 왜 이 값인지");
  });

  it("모르는 줄은 그대로 둔다", () => {
    const src = "title: 제목\nweird: [1, 2]\ntopic: old\n# 주석";
    const r = rewritePropInFrontmatter(src, "topic", "old", "new");
    expect(r.text).toBe("title: 제목\nweird: [1, 2]\ntopic: new\n# 주석");
  });

  /** ⚠️ 배열은 이 도구가 다루지 않는다 — `tags` 는 `tag rename` 몫이다. */
  it("배열 값은 안 건드린다", () => {
    const r = rewritePropInFrontmatter("topic: [a, b]", "topic", "a", "z");
    expect(r.count).toBe(0);
  });
});

describe("노트 단위", () => {
  const note = FM(`---
doc_kind: plan
topic: old
---

# 본문

여기서도 topic: old 라고 적었지만 이건 본문이다.
`);

  /** 🔴 **본문은 건드리지 않는다.** 인덱싱 대상은 frontmatter 뿐이다. */
  it("본문의 같은 글자를 안 바꾼다", () => {
    const r = rewritePropInNote(note, "topic", "old", "new");
    expect(r.count).toBe(1);
    expect(r.text).toContain("topic: new");
    expect(r.text, "본문까지 바꿨다").toContain("여기서도 topic: old 라고");
  });

  it("frontmatter 가 없으면 아무것도 안 한다", () => {
    const r = rewritePropInNote("# 제목만 있다\n", "topic", "old", "new");
    expect(r.count).toBe(0);
    expect(r.text).toBe("# 제목만 있다\n");
  });

  /** ⚠️ 바꿀 게 없으면 **원본 문자열 그대로** 돌려준다 — 안 그러면 쓸 이유가 없는 파일까지 쓴다. */
  it("바꿀 게 없으면 원본 그대로", () => {
    const r = rewritePropInNote(note, "topic", "없는값", "new");
    expect(r.count).toBe(0);
    expect(r.text).toBe(note);
  });
});

/**
 * ⚠️ **아무 키나 받지 않는다.**
 *
 * `tags` 는 배열이고 `tag rename` 이 계층까지 다룬다 — 여기서 손대면 규칙이 두 벌이 된다.
 * `related` · `aliases` 도 배열이라 의미론이 다르다.
 */
describe("다룰 수 있는 키", () => {
  it("스칼라 축만 받는다", () => {
    expect([...SCALAR_PROP_KEYS].sort()).toEqual(["doc_kind", "status", "topic"]);
  });

  it("tags 는 안 받는다", () => {
    expect(SCALAR_PROP_KEYS as readonly string[]).not.toContain("tags");
    expect(SCALAR_PROP_KEYS as readonly string[]).not.toContain("related");
  });
});

/**
 * 🔴 **`#` 는 앞에 공백이 있어야 주석이다.**
 *
 * YAML 에서 `C#` 은 스칼라 `C#` 하나이지 "값 `C` + 주석 `#`" 이 아니다. 그런데 주석
 * 인식을 `\s*#` 로 했더니 —
 *
 * ```
 * rewritePropInFrontmatter("topic: C#", "topic", "C", "D")
 *   → count=1, "topic: D#"      ← 안 건드려야 할 것을 건드렸다
 * ```
 *
 * 반대 방향도 막혀 있었다: 진짜 값 `C#` 을 바꾸려 해도 값이 `C` 로 잘려 **영영 안 맞는다.**
 *
 * ⚠️ 프로그래밍 노트에서 `C#` · `F#` 은 흔한 값이다. 그리고 이 결함은 **조용하다** —
 * dry-run 미리보기에도 "바뀐다"고 나오므로 사람이 보고도 이상한 줄 모른다.
 */
describe("값 안의 #", () => {
  it("공백 없는 # 는 주석이 아니다", () => {
    const r = rewritePropInFrontmatter("topic: C#", "topic", "C", "D");
    expect(r.count, "C# 을 C 로 읽고 바꿨다").toBe(0);
    expect(r.text).toBe("topic: C#");
  });

  it("진짜 값 C# 은 바꿀 수 있다", () => {
    const r = rewritePropInFrontmatter("topic: C#", "topic", "C#", "csharp");
    expect(r.count).toBe(1);
    expect(r.text).toBe("topic: csharp");
  });

  /** 공백이 있으면 진짜 주석이다 — 그건 그대로 남긴다. */
  it("공백 있는 # 는 주석이다", () => {
    const r = rewritePropInFrontmatter("topic: old  # 왜 이 값인지", "topic", "old", "new");
    expect(r.count).toBe(1);
    expect(r.text).toBe("topic: new  # 왜 이 값인지");
  });

  /** ⚠️ 따옴표 안의 `#` 도 값의 일부다. */
  it("따옴표 안의 # 는 값이다", () => {
    const r = rewritePropInFrontmatter('topic: "a # b"', "topic", "a # b", "c");
    expect(r.count).toBe(1);
    expect(r.text).toBe('topic: "c"');
  });
});
