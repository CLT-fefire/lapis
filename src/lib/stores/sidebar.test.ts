import { describe, it, expect } from "vitest";
import {
  defaultSidebarNav,
  toggleSectionState,
  ensureSectionOpenState,
  SECTION_KEYS,
} from "./sidebar";

describe("defaultSidebarNav", () => {
  it("files만 펼침", () => {
    const s = defaultSidebarNav();
    expect(s.sectionOpen.files).toBe(true);
    expect(s.sectionOpen.outline).toBe(false);
    expect(s.sectionOpen.favorites).toBe(false);
  });
  it("SECTION_KEYS 5개", () => {
    expect(SECTION_KEYS).toEqual(["files", "outline", "tags", "filters", "favorites"]);
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
    s = toggleSectionState(s, "outline");
    s = toggleSectionState(s, "tags");
    expect(s.sectionOpen.files).toBe(true);
    expect(s.sectionOpen.outline).toBe(true);
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
