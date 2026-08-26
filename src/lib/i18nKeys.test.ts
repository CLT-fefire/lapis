import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 로케일 메시지 파일의 **키 집합이 서로 같은지** 고정한다.
 *
 * ## 왜 이 테스트가 있나
 *
 * 한쪽에만 있는 키는 **에러가 아니다.** paraglide는 baseLocale로 조용히 폴백하므로,
 * 한국어 UI에 영어 문장이 하나 섞여 나오고 그게 전부다. 빌드도 `svelte-check`도
 * 통과하고, 그 화면을 그 로케일로 열어보지 않으면 영영 모른다.
 *
 * 기능을 추가할 때 메시지를 한쪽에만 넣는 건 흔한 실수다 — 이 저장소는 새 UI마다
 * `ko`·`en` 두 파일을 손으로 맞춰야 한다.
 *
 * ## 값이 아니라 키만 본다
 *
 * 번역 품질이나 미번역(값이 영어 그대로)은 여기서 판단하지 않는다. 그건 사람이
 * 볼 일이고, 기계가 끼어들면 오탐만 만든다. 여기서 잡는 건 **구조적 결손**뿐이다.
 */
describe("i18n 메시지 키", () => {
  const load = (locale: string): Record<string, unknown> =>
    JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"));

  it("ko와 en의 키 집합이 같다", () => {
    const ko = Object.keys(load("ko")).sort();
    const en = Object.keys(load("en")).sort();

    const onlyKo = ko.filter((k) => !en.includes(k));
    const onlyEn = en.filter((k) => !ko.includes(k));

    // 어느 쪽에 없는지까지 보여준다 — 개수만 알려주면 찾아야 한다.
    expect({ onlyKo, onlyEn }).toEqual({ onlyKo: [], onlyEn: [] });
  });

  it("빈 값이 없다 — 폴백과 구분되지 않는 빈 문자열을 막는다", () => {
    for (const locale of ["ko", "en"]) {
      const empty = Object.entries(load(locale))
        .filter(([, v]) => typeof v === "string" && v.trim() === "")
        .map(([k]) => `${locale}:${k}`);
      expect(empty).toEqual([]);
    }
  });
});
