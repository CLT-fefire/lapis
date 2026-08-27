import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SETTINGS_INDEX, searchSettings } from "./settingsIndex";
import ko from "../../messages/ko.json";

/**
 * 설정 검색 — 색인이 **마크업과 어긋나지 않는지**가 절반이다.
 *
 * ⚠️ 항목을 더하고 색인에 안 넣으면 **있는데 안 찾히는** 항목이 생긴다. 에러가 없고,
 * 검색해 본 사람은 "그런 설정이 없나 보다" 하고 만다.
 */

const SRC = readFileSync(
  fileURLToPath(new URL("./SettingsModal.svelte", import.meta.url)),
  "utf-8",
);
const dict = ko as Record<string, string>;
const text = (k: string) => dict[k] ?? "";

describe("색인이 마크업과 맞는다", () => {
  /** ⚠️ 카나리아 — 소스를 못 읽었으면 아래가 빈 문자열을 보고 통과한다. */
  it("소스를 실제로 읽었다", () => {
    expect(SRC).toContain("setting-row");
  });

  /** 마크업의 모든 `.label-title` 이 색인에 있어야 한다. */
  it("마크업의 제목이 전부 색인에 있다", () => {
    const inMarkup = [...SRC.matchAll(/class="label-title">{m\.([a-z_]+)\(\)}/g)].map(
      (m) => m[1],
    );
    expect(inMarkup.length).toBeGreaterThan(3);
    const indexed = new Set(SETTINGS_INDEX.map((e) => e.key));
    const missing = inMarkup.filter((k) => !indexed.has(k));
    expect(missing, `색인에 없는 설정 — 검색해도 안 나온다: ${missing.join(", ")}`).toEqual([]);
  });

  /** 반대 방향 — 색인에만 있고 어디에도 없는 항목은 죽은 결과를 낸다. */
  it("색인의 키가 전부 실재한다", () => {
    for (const e of SETTINGS_INDEX) {
      expect(dict[e.key], `${e.key} 메시지가 없다`).toBeTruthy();
    }
  });

  /** 카테고리가 틀리면 눌러도 엉뚱한 탭으로 간다 — 결과가 있는데 안 보인다. */
  it("각 항목의 카테고리가 마크업의 블록과 맞는다", () => {
    const lines = SRC.split("\n");
    let current: string | null = null;
    const found = new Map<string, string>();
    for (const l of lines) {
      const open = /\{#if cat === "([a-z]+)"\}/.exec(l);
      if (open) current = open[1];
      const title = /class="label-title">{m\.([a-z_]+)\(\)}/.exec(l);
      if (title && current) found.set(title[1], current);
    }
    // ⚠️ **빈 Map이면 위 루프가 아무것도 단언하지 않고 통과한다.** 실제로 그랬다 —
    //    정규식 하나가 안 맞아 `found`가 비었고, 카테고리를 틀리게 바꿔도 초록이었다.
    expect(found.size, "마크업에서 카테고리-제목 짝을 하나도 못 읽었다").toBeGreaterThan(3);
    for (const [key, cat] of found) {
      const e = SETTINGS_INDEX.find((x) => x.key === key);
      expect(e?.cat, `${key} 는 마크업에서 ${cat} 인데 색인은 ${e?.cat}`).toBe(cat);
    }
  });
});

describe("searchSettings", () => {
  it("빈 질의는 아무것도 안 낸다 — 전부 내면 목록이 뜻을 잃는다", () => {
    expect(searchSettings("", text)).toEqual([]);
    expect(searchSettings("   ", text)).toEqual([]);
  });

  it("제목으로 찾는다", () => {
    const hit = searchSettings(dict.settings_mcp_title, text);
    expect(hit.map((e) => e.key)).toContain("settings_mcp_title");
  });

  /** 사람은 이름을 정확히 기억하지 않는다 — 설명에만 있는 낱말로도 닿아야 한다. */
  it("설명으로도 찾는다", () => {
    const word = dict.settings_backup_desc.slice(0, 4);
    expect(searchSettings(word, text).map((e) => e.key)).toContain("settings_backup_title");
  });

  it("띄어쓰기가 달라도 찾는다", () => {
    const withSpaces = dict.settings_css_title;
    const squeezed = withSpaces.replace(/\s+/g, "");
    expect(searchSettings(squeezed, text).map((e) => e.key)).toContain("settings_css_title");
  });

  it("안 맞으면 빈 목록", () => {
    expect(searchSettings("zzzzz없는설정zzzzz", text)).toEqual([]);
  });
});
