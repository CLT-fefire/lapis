/**
 * 색 테마 — 다크 하나 위에 얹는 **프리셋**.
 *
 * ## ⚠️ "두 번째 팔레트 금지"와 어떻게 공존하나
 *
 * v2.0.0 0단계에서 `app.css`의 팔레트 중복을 지우고 `singlePalette.test.ts`로 막아 뒀다.
 * 프리셋은 그 규칙을 **어기지 않는다** — `app.css`에 블록을 더하는 게 아니라 **데이터**로
 * 두고 런타임에 `<style data-lapis="color-theme">`으로 주입한다.
 *
 * 레이어 순서(뒤가 이긴다):
 *
 * ```
 * app.css  →  color-theme  →  user-css
 * ```
 *
 * 사용자 정의 CSS가 항상 마지막이라, 프리셋을 고른 뒤에도 개별 토큰을 덮어쓸 수 있다.
 *
 * ## ⚠️ 왜 **휘도**를 보존하나 — 이게 이 설계의 핵심이다
 *
 * 테마 스물몇 개를 손으로 색 맞추면 그중 몇 개는 반드시 안 읽힌다. 그래서 중립 램프에
 * 색상(H)과 채도(S)를 얹되, **WCAG 상대휘도를 원본과 같게 맞춘다**(`tintNeutral`이
 * 이분 탐색으로 명도를 되돌린다).
 *
 * 대비비는 휘도만으로 정해지므로, 휘도를 보존하면 **대비가 정확히 보존된다** — 어떤 색을
 * 고르든 기본 다크와 같은 가독성이다. 스물여섯을 눈으로 검수하는 대신 성질로 보장한다.
 *
 * ⚠️ 처음엔 **HSL의 L을 고정**하는 것으로 충분한 줄 알았다. 아니다 — L과 상대휘도는
 * 다른 값이고, 같은 L에서 채도를 올리면 휘도가 움직인다. 기본 다크의 `--text-muted`가
 * 정확히 4.50이라 여유가 0이었고, 테스트가 여섯 테마에서 미달을 잡았다. 임계값을 낮추는
 * 대신 **재는 축을 바로잡았다.**
 *
 * 액센트는 명도를 못 물려받으므로(자기 색이 정체성이다) **`--accent-fg`를 계산해서** 고른다
 * — 흰 글자와 검은 글자 중 대비가 큰 쪽. `colorThemes.test.ts`가 전부 AA인지 본다.
 */

/** 기본 다크의 중립 램프. `app.css`의 `:root`와 **같아야 한다**(테스트가 대조한다). */
export const BASE_RAMP: Record<string, string> = {
  "--n-0": "#07080a",
  "--n-50": "#0b0d10",
  "--n-100": "#101317",
  "--n-150": "#14171c",
  "--n-200": "#191d23",
  "--n-250": "#1f242b",
  "--n-300": "#232830",
  "--n-350": "#2b313a",
  "--n-400": "#353c46",
  "--n-500": "#48505c",
  "--n-600": "#6b7482",
  "--n-700": "#99a2af",
  "--n-800": "#bec5d0",
  "--n-900": "#e3e7ec",
  "--n-1000": "#f5f7f9",
};

export interface ColorTheme {
  id: string;
  /** 표시 이름. 색 이름이라 번역하지 않는다. */
  name: string;
  /** 액센트. 테마의 정체성. */
  accent: string;
  /**
   * 중립 램프에 얹을 색조. 없으면 기본 회색 그대로(액센트만 바뀐다).
   *
   * ⚠️ 대비는 안 바뀐다(휘도를 보존한다) — 위 주석 참조.
   */
  tint?: string;
  /** 색조를 얼마나 얹나. 0이면 회색, 1이면 tint의 채도 그대로. 기본 0.22. */
  tintStrength?: number;
}

// ─── 색 변환 ────────────────────────────────────────────────────────────────

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

const hex2 = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
export const rgbToHex = ([r, g, b]: [number, number, number]) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h, s, l];
}

export function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

const srgb = (c: number) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
}

/** WCAG 대비비. 1(같음) ~ 21(흑백). 본문 AA는 4.5. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a),
    lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * 액센트 위에 올릴 글자색 — 흰색과 검정 중 **대비가 큰 쪽**.
 *
 * ⚠️ 고정으로 흰색을 쓰면 밝은 액센트(노랑·라임)에서 안 읽힌다. 그걸 손으로 예외 처리하는
 * 대신 계산으로 정한다 — 액센트를 새로 더할 때 아무도 잊지 않는다.
 */
export function accentForeground(accent: string): string {
  const onWhite = contrastRatio(accent, "#ffffff");
  const onDark = contrastRatio(accent, "#0b0b0d");
  return onWhite >= onDark ? "#ffffff" : "#0b0b0d";
}

/**
 * 중립 색에 색조를 얹는다. **WCAG 상대휘도는 원본과 같게 유지한다.**
 *
 * 색상(H)과 낮춘 채도(S)를 씌우면 "색이 도는 회색"이 되는데, 그것만으로는 휘도가
 * 움직인다. 그래서 명도(L)를 이분 탐색으로 되돌려 휘도를 맞춘다 — **L은 바뀌고 휘도가
 * 고정된다.** 대비비는 휘도만으로 정해지므로 이쪽이 지켜야 할 축이다.
 */
export function tintNeutral(neutral: string, tint: string, strength: number): string {
  const target = luminance(neutral);
  const [, , l0] = rgbToHsl(hexToRgb(neutral));
  const [th, ts] = rgbToHsl(hexToRgb(tint));
  const sat = ts * strength;

  // HSL 명도를 조절해 **원본과 같은 WCAG 상대휘도**를 찾는다. 단조 증가라 이분 탐색이 된다.
  let lo = 0;
  let hi = 1;
  let l = l0;
  for (let i = 0; i < 24; i++) {
    l = (lo + hi) / 2;
    const cur = luminance(rgbToHex(hslToRgb([th, sat, l])));
    if (cur < target) lo = l;
    else hi = l;
  }
  return rgbToHex(hslToRgb([th, sat, l]));
}

// ─── 프리셋 ─────────────────────────────────────────────────────────────────

/**
 * ⚠️ **휘도를 보존하는 설계라 여기 색을 더하는 것이 싸다.** 대비는 자동으로 유지되고,
 * 액센트 글자색은 계산되며, `colorThemes.test.ts`가 전부 AA인지 확인한다.
 *
 * 앞쪽 절반은 회색을 유지하고 액센트만 바꾼다(차분함). 뒤쪽 절반은 배경까지 물들인다.
 */
export const COLOR_THEMES: ColorTheme[] = [
  // ── 액센트만 (기본 회색 유지) ──
  { id: "blurple", name: "Blurple", accent: "#5865f2" },
  { id: "ocean", name: "Ocean", accent: "#3b9ae1" },
  { id: "teal", name: "Teal", accent: "#1abc9c" },
  { id: "forest", name: "Forest", accent: "#3ba55d" },
  { id: "lime", name: "Lime", accent: "#a3c644" },
  { id: "amber", name: "Amber", accent: "#f0b232" },
  { id: "tangerine", name: "Tangerine", accent: "#f47b25" },
  { id: "crimson", name: "Crimson", accent: "#ed4245" },
  { id: "rose", name: "Rose", accent: "#eb459e" },
  { id: "orchid", name: "Orchid", accent: "#a855f7" },
  { id: "lavender", name: "Lavender", accent: "#b39ddb" },
  { id: "slate", name: "Slate", accent: "#8896a6" },
  { id: "mint", name: "Mint", accent: "#4de1c1" },
  { id: "sand", name: "Sand", accent: "#d4b483" },

  // ── 배경까지 물든 것 ──
  { id: "midnight", name: "Midnight", accent: "#5865f2", tint: "#3b4cca" },
  { id: "abyss", name: "Abyss", accent: "#2dd4bf", tint: "#0e7490" },
  { id: "moss", name: "Moss", accent: "#7cb342", tint: "#3c6e2a" },
  { id: "pine", name: "Pine", accent: "#34d399", tint: "#14532d" },
  { id: "ember", name: "Ember", accent: "#fb923c", tint: "#7c2d12" },
  { id: "wine", name: "Wine", accent: "#f472b6", tint: "#701a3f" },
  { id: "plum", name: "Plum", accent: "#c084fc", tint: "#4c1d95" },
  { id: "cocoa", name: "Cocoa", accent: "#d6a06a", tint: "#4a3527" },
  { id: "dusk", name: "Dusk", accent: "#818cf8", tint: "#312e5f" },
  { id: "storm", name: "Storm", accent: "#94a3b8", tint: "#1e293b" },
  { id: "rust", name: "Rust", accent: "#f87171", tint: "#6b2621" },
  { id: "sea", name: "Sea", accent: "#38bdf8", tint: "#0c4a6e" },
];

/** 기본값 — `app.css` 그대로. 프리셋을 안 고른 상태다. */
export const DEFAULT_THEME_ID = "blurple";

export function findTheme(id: string): ColorTheme | undefined {
  return COLOR_THEMES.find((t) => t.id === id);
}

/**
 * 프리셋을 CSS 문자열로. 기본 테마면 **빈 문자열**을 낸다.
 *
 * ⚠️ 기본에서 빈 문자열을 내는 이유: 아무것도 안 덮어쓰는 규칙 뭉치를 주입하면 devtools에서
 * "이 값이 어디서 왔나"를 볼 때 한 겹이 더 낀다. 안 바꿀 거면 아무것도 안 넣는 게 낫다.
 */
export function themeCss(id: string): string {
  const t = findTheme(id);
  if (!t || t.id === DEFAULT_THEME_ID) return "";

  const lines: string[] = [];
  const [ar, ag, ab] = hexToRgb(t.accent);
  lines.push(`  --accent: ${t.accent};`);
  // hover는 조금 밝게 — 다크에서 hover는 밝아진다(`app.css` 주석과 같은 규칙).
  const [h, s, l] = rgbToHsl([ar, ag, ab]);
  lines.push(`  --accent-hover: ${rgbToHex(hslToRgb([h, s, Math.min(0.92, l + 0.1)]))};`);
  lines.push(`  --accent-fg: ${accentForeground(t.accent)};`);
  lines.push(`  --accent-bg-subtle: rgba(${ar}, ${ag}, ${ab}, 0.16);`);
  lines.push(`  --accent-border: rgba(${ar}, ${ag}, ${ab}, 0.42);`);
  lines.push(`  --cm-selection: rgba(${ar}, ${ag}, ${ab}, 0.3);`);

  if (t.tint) {
    for (const [name, value] of Object.entries(BASE_RAMP)) {
      lines.push(`  --${name.slice(2)}: ${tintNeutral(value, t.tint, t.tintStrength ?? 0.22)};`);
    }
  }
  return `:root {\n${lines.join("\n")}\n}\n`;
}
