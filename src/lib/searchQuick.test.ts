import { describe, it, expect, beforeEach } from "vitest";
import {
  searchQuick,
  searchQuickIncremental,
  resetQuickSearchCache,
  type QuickEntry,
} from "./searchIndex";
import { chosungOf } from "./hangul";

function entry(label: string, ...extraKeys: string[]): QuickEntry {
  const matchKeys = [label, ...extraKeys];
  return {
    path: `/v/${label}.md`,
    primaryLabel: label,
    matchKeys,
    matchKeysLower: matchKeys.map((k) => k.toLowerCase()),
    chosungKeys: matchKeys.map(chosungOf),
    parentPath: "v",
  };
}

const ENTRIES = [
  entry("다크모드_색상이미지_개요_root"),
  entry("다크모드_구현계획"),
  entry("라이트모드_정리"),
  entry("Dark Theme Notes"),
  entry("기본설정"),
];

/** incremental 결과와 순수 searchQuick 결과의 (path, score) 동등성. */
function sameAsFresh(query: string): void {
  resetQuickSearchCache();
  const fresh = searchQuick(query, ENTRIES);
  const inc = searchQuickIncremental(query, ENTRIES);
  expect(inc.map((h) => [h.entry.path, h.score])).toEqual(
    fresh.map((h) => [h.entry.path, h.score]),
  );
}

describe("searchQuickIncremental — 정확성(순수 searchQuick과 동등)", () => {
  beforeEach(() => resetQuickSearchCache());

  it("단발 쿼리는 searchQuick과 동일", () => {
    sameAsFresh("다크");
    sameAsFresh("모드");
    sameAsFresh("dark");
  });

  it("prefix 확장 시퀀스: 누적 호출 결과 == 마지막 쿼리 단발 결과", () => {
    // 점진: "다" → "다크" → "다크모" 순으로 좁혀가며 호출
    searchQuickIncremental("다", ENTRIES);
    searchQuickIncremental("다크", ENTRIES);
    const incremental = searchQuickIncremental("다크모", ENTRIES);
    resetQuickSearchCache();
    const fresh = searchQuick("다크모", ENTRIES);
    expect(incremental.map((h) => h.entry.path)).toEqual(fresh.map((h) => h.entry.path));
  });

  it("하위 랭크가 다음 쿼리에서 상위로 와도 누락 없음(후보군 전체 보관)", () => {
    // "다크모드_구현계획"은 "다"에서 다른 항목보다 하위일 수 있으나 "다크모드_구"에서 살아남아야.
    searchQuickIncremental("다", ENTRIES);
    const inc = searchQuickIncremental("다크모드_구", ENTRIES);
    expect(inc.map((h) => h.entry.primaryLabel)).toContain("다크모드_구현계획");
  });

  it("삭제(비-prefix 변경)는 전체 재스캔으로 정확", () => {
    searchQuickIncremental("다크모드", ENTRIES);
    // "라이트"로 바뀜 — 직전 후보군엔 없지만 전체엔 있음
    const inc = searchQuickIncremental("라이트", ENTRIES);
    expect(inc.map((h) => h.entry.primaryLabel)).toContain("라이트모드_정리");
  });

  it("entries 교체(reindex) 시 캐시 무효화", () => {
    searchQuickIncremental("기본", ENTRIES);
    const fresh2 = [entry("기본정책"), entry("기본값")];
    const inc = searchQuickIncremental("기본", fresh2);
    const labels = inc.map((h) => h.entry.primaryLabel).sort();
    expect(labels).toEqual(["기본값", "기본정책"]);
  });
});

describe("searchQuickIncremental — 초성 모드 전환", () => {
  beforeEach(() => resetQuickSearchCache());

  it("초성 쿼리도 incremental 동작 + 모드 일치 시 prefix 확장", () => {
    // "ㄷㅋ"(초성) → "ㄷㅋㅁㄷ"(초성) — 둘 다 chosung 모드
    searchQuickIncremental("ㄷㅋ", ENTRIES);
    const inc = searchQuickIncremental("ㄷㅋㅁㄷ", ENTRIES);
    resetQuickSearchCache();
    const fresh = searchQuick("ㄷㅋㅁㄷ", ENTRIES);
    expect(inc.map((h) => h.entry.path)).toEqual(fresh.map((h) => h.entry.path));
    expect(inc.map((h) => h.entry.primaryLabel)).toContain("다크모드_색상이미지_개요_root");
  });

  it("모드 전환(초성→일반)은 prefix여도 전체 재스캔", () => {
    // "ㄷ"(초성) 다음 "다크"(일반) — startsWith 아님 + 모드 다름 → 전체 스캔
    searchQuickIncremental("ㄷ", ENTRIES);
    const inc = searchQuickIncremental("다크", ENTRIES);
    resetQuickSearchCache();
    const fresh = searchQuick("다크", ENTRIES);
    expect(inc.map((h) => h.entry.path)).toEqual(fresh.map((h) => h.entry.path));
  });
});
