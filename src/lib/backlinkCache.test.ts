import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * 백링크 발췌 캐시 — **테스트가 0이었다.**
 *
 * ## 🔴 캐시 키가 target 의 **stem** 이었다
 *
 * 키가 `${sourcePath}::${targetNote.source_name}` 였다. 그런데 발췌를 만드는 항목은
 * target 의 **stem · title · aliases** 셋이다 — stem 만으로는 target 을 구별 못 한다.
 *
 * 이름이 같은 노트가 둘이면(이 vault 는 `audit: tags` 기준 **7쌍**) 같은 source 에서
 * 두 target 의 발췌가 **같은 키**를 쓴다. 먼저 계산된 쪽이 이기고, 두 번째 노트는
 * **남의 발췌**를 보여준다. 에러는 없다.
 */

const readNote = vi.fn<(p: string) => Promise<string>>();
vi.mock("$lib/tauri/notes", () => ({ readNote: (p: string) => readNote(p) }));

const { fetchBacklinkContext, clearBacklinkCache, invalidateCacheBySource } = await import(
  "./backlinks"
);

type Info = Parameters<typeof fetchBacklinkContext>[0];

function info(path: string, title: string | null = null, aliases: string[] = []): Info {
  return {
    source_path: path,
    source_name: path.split("/").pop()!.replace(/\.md$/, ""),
    title,
    aliases,
    doc_kind: null,
    topic: null,
    tags: [],
    targets: [],
    related: [],
    props: {},
  } as unknown as Info;
}

beforeEach(() => {
  clearBacklinkCache();
  readNote.mockReset();
});

describe("발췌", () => {
  it("본문에서 target 이름 둘레를 뽑는다", async () => {
    readNote.mockResolvedValue("앞부분 " + "x".repeat(80) + " STATE 를 참고 " + "y".repeat(80));
    const r = await fetchBacklinkContext(info("/v/src.md"), info("/v/a/STATE.md"));
    expect(r.matched).toBe(true);
    expect(r.snippet).toContain("STATE");
  });

  it("본문을 못 읽어도 던지지 않는다", async () => {
    readNote.mockRejectedValue(new Error("boom"));
    const r = await fetchBacklinkContext(info("/v/src.md"), info("/v/a/STATE.md"));
    expect(r.matched).toBe(false);
    expect(r.snippet).toBe("");
  });

  it("같은 쌍은 한 번만 읽는다", async () => {
    readNote.mockResolvedValue("STATE 언급");
    const src = info("/v/src.md");
    const tgt = info("/v/a/STATE.md");
    await fetchBacklinkContext(src, tgt);
    await fetchBacklinkContext(src, tgt);
    expect(readNote).toHaveBeenCalledTimes(1);
  });
});

describe("🔴 동명 노트가 캐시를 나눠 쓰면 안 된다", () => {
  /**
   * 두 target 이 **같은 stem, 다른 title**. 발췌는 title 로도 매칭하므로 결과가 달라야
   * 한다. 키가 stem 뿐이면 두 번째가 첫 번째의 결과를 그대로 받는다.
   */
  it("stem 이 같고 title 이 다르면 결과도 달라야 한다", async () => {
    readNote.mockResolvedValue("여기서는 라피스 상태 만 언급한다");
    const src = info("/v/src.md");
    const lapis = info("/v/lapis/STATE.md", "라피스 상태");
    const slate = info("/v/slate/STATE.md", "슬레이트 상태");

    const a = await fetchBacklinkContext(src, lapis);
    const b = await fetchBacklinkContext(src, slate);

    expect(a.matched, "본문에 '라피스 상태' 가 있다").toBe(true);
    expect(
      b.matched,
      "'슬레이트 상태' 는 본문에 없다 — matched 가 true 면 남의 캐시를 받은 것이다",
    ).toBe(false);
  });

  it("stem 이 같아도 각각 읽는다", async () => {
    readNote.mockResolvedValue("아무 내용");
    const src = info("/v/src.md");
    await fetchBacklinkContext(src, info("/v/lapis/STATE.md", "라피스"));
    await fetchBacklinkContext(src, info("/v/slate/STATE.md", "슬레이트"));
    expect(readNote, "둘은 다른 질문이다").toHaveBeenCalledTimes(2);
  });
});

describe("무효화", () => {
  it("source 별로 지운다", async () => {
    readNote.mockResolvedValue("STATE");
    const tgt = info("/v/a/STATE.md");
    await fetchBacklinkContext(info("/v/one.md"), tgt);
    await fetchBacklinkContext(info("/v/two.md"), tgt);
    expect(readNote).toHaveBeenCalledTimes(2);

    invalidateCacheBySource("/v/one.md");
    await fetchBacklinkContext(info("/v/one.md"), tgt);
    expect(readNote, "one 만 다시 읽어야 한다").toHaveBeenCalledTimes(3);
    await fetchBacklinkContext(info("/v/two.md"), tgt);
    expect(readNote, "two 는 캐시가 살아 있어야 한다").toHaveBeenCalledTimes(3);
  });

  /** ⚠️ 접두사가 겹치는 다른 경로를 같이 지우면 안 된다. */
  it("경로 접두사가 겹쳐도 남의 것을 안 지운다", async () => {
    readNote.mockResolvedValue("STATE");
    const tgt = info("/v/a/STATE.md");
    await fetchBacklinkContext(info("/v/one.md"), tgt);
    await fetchBacklinkContext(info("/v/one-more.md"), tgt);
    invalidateCacheBySource("/v/one.md");
    await fetchBacklinkContext(info("/v/one-more.md"), tgt);
    expect(readNote, "one-more 는 그대로여야 한다").toHaveBeenCalledTimes(2);
  });

  it("전체 클리어", async () => {
    readNote.mockResolvedValue("STATE");
    const src = info("/v/src.md");
    const tgt = info("/v/a/STATE.md");
    await fetchBacklinkContext(src, tgt);
    clearBacklinkCache();
    await fetchBacklinkContext(src, tgt);
    expect(readNote).toHaveBeenCalledTimes(2);
  });
});
