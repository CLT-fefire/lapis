import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 커스텀 크롬의 **잡을 수 있는 면적**.
 *
 * v3.0.0 에서 실제로 이렇게 나왔다: 창이 거의 안 움직이고, 더블클릭 최대화가 안 되고,
 * 캡션 버튼이 눌리지 않았다. 원인 둘 다 **에러 없이** 같은 증상을 만든다.
 *
 * 1. `data-tauri-drag-region` 을 값 없이 주면 **그 요소를 직접 클릭했을 때만** 먹는다.
 *    자식이 덮은 자리는 드래그가 안 되는데, 40px 짜리 줄에서 자식이 안 덮은 자리는
 *    거의 없다. `deep` 이어야 하위 영역까지 잡힌다.
 * 2. `.titlebar` 가 `align-items: center` 면 섹션들이 내용 높이(~28px)만 차지한다.
 *    `height: 100%` 인 캡션 버튼이 그 28px 을 기준으로 잡혀 **hover 사각형이 절반**이
 *    되고, Windows 관례의 46×40 이 아니게 된다.
 *
 * ⚠️ 브라우저 프리뷰에는 `getCurrentWindow` 가 없어 버튼이 조용히 아무 일도 안 한다 —
 * 동작은 실물 창에서만 확인된다. 여기서 고정할 수 있는 것은 **면적의 전제**다.
 */

function src(name: string): string {
  const raw = readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), "utf-8");
  // 주석을 지운다 — 안 지우면 가드가 자기 설명 문구에 맞는다.
  return raw
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TITLEBAR = src("Titlebar.svelte");
const CAPTION = src("CaptionButtons.svelte");
const PANEMENU = src("PaneMenu.svelte");

describe("드래그 영역", () => {
  it("상단바가 deep 드래그 영역이다", () => {
    expect(TITLEBAR).toMatch(/data-tauri-drag-region="deep"/);
  });

  /** ⚠️ 값 없는 속성이 하나라도 남아 있으면 그 자리는 사실상 못 잡는다. */
  it("값 없는 drag-region 이 남아 있지 않다", () => {
    const bare = TITLEBAR.match(/data-tauri-drag-region(?!=)/g) ?? [];
    expect(bare, "값 없는 data-tauri-drag-region 은 직접 클릭만 잡는다").toEqual([]);
  });

  /**
   * ⚠️ 상단바 안에서 열리는 팝업은 **자기 여백을 막아야** 한다. 항목은 버튼이라 Tauri 가
   * 알아서 막지만, `<ul>`·`<li>` 의 빈 자리를 누르면 메뉴 대신 창이 끌린다.
   */
  it("상단바에서 열리는 메뉴가 드래그를 막는다", () => {
    expect(PANEMENU).toMatch(/data-tauri-drag-region="false"/);
  });

  /**
   * 컨트롤에 no-drag 를 손으로 적지 않는다 — Tauri 가 상호작용 role 을 기본으로 막는다.
   * 손으로 적기 시작하면 새 버튼마다 빼먹고, 빼먹은 버튼만 안 눌린다.
   */
  it("컨트롤마다 예외를 손으로 적지 않는다", () => {
    expect(TITLEBAR).not.toMatch(/data-tauri-drag-region="false"/);
  });
});

describe("캡션 버튼 면적", () => {
  /** 섹션이 40px 을 다 써야 그 안의 `height: 100%` 가 40px 로 풀린다. */
  it("상단바가 섹션을 늘린다", () => {
    const m = TITLEBAR.match(/\.titlebar\s*\{[^}]*\}/);
    expect(m, ".titlebar 규칙을 못 찾았다").not.toBeNull();
    expect(m![0]).toMatch(/align-items:\s*stretch/);
  });

  /** 부모 정렬과 무관하게 채운다 — 백분율에 기대면 부모가 center 일 때 절반이 된다. */
  it("캡션 묶음이 stretch 로 채운다", () => {
    const m = CAPTION.match(/\.caption\s*\{[^}]*\}/);
    expect(m, ".caption 규칙을 못 찾았다").not.toBeNull();
    expect(m![0]).toMatch(/align-self:\s*stretch/);
  });

  /** ⚠️ 46px 은 Windows 11 의 값이다. 밀도 토큰으로 바꾸면 조밀 모드에서 좁아진다. */
  it("버튼 폭이 46px 리터럴이다", () => {
    const m = CAPTION.match(/\.cap\s*\{[^}]*\}/);
    expect(m, ".cap 규칙을 못 찾았다").not.toBeNull();
    expect(m![0]).toMatch(/width:\s*46px/);
    expect(m![0], "밀도를 따르면 조밀 모드에서 히트 타깃이 줄어든다").not.toMatch(
      /width:\s*var\(/,
    );
  });

  /** 닫기 hover 는 OS 색이다 — 토큰으로 바꾸면 테마마다 달라진다. */
  it("닫기 hover 가 OS 색이다", () => {
    expect(CAPTION).toMatch(/#c42b1c/i);
  });
});
