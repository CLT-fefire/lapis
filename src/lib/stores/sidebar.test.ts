import { describe, it, expect } from "vitest";
import {
  defaultSidebarNav,
  toggleSectionState,
  ensureSectionOpenState,
  setSectionHeightState,
  MIN_SECTION_HEIGHT,
  MAX_SECTION_HEIGHT,
  SECTION_KEYS,
} from "./sidebar";

describe("defaultSidebarNav", () => {
  it("files만 펼침", () => {
    const s = defaultSidebarNav();
    expect(s.sectionOpen.files).toBe(true);
    expect(s.sectionOpen.tags).toBe(false);
    expect(s.sectionOpen.favorites).toBe(false);
  });
  it("SECTION_KEYS 4개", () => {
    expect(SECTION_KEYS).toEqual(["files", "tags", "filters", "favorites"]);
  });
});

describe("toggleSectionState", () => {
  it("개별 토글 (불변 — 새 객체)", () => {
    const s0 = defaultSidebarNav();
    const s1 = toggleSectionState(s0, "tags");
    expect(s1.sectionOpen.tags).toBe(true);
    expect(s0.sectionOpen.tags).toBe(false); // 원본 불변
    expect(toggleSectionState(s1, "tags").sectionOpen.tags).toBe(false);
  });
  it("여러 섹션 동시 펼침 가능 (독립)", () => {
    let s = defaultSidebarNav(); // files true
    s = toggleSectionState(s, "filters");
    s = toggleSectionState(s, "tags");
    expect(s.sectionOpen.files).toBe(true);
    expect(s.sectionOpen.filters).toBe(true);
    expect(s.sectionOpen.tags).toBe(true);
  });
});

describe("ensureSectionOpenState", () => {
  it("닫힌 섹션 열기 (다른 섹션 유지)", () => {
    const s = ensureSectionOpenState(defaultSidebarNav(), "tags");
    expect(s.sectionOpen.tags).toBe(true);
    expect(s.sectionOpen.files).toBe(true); // files 유지
  });
  it("이미 열려있으면 no-op (참조 유지)", () => {
    const s = defaultSidebarNav(); // files true
    expect(ensureSectionOpenState(s, "files")).toBe(s);
  });
});

describe("sectionHeights", () => {
  it("defaultSidebarNav — 전부 null(균등 분배)", () => {
    const s = defaultSidebarNav();
    expect(s.sectionHeights).toEqual({
      files: null,
      tags: null,
      filters: null,
      favorites: null,
    });
  });

  it("setSectionHeightState — px 설정 + 반올림 + 다른 섹션 유지", () => {
    const s = setSectionHeightState(defaultSidebarNav(), "files", 240.6);
    expect(s.sectionHeights.files).toBe(241);
    expect(s.sectionHeights.tags).toBeNull(); // 다른 섹션 유지
  });

  it("setSectionHeightState — [MIN, MAX] 클램프", () => {
    expect(setSectionHeightState(defaultSidebarNav(), "tags", 10).sectionHeights.tags).toBe(
      MIN_SECTION_HEIGHT,
    );
    expect(setSectionHeightState(defaultSidebarNav(), "tags", 99999).sectionHeights.tags).toBe(
      MAX_SECTION_HEIGHT,
    );
  });

  it("setSectionHeightState — null이면 균등 복귀", () => {
    let s = setSectionHeightState(defaultSidebarNav(), "files", 300);
    s = setSectionHeightState(s, "files", null);
    expect(s.sectionHeights.files).toBeNull();
  });

  it("toggleSectionState는 sectionHeights를 보존(...state 전개)", () => {
    let s = setSectionHeightState(defaultSidebarNav(), "files", 300);
    s = toggleSectionState(s, "tags"); // 토글이 heights를 떨구면 안 됨
    expect(s.sectionHeights.files).toBe(300);
    expect(s.sectionOpen.tags).toBe(true);
  });

  it("ensureSectionOpenState도 sectionHeights 보존", () => {
    let s = setSectionHeightState(defaultSidebarNav(), "files", 250);
    s = ensureSectionOpenState(s, "favorites");
    expect(s.sectionHeights.files).toBe(250);
  });
});
