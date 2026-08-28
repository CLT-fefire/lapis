/**
 * 설정 항목 색인 — **검색용**.
 *
 * ## 왜 목록을 따로 두나
 *
 * v2.0.0에서 설정을 카테고리로 쪼갠 뒤, 항목이 어느 카테고리에 있는지 모르면 찾을 방법이
 * 없어졌다. 한 줄로 나열하던 때는 `⌘F`로 됐다.
 *
 * 마크업에서 뽑을 수도 있었지만 그러려면 **모든 카테고리를 항상 렌더**해야 한다. 지금은
 * `{#if cat === …}` 라서 안 보는 카테고리는 DOM에 없고, 그 덕에 무거운 CodeMirror
 * (사용자 정의 CSS 편집기)가 그 탭을 열 때만 뜬다. 검색 하나 때문에 그걸 포기하지 않는다.
 *
 * ⚠️ **그래서 진실이 둘이 된다.** 항목을 더하고 여기 안 넣으면 **있는데 안 찾히는** 항목이
 * 생긴다 — 조용하다. `settingsCategories.test.ts`가 마크업과 이 목록을 맞춰 본다.
 */

/** `SettingsModal`의 카테고리 id. */
export type SettingsCatId = "appearance" | "language" | "vault" | "advanced";

export interface SettingsEntry {
  /** 제목 메시지 키 — 표시 문자열은 런타임에 paraglide에서 가져온다. */
  key: string;
  cat: SettingsCatId;
}

/**
 * ⚠️ 순서가 화면 순서와 같아야 사람이 결과를 예측한다.
 *
 * `setting-row`가 아닌 둘(색 테마 · 사용자 정의 CSS)도 들어간다 — 사용자에게는 같은
 * "설정 항목"이고, 마크업 모양이 다르다는 것은 사정이지 이유가 아니다.
 */
export const SETTINGS_INDEX: readonly SettingsEntry[] = [
  { key: "settings_theme_color_title", cat: "appearance" },
  { key: "settings_density_title", cat: "appearance" },
  { key: "settings_motion_label", cat: "appearance" },
  { key: "settings_chrome_label", cat: "appearance" },
  { key: "settings_measure_title", cat: "appearance" },
  { key: "settings_language_title", cat: "language" },
  { key: "settings_backup_title", cat: "vault" },
  { key: "settings_git_title", cat: "vault" },
  { key: "settings_reindex_title", cat: "vault" },
  { key: "settings_mcp_title", cat: "advanced" },
  { key: "settings_css_title", cat: "advanced" },
  { key: "settings_usage_title", cat: "advanced" },
];

/**
 * 질의로 항목을 거른다. 제목과 설명을 **둘 다** 본다 — 사람은 이름을 정확히 기억하지
 * 않는다("백업"은 제목에 없고 설명에만 있을 수 있다).
 *
 * ⚠️ 정규화는 소문자 + 공백 제거다. 한국어 설정 이름은 띄어쓰기가 흔들린다
 * ("찾아 바꾸기" / "찾아바꾸기").
 */
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");

export function searchSettings(
  query: string,
  text: (key: string) => string,
): SettingsEntry[] {
  const q = norm(query);
  if (!q) return [];
  return SETTINGS_INDEX.filter((e) => {
    const title = norm(text(e.key));
    const desc = norm(text(e.key.replace(/_title$/, "_desc")));
    return title.includes(q) || desc.includes(q);
  });
}
