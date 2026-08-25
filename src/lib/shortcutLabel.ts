import { isMacPlatform } from "./platform";

/**
 * `commands.ts`의 Mac 표기 단축키를 실행 플랫폼 표기로 옮긴다.
 *
 * 원본을 Mac 표기로 두는 이유 — 이 앱이 Mac에서 자랐고 기호 표기가 한 글자라 팔레트
 * 우측 정렬이 깔끔하다. Windows에서만 풀어 쓴다.
 *
 * ⌘와 ⌃가 **둘 다 Ctrl로 접힌다**. Mac에서 ⌘⌃←는 두 modifier지만 Windows엔 대응이
 * 없으므로 중복을 제거한다(Ctrl+Ctrl+← 같은 표기를 막는다). 실제 매칭은 `keymap.ts`가
 * `,`/`.` 대체 경로를 이미 갖고 있어 기능이 비지 않는다.
 */
const MODIFIER_TO_WINDOWS: Record<string, string> = {
  "⌘": "Ctrl",
  "⌃": "Ctrl",
  "⌥": "Alt",
  "⇧": "Shift",
};

/** 기호 하나로 쓰이는 키 이름들. 나머지 문자(영문·숫자·F2 등)는 그대로 통과한다. */
const KEY_TO_WINDOWS: Record<string, string> = {
  "⌫": "Backspace",
  "⌦": "Delete",
  "↩": "Enter",
  "⎋": "Esc",
  "␣": "Space",
};

/** Windows 관례 순서. Mac 표기 순서(⌘⇧)와 다르므로 재정렬한다. */
const WINDOWS_MODIFIER_ORDER = ["Ctrl", "Alt", "Shift"];

export function formatShortcut(
  macLabel: string,
  mac: boolean = isMacPlatform(),
): string {
  if (mac) return macLabel;

  const modifiers: string[] = [];
  let key = "";

  for (const ch of macLabel) {
    const mod = MODIFIER_TO_WINDOWS[ch];
    if (mod !== undefined) {
      if (!modifiers.includes(mod)) modifiers.push(mod);
      continue;
    }
    key += KEY_TO_WINDOWS[ch] ?? ch;
  }

  modifiers.sort(
    (a, b) => WINDOWS_MODIFIER_ORDER.indexOf(a) - WINDOWS_MODIFIER_ORDER.indexOf(b),
  );

  // modifier가 없으면 원본이 이미 일반 키다(F2 등).
  return [...modifiers, key].filter(Boolean).join("+");
}

/**
 * 마크다운 본문 안의 **백틱 단축키 표기**를 실행 플랫폼에 맞춘다.
 *
 * Welcome 문서와 샘플 노트는 코드가 아니라 콘텐츠라 단축키가 본문에 박혀 있다
 * (`welcomeDoc.ts`). Windows에서 `⌘K`를 그대로 보여주면 **눌러도 동작하지 않는 키**를
 * 안내하게 된다.
 *
 * ⚠️ 백틱 안만 건드린다. 산문 속 "⌘" 언급까지 치환하면 문장이 깨진다.
 * 또한 한 줄 안으로 가둔다(`\n` 제외) — 안 그러면 멀리 떨어진 백틱 두 개가
 * 짝지어져 본문 한 덩어리가 통째로 먹힌다.
 */
export function localizeShortcutsInMarkdown(
  md: string,
  mac: boolean = isMacPlatform(),
): string {
  if (mac) return md;
  return md.replace(
    /`([^`\n]*[⌘⌥⇧⌃][^`\n]*)`/gu,
    (_m, inner: string) => `\`${formatShortcut(inner, false)}\``,
  );
}
