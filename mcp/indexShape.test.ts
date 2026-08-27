import { describe, it, expect } from "vitest";
import { CACHE_VERSION } from "./cache.ts";
import { FULLTEXT_OPTIONS } from "./entry.ts";

/**
 * **인덱스 모양이 바뀌면 `CACHE_VERSION`도 올라가야 한다.**
 *
 * ## 왜 이 가드가 있나
 *
 * `CLAUDE.md`가 이미 경고하고 있었다:
 *
 * > `fullTextOptions.ts`는 `CACHE_VERSION` 보호를 받지 못한다. `searchOptions` 소속이라
 * > 어긋나도 에러가 나지 않는다. 이 파일을 만질 때 특히 주의한다.
 *
 * **경고만 있고 장치가 없었다.** "특히 주의한다"는 사람에게 맡기는 것이고, 사람은 잊는다.
 *
 * 잊으면 어떻게 되나: 낡은 샤드(옛 모양으로 만든 것)를 새 질의 코드가 읽는다. 버전이 같으니
 * 무효화가 안 걸리고, MiniSearch는 없는 필드를 그냥 0으로 친다. **에러 없이 조용히 오답**을
 * 낸다 — 이 저장소가 반복해서 잡아온 부류다.
 *
 * ## ⚠️ 무엇을 지문에 넣고 무엇을 빼나
 *
 * **인덱스 모양**에 영향을 주는 것만 넣는다:
 * - `fields` — 무엇을 색인하나
 * - `tokenize` · `processTerm` — 어떤 토큰으로 저장되나
 *
 * **질의 시점 값은 뺀다** — `boost` · `bm25` · `fuzzy` · `prefix`. 이건 저장된 인덱스를
 * 어떻게 **읽을지**의 문제라 샤드를 무효화할 이유가 없다. 넣으면 랭킹을 한 번 튜닝할 때마다
 * 전체 재빌드가 걸리고, **그러면 사람이 가드를 끈다.** 과민한 가드는 없는 가드보다 나쁘다.
 */

/** 인덱스 모양을 결정하는 것들만 골라 문자열 하나로. 함수는 **이름**으로 본다. */
function shapeOf(): string {
  const o = FULLTEXT_OPTIONS;
  const fnName = (f: unknown) =>
    typeof f === "function" ? ((f as { name?: string }).name ?? "anonymous") : String(f);
  return [
    `fields=[${(o.fields ?? []).join(",")}]`,
    `tokenize=${fnName(o.tokenize)}`,
    `processTerm=${fnName(o.processTerm)}`,
  ].join(" ");
}

/**
 * 지금 모양과 그에 대응하는 캐시 버전.
 *
 * ⚠️ **바꾸려면 둘 다 바꾼다.** 모양만 고치고 버전을 두면 이 테스트가 막는다.
 * 반대로 버전만 올리는 것은 자유다(다른 이유로도 올릴 수 있다).
 */
const PINNED = {
  shape: "fields=[name,title,body] tokenize=koBigramTokenize processTerm=normalizeTerm",
  version: 9,
};

describe("인덱스 모양 ↔ CACHE_VERSION", () => {
  /** ⚠️ 카나리아 — 지문 함수가 깨지면 빈 문자열끼리 비교하며 통과한다. */
  it("지문을 실제로 뽑았다", () => {
    const s = shapeOf();
    expect(s).toContain("fields=[");
    expect(s).toContain("tokenize=");
    // 이름이 지워진 함수(익명·번들러 mangle)면 지문이 무의미해진다.
    expect(s).not.toContain("anonymous");
    expect(s.length).toBeGreaterThan(40);
  });

  it("모양이 못 박은 것과 같다", () => {
    expect(
      shapeOf(),
      "인덱스 모양이 바뀌었다 — `CACHE_VERSION`을 올리고 PINNED도 같이 고쳐라.\n" +
        "  (질의 시점 값(boost·bm25·fuzzy)만 바꿨다면 이 테스트는 안 깨진다 — 그건 의도다.)",
    ).toBe(PINNED.shape);
  });

  it("그 모양에 대응하는 캐시 버전이 맞다", () => {
    expect(
      CACHE_VERSION,
      "모양이 바뀌었는데 `CACHE_VERSION`이 그대로다. 낡은 샤드가 무효화되지 않아 " +
        "**에러 없이 조용히 오답**을 낸다.",
    ).toBe(PINNED.version);
  });

  /**
   * 질의 시점 값은 지문 밖이다. 이걸 못 박아 둬야 다음 사람이 "이 파일은 전부 잠겨 있다"고
   * 오해해서 랭킹 튜닝을 못 하는 일이 없다.
   */
  it("질의 시점 값은 모양에 안 들어간다", () => {
    const s = shapeOf();
    for (const k of ["boost", "bm25", "fuzzy", "prefix"]) {
      expect(s, `${k}는 지문 밖이어야 한다`).not.toContain(k);
    }
  });
});
