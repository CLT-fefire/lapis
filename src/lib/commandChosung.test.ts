import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isStrongCommandMatch } from "./palette";
import { fuzzyMatchLabel } from "./searchIndex";
import { chosungOf, isChosungQuery } from "./hangul";

/**
 * 🔴 **초성이 파일명에는 되는데 명령에는 안 됐다.**
 *
 * ## 실측
 *
 * ```
 * fuzzyMatch("ㅇㅅ", "vault 위생") = null
 * fuzzyMatch("ㅅㅌ", "새 탭")      = null
 * ```
 *
 * `⌘P` 로 파일을 찾을 때는 `ㅅㅌ` 이 먹는다 — `searchIndex` 가 항목마다 `chosungKeys` 를
 * 미리 계산해 두고 `isChosungQuery` 로 갈라 탄다. 그런데 `matchCommands` 는 그 경로를
 * 안 타고 라벨 원문에 바로 `fuzzyMatch` 를 걸었다. 라벨에 낱자(ㅅ·ㅌ)가 들어 있을 리
 * 없으니 **언제나 `null`** 이다.
 *
 * 같은 팔레트 안에서 **한쪽만 초성이 되는** 비대칭이고, 한국어로 쓰는 도구에서 눈에 띈다.
 *
 * ## ⚠️ 왜 `matchCommands` 를 직접 안 부르나
 *
 * 테스트 하네스의 로케일은 **`en`** 이다(`project.inlang` 의 `baseLocale`). 그래서
 * `matchCommands("ㅅㅌ")` 로는 한국어 라벨을 만날 수가 없다 — 통과해도 아무것도 증명하지
 * 못한다. 판정을 **순수 함수**로 떼어 라벨 문자열을 직접 넣는다. 로케일과 무관하게 같은
 * 답이 나오는 것이 이 검사의 요점이다. 배선은 아래 "배선" 절이 따로 본다.
 *
 * ## ⚠️ 라벨 초성을 미리 계산해 두지 않는다
 *
 * 명령 라벨은 **getter** 다(`commands.ts` — 로케일이 바뀌면 따라와야 해서). 모듈 최상위에서
 * `chosungOf` 를 미리 돌려 두면 언어를 바꿔도 옛 초성이 남는다. 21개짜리 짧은 문자열이라
 * 입력마다 계산해도 싸다.
 */

describe("초성 질의 판정", () => {
  it("낱자만 있으면 초성 질의다", () => {
    expect(isChosungQuery("ㅅㅌ")).toBe(true);
    expect(isChosungQuery("새 탭")).toBe(false);
    expect(isChosungQuery("vault")).toBe(false);
  });

  it("라벨을 초성으로 접는다", () => {
    expect(chosungOf("새 탭")).toBe("ㅅ ㅌ");
    // ⚠️ 한글이 아닌 글자는 그대로 (소문자로) 통과한다.
    expect(chosungOf("Vault 진단")).toBe("vault ㅈㄷ");
  });
});

describe("초성으로 라벨을 찾는다", () => {
  const hit = (q: string, label: string) => fuzzyMatchLabel(q, label) !== null;

  it("한 낱말 초성", () => {
    expect(hit("ㅎㄴ", "한눈에 보기")).toBe(true);
  });

  /** 🔴 낱말을 가로지르는 초성 — `ㅅㄴㅌ` 이 `새 노트` 를 가리킨다. */
  it("낱말을 가로지르는 초성", () => {
    expect(hit("ㅅㄴㅌ", "새 노트")).toBe(true);
    expect(hit("ㅅㅌ", "새 탭")).toBe(true);
  });

  it("한글이 섞인 라벨", () => {
    expect(hit("ㅈㄷ", "Vault 진단 — 속성")).toBe(true);
  });

  /** ⚠️ 초성이 아닌 질의는 예전 그대로여야 한다 — 고치면서 망가뜨리지 않는다. */
  it("보통 질의는 그대로", () => {
    expect(hit("탭", "새 탭")).toBe(true);
    expect(hit("vault", "Vault 열기…")).toBe(true);
    expect(hit("New", "New Note")).toBe(true);
  });

  /** ⚠️ 아무 낱자에나 전부 걸리면 목록이 무의미해진다. */
  it("안 맞는 초성은 안 걸린다", () => {
    expect(hit("ㅃㅃㅃ", "새 탭")).toBe(false);
    expect(hit("ㅋㅋ", "한눈에 보기")).toBe(false);
  });

  /** ⚠️ 영어 라벨에 초성 질의가 걸리면 안 된다 — 낱자가 거기 있을 리 없다. */
  it("영어 라벨은 초성으로 안 걸린다", () => {
    expect(hit("ㅅㅌ", "New Tab")).toBe(false);
  });
});

describe("초성도 맨 위로 승격된다", () => {
  /**
   * ⚠️ 찾히기만 하고 **맨 아래 그룹**에 있으면 반쪽이다. `topCommands` 로 올라와야
   * 본문 검색 결과보다 먼저 보인다(`palette.ts` 의 `GROUP_ORDER`).
   */
  it("한 낱말 초성이 강한 매치다", () => {
    expect(isStrongCommandMatch("ㅎㄴ", "한눈에 보기")).toBe(true);
    expect(isStrongCommandMatch("ㅌㄱ", "태그 이름 바꾸기 · 병합")).toBe(true);
  });

  it("낱말을 가로지르는 초성도 강한 매치다", () => {
    expect(isStrongCommandMatch("ㅅㄴㅌ", "새 노트")).toBe(true);
    expect(isStrongCommandMatch("ㅅㅌ", "새 탭")).toBe(true);
  });

  /** ⚠️ 안 맞는 것을 올리면 승격이 뜻을 잃는다. */
  it("안 맞으면 안 올린다", () => {
    expect(isStrongCommandMatch("ㅃㅃ", "새 탭")).toBe(false);
    // 낱말 **접두**는 맞다.
    expect(isStrongCommandMatch("ㄴㅌ", "새 노트 만들기")).toBe(true);
    // 낱말을 건너뛴 조합은 아니다.
    expect(isStrongCommandMatch("ㅌㅁ", "새 노트 만들기")).toBe(false);
  });

  /** 기존 동작 — 글자 그대로의 낱말 접두. */
  it("보통 질의 승격은 그대로", () => {
    expect(isStrongCommandMatch("탭", "새 탭")).toBe(true);
    expect(isStrongCommandMatch("vault", "Vault 열기…")).toBe(true);
    expect(isStrongCommandMatch("생", "vault 위생")).toBe(false);
  });
});

/**
 * ⚠️ 순수 함수만 검사하면 **아무도 그걸 안 불러도 초록**이다.
 */
describe("배선", () => {
  const src = readFileSync(fileURLToPath(new URL("./commands.ts", import.meta.url)), "utf-8");

  it("matchCommands 가 초성 아는 함수를 쓴다", () => {
    expect(src).toMatch(/fuzzyMatchLabel\(/);
    // ⚠️ 라벨에 초성 모르는 `fuzzyMatch` 를 그대로 걸면 안 된다.
    expect(src, "라벨에 초성 모르는 함수를 건다").not.toMatch(/fuzzyMatch\(q, command\.label\)/);
  });

  /** id 는 영어라 초성을 볼 이유가 없다 — 괜히 두 번 접지 않는다. */
  it("id 는 그대로 fuzzyMatch", () => {
    expect(src).toMatch(/fuzzyMatch\(q, command\.id\)/);
  });
});
