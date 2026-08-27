import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { findFrontmatterIssues, MIN_ENUM_NOTES } from "./vaultAudit";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * frontmatter 위생 — 감사 계열의 다섯째.
 *
 * ## 왜 이게 필요한가 — 추론이 아니라 실측
 *
 * 실제 vault(89노트)에서 지금 이런 상태다:
 *
 * ```
 * doc_kind:  todo (1) · todos (1)
 * status:    반영됨 18 · 완료 2 · 해결됨 1 · 완료 — #232 · 완료 — v2.0.0 …  (12종)
 * ```
 *
 * ⚠️ **조용하다.** 질의가 에러를 내는 게 아니라 **적게 찾는다.** `status: 완료`로 거르면
 * `완료 — #232`인 노트가 빠지고, 빠졌다는 사실은 어디에도 안 나온다.
 *
 * 태그 위생이 이미 같은 모양을 태그에 대해 한다. 새 알고리즘이 아니라 적용 범위 확대다.
 */

const mk = (path: string, extra: Partial<LinkInfo> = {}): LinkInfo => ({
  source_path: path,
  source_name: path.replace(/^.*\//, "").replace(/\.md$/i, ""),
  title: null,
  aliases: [],
  tags: [],
  doc_kind: null,
  topic: null,
  related: [],
  targets: [],
  props: {},
  ...extra,
});

/** 같은 필드·같은 값의 노트를 n개. 열거형처럼 보이게 하는 최소 덩어리. */
const many = (n: number, field: string, value: string, from = 0) =>
  Array.from({ length: n }, (_, i) => mk(`/v/${field}-${value}-${from + i}.md`, {
    props: { [field]: [value] },
  }));

/** 감사는 인덱스를 받는다 — 상호참조 필드를 인덱스에 물어 거르기 때문이다. */
const audit = (infos: LinkInfo[]) => findFrontmatterIssues(buildIndex(infos));

const shape = (rows: ReturnType<typeof findFrontmatterIssues>) =>
  rows.map((r) => `${r.field}:${r.kind}:${r.values.map((v) => v.value).join("|")}`);

describe("찾는 것", () => {
  /** ⚠️ 실제 vault의 `doc_kind: todo` / `todos`. */
  it("단수와 복수가 같이 있으면 잡는다", () => {
    const out = audit([
      mk("/v/a.md", { doc_kind: "todo" }),
      mk("/v/b.md", { doc_kind: "todos" }),
      mk("/v/c.md", { doc_kind: "plan" }),
    ]);
    expect(shape(out)).toContain("doc_kind:plural:todo|todos");
  });

  it("대소문자만 다른 값을 잡는다", () => {
    const out = audit([
      mk("/v/a.md", { topic: "Search" }),
      mk("/v/b.md", { topic: "search" }),
    ]);
    expect(shape(out)).toContain("topic:case-only:Search|search");
  });

  /** ⚠️ 실제 vault의 `status: 완료` / `완료 — #232`. 설명이 값을 먹은 것. */
  it("한 값이 다른 값의 접두사면 잡는다", () => {
    const out = audit([
      ...many(MIN_ENUM_NOTES, "status", "완료"),
      mk("/v/x.md", { props: { status: ["완료 — #232"] } }),
    ]);
    expect(shape(out)).toContain("status:prefix:완료|완료 — #232");
  });

  it("값별 노트 수를 같이 낸다", () => {
    const out = audit([
      mk("/v/a.md", { doc_kind: "todo" }),
      mk("/v/b.md", { doc_kind: "todos" }),
      mk("/v/c.md", { doc_kind: "todos" }),
    ]);
    const row = out.find((r) => r.kind === "plural")!;
    expect(row.values).toEqual([
      { value: "todo", count: 1 },
      { value: "todos", count: 2 },
    ]);
  });

  /** 결정성 — 같은 입력이면 같은 순서. */
  it("필드 이름순, 그 다음 값 이름순", () => {
    const out = audit([
      mk("/v/a.md", { topic: "Ui", doc_kind: "plan" }),
      mk("/v/b.md", { topic: "ui", doc_kind: "plans" }),
    ]);
    expect(out.map((r) => r.field)).toEqual(["doc_kind", "topic"]);
  });
});

describe("⚠️ 안 찾는 것 — 목록이 시끄러우면 아무도 안 본다", () => {
  /**
   * ⚠️ **자유 서술 필드는 감사 대상이 아니다.** `title`은 노트마다 다른 게 정상이고,
   * 그걸 \"값이 갈렸다\"고 하면 모든 노트가 걸린다. 열거형처럼 쓰이는 필드만 본다 —
   * 값이 반복되는 필드가 열거형이다. 판정은 목록이 아니라 **모양**으로 한다.
   */
  it("값이 노트마다 다른 필드는 안 본다", () => {
    const infos = Array.from({ length: 20 }, (_, i) =>
      mk(`/v/${i}.md`, { props: { description: [`설명 ${i}`] } }),
    );
    expect(audit(infos)).toEqual([]);
  });

  it("쓰는 노트가 적은 props 필드는 안 본다", () => {
    const out = audit([
      mk("/v/a.md", { props: { phase: ["A"] } }),
      mk("/v/b.md", { props: { phase: ["a"] } }),
    ]);
    expect(out).toEqual([]);
  });

  /**
   * ⚠️ `doc_kind`·`topic`은 노트가 적어도 본다 — **질의로 거를 수 있는 필드**라
   * 갈리면 바로 답이 틀린다(`lapis list doc-kinds` · `lapis_query`).
   */
  it("doc_kind·topic 은 노트가 적어도 본다", () => {
    const out = audit([
      mk("/v/a.md", { doc_kind: "Plan" }),
      mk("/v/b.md", { doc_kind: "plan" }),
    ]);
    expect(out).toHaveLength(1);
  });

  it("값이 하나뿐이면 갈릴 게 없다", () => {
    const out = audit([
      mk("/v/a.md", { doc_kind: "plan" }),
      mk("/v/b.md", { doc_kind: "plan" }),
    ]);
    expect(out).toEqual([]);
  });

  /** 대소문자로 이미 알린 것을 복수로 또 알리지 않는다 — 태그 감사와 같은 규칙. */
  it("같은 조합을 두 번 알리지 않는다", () => {
    const out = audit([
      mk("/v/a.md", { doc_kind: "Todo" }),
      mk("/v/b.md", { doc_kind: "todo" }),
    ]);
    expect(out.map((r) => r.kind)).toEqual(["case-only"]);
  });

  /**
   * ⚠️ 접두사 판정은 **경계에서 끊겨야** 한다. `plan`이 `planning`의 접두사라고
   * 보고하면 서로 다른 두 낱말을 같은 것이라 우기는 셈이다.
   */
  it("낱말 중간에서 끊기는 접두사는 아니다", () => {
    const out = audit([
      ...many(MIN_ENUM_NOTES, "state", "plan"),
      mk("/v/x.md", { props: { state: ["planning"] } }),
    ]);
    expect(out.filter((r) => r.kind === "prefix")).toEqual([]);
  });
});

describe("⚠️ 상호참조 필드 — 실측으로 걸러낸 오탐", () => {
  /**
   * 이 규칙을 넣기 전 실제 vault에서 나온 목록의 **절반이 `related`** 였다:
   * `feeds` · `feeds-excerpt-only` · `feeds-settings-hardening`.
   *
   * 셋은 **서로 다른 문서**다. 이름이 비슷한 것은 문서 제목의 자연스러운 성질이지
   * 값이 갈린 게 아니다.
   */
  it("값이 노트로 해소되는 필드는 안 본다", () => {
    const out = audit([
      mk("/v/feeds.md"),
      mk("/v/feeds-excerpt-only.md"),
      ...Array.from({ length: MIN_ENUM_NOTES }, (_, i) =>
        mk(`/v/r${i}.md`, { props: { related: ["feeds"] } }),
      ),
      mk("/v/z.md", { props: { related: ["feeds-excerpt-only"] } }),
    ]);
    expect(out.filter((r) => r.field === "related")).toEqual([]);
  });

  /** ⚠️ 카나리아 — 대상 노트가 없으면 상호참조가 아니고, 그러면 다시 걸려야 한다. */
  it("해소되지 않는 이름이면 상호참조가 아니라 값이다", () => {
    const out = audit([
      ...Array.from({ length: MIN_ENUM_NOTES }, (_, i) =>
        mk(`/v/r${i}.md`, { props: { phase: ["alpha"] } }),
      ),
      mk("/v/z.md", { props: { phase: ["Alpha"] } }),
    ]);
    expect(out.map((r) => `${r.field}:${r.kind}`)).toEqual(["phase:case-only"]);
  });

  /** `tags`는 `findTagIssues`가 본다. 두 목록에 같은 것이 나오면 둘 다 덜 믿게 된다. */
  it("tags 는 태그 감사에 맡긴다", () => {
    const out = audit([
      mk("/v/a.md", { props: { tags: ["todo"] } }),
      mk("/v/b.md", { props: { tags: ["todos"] } }),
    ]);
    expect(out).toEqual([]);
  });
});
