import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mount, unmount, flushSync } from "svelte";
import GrepModal from "./GrepModal.svelte";
import { computeReplacePreview } from "./replacePlan";
import {
  grepOpen,
  grepPattern,
  grepResult,
  grepReplacement,
  replacePreview,
  replaceError,
  replaceEngineSkew,
  replaceBusy,
} from "$lib/stores/grep";
import type { GrepResult } from "$lib/tauri/grep";

/**
 * `⌘⇧G` 안의 **찾아 바꾸기 패널**이 실제로 그리는 것을 본다.
 *
 * ## 왜 이 테스트가 있나
 *
 * 치환 계획(`$lib/replacePlan`)은 순수 함수라 `replacePlan.test.ts`가 고정하고,
 * CLI(`lapis replace`)도 같은 함수를 쓴다. **계산은 검증돼 있었다.**
 *
 * 안 닿은 곳은 **경고를 화면에 실제로 내는가**였다. 그리고 이 패널에서는 그게 특히
 * 무겁다 — 여기 뜨는 경고가 사용자가 **되돌릴 수 없는 쓰기**를 승인하기 전에 보는
 * 마지막 정보다. 계산이 맞아도 `{#if}` 하나가 뒤집혀 있으면 아무 에러 없이
 * **경고만 조용히 사라진다.**
 *
 * ⚠️ 여기서 store를 직접 채우는 이유: `computeReplace()`는 `readNote`(Tauri)를 탄다.
 * 이 테스트가 보려는 것은 IPC가 아니라 마크업이라, store에 **실제 `computeReplacePreview`
 * 결과**를 넣어 경계를 그대로 재현한다. 손으로 만든 가짜를 넣으면 모양이 갈라진다.
 */

const notes = (o: Record<string, string>) => new Map(Object.entries(o));

/** grep이 파일을 찾은 상태 — 패널은 결과가 있을 때만 나온다. */
function grepFound(paths: string[]): GrepResult {
  return {
    // ⚠️ `GrepHit`에 `name`은 없다. 예전엔 넣어 뒀는데 `.map` 결과라 **초과 프로퍼티
    //    검사를 빠져나가** 타입 검사가 통과했다. 픽스처가 실제 타입과 갈리면 테스트가
    //    실제와 다른 모양을 검증하게 된다.
    hits: paths.map((path, i) => ({
      path,
      line: i + 1,
      text: "x",
      col: 0,
      len: 1,
      clipped: false,
    })),
    files: paths.length,
    scanned: paths.length,
    truncated: false,
  };
}

let host: HTMLDivElement;
let comp: Record<string, unknown> | null = null;

function render() {
  host = document.createElement("div");
  document.body.appendChild(host);
  comp = mount(GrepModal, { target: host });
  flushSync();
}

const textOf = (sel: string) =>
  [...document.querySelectorAll(sel)].map((e) => e.textContent?.trim() ?? "");
const warns = () => textOf(".replace-panel .warn");
const numsIn = (s: string) => (s.match(/\d+/g) ?? []).map(Number);

beforeEach(() => {
  grepOpen.set(true);
  grepPattern.set("창");
  grepReplacement.set("윈도우");
  grepResult.set(grepFound(["/v/a.md"]));
  replaceError.set(null);
  replaceEngineSkew.set(0);
  replaceBusy.set(false);
  replacePreview.set(null);
  render();
});

afterEach(() => {
  if (comp) unmount(comp);
  comp = null;
  host?.remove();
  grepOpen.set(false);
  grepResult.set(null);
  replacePreview.set(null);
  replaceError.set(null);
  replaceEngineSkew.set(0);
});

describe("치환 줄", () => {
  it("검색 결과가 있으면 나온다", () => {
    expect(document.querySelector(".replace-row input")).not.toBeNull();
  });

  /** 결과가 0건이면 바꿀 것이 없다. 입력칸이 떠 있으면 눌러도 아무 일이 없는 표면이 된다. */
  it("검색 결과가 없으면 안 나온다", () => {
    grepResult.set(grepFound([]));
    flushSync();
    expect(document.querySelector(".replace-row")).toBeNull();
  });

  it("미리보기 전에는 패널이 없다", () => {
    expect(document.querySelector(".replace-panel")).toBeNull();
  });
});

describe("경고 — 되돌릴 수 없는 쓰기 앞에서 보는 것", () => {
  /**
   * 치환문이 패턴에 다시 걸리면 **두 번 실행하면 두 번 자란다.** 사용자가 결과를 보고
   * 한 번 더 누르는 것은 흔한 일이라 미리 말해야 한다.
   */
  it("치환문이 다시 매치되면 경고한다", () => {
    replacePreview.set(computeReplacePreview(notes({ "/v/a.md": "창" }), "창", "창창", {}));
    flushSync();
    expect(warns()).toHaveLength(1);
  });

  it("안전한 치환에는 경고가 없다", () => {
    replacePreview.set(computeReplacePreview(notes({ "/v/a.md": "창" }), "창", "윈도우", {}));
    flushSync();
    expect(warns()).toHaveLength(0);
    // 그래도 패널과 요약은 나와야 한다 — 경고가 없다고 화면이 비면 안 된다.
    expect(document.querySelector(".replace-panel")).not.toBeNull();
    expect(textOf(".replace-panel .summary")).toHaveLength(1);
  });

  /** frontmatter를 건드리면 YAML이 깨질 수 있다. 막지는 않고 **몇 건인지** 말한다. */
  it("frontmatter 안의 건수를 경고에 담는다", () => {
    replacePreview.set(
      computeReplacePreview(notes({ "/v/a.md": "---\ntitle: 창\n---\n본문 창" }), "창", "윈도우", {}),
    );
    flushSync();
    const w = warns();
    expect(w).toHaveLength(1);
    expect(numsIn(w[0])).toContain(1);
  });

  /**
   * ⚠️ **엔진이 갈렸다는 신호.** 검색은 Rust `regex`, 치환은 JS `RegExp`라 매치 지점이
   * 다를 수 있다. 이때 앱은 **검색이 찾은 파일을 건드리지 않고 넘어가는데**, 그걸
   * 말해주지 않으면 사용자는 "다 바뀌었다"고 믿는다.
   */
  it("엔진이 갈리면 몇 개가 빠졌는지 말한다", () => {
    replacePreview.set(computeReplacePreview(notes({ "/v/a.md": "창" }), "창", "윈도우", {}));
    replaceEngineSkew.set(2);
    flushSync();
    const w = warns();
    expect(w).toHaveLength(1);
    expect(numsIn(w[0])).toContain(2);
  });

  /**
   * 셋이 한꺼번에 걸릴 수 있다. 하나만 그리는 구현이면 나머지가 조용히 사라진다.
   *
   * **목록보다 위에** 있어야 한다는 것도 같이 본다 — 아래로 밀리면 없는 것과 같다.
   */
  it("셋이 동시에 걸리면 셋 다 나오고, 요약보다 위에 있다", () => {
    replacePreview.set(
      computeReplacePreview(notes({ "/v/a.md": "---\ntitle: 창\n---\n창" }), "창", "창창", {}),
    );
    replaceEngineSkew.set(3);
    flushSync();
    expect(warns()).toHaveLength(3);

    const kids = [...(document.querySelector(".replace-panel")?.children ?? [])];
    const lastWarn = kids.findLastIndex((e) => e.classList.contains("warn"));
    const summary = kids.findIndex((e) => e.classList.contains("summary"));
    expect(lastWarn).toBeGreaterThanOrEqual(0);
    expect(summary).toBeGreaterThan(lastWarn);
  });
});

describe("요약과 확인", () => {
  it("노트 수와 건수를 낸다", () => {
    replacePreview.set(
      computeReplacePreview(notes({ "/v/a.md": "창 창", "/v/b.md": "창" }), "창", "윈도우", {}),
    );
    flushSync();
    // 노트 2개 · 3건. 문구가 아니라 숫자만 본다.
    expect(numsIn(textOf(".replace-panel .summary")[0])).toEqual([2, 3]);
  });

  it("적용 버튼이 대상 노트 수를 달고 나온다", () => {
    replacePreview.set(
      computeReplacePreview(notes({ "/v/a.md": "창", "/v/b.md": "창" }), "창", "윈도우", {}),
    );
    flushSync();
    const apply = document.querySelector(".replace-actions .apply");
    expect(apply).not.toBeNull();
    expect(numsIn(apply!.textContent ?? "")).toContain(2);
  });

  /** 쓰는 중에는 두 번 누를 수 없어야 한다 — 트랜잭션이 겹치면 백업이 어긋난다. */
  it("작업 중에는 버튼이 잠긴다", () => {
    replacePreview.set(computeReplacePreview(notes({ "/v/a.md": "창" }), "창", "윈도우", {}));
    replaceBusy.set(true);
    flushSync();
    expect(document.querySelector<HTMLButtonElement>(".apply")?.disabled).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".cancel")?.disabled).toBe(true);
  });

  /** 바뀔 것이 없으면 적용 버튼을 아예 안 낸다. 눌러도 아무 일 없는 버튼을 두지 않는다. */
  it("바뀔 것이 없으면 적용 버튼이 없다", () => {
    replacePreview.set(computeReplacePreview(notes({ "/v/a.md": "다른 말" }), "창", "윈도우", {}));
    flushSync();
    expect(document.querySelector(".replace-actions")).toBeNull();
    expect(document.querySelector(".replace-panel .summary")).not.toBeNull();
  });
});

describe("오류", () => {
  /**
   * ⚠️ **실패는 화면에 남아야 한다.** 실패했는데 닫아 버리면 아무것도 안 썼는데
   * 사용자에게는 성공으로 보인다(#212에서 실제로 겪은 부류다).
   */
  it("오류가 있으면 미리보기 대신 오류를 낸다", () => {
    replacePreview.set(computeReplacePreview(notes({ "/v/a.md": "창" }), "창", "윈도우", {}));
    replaceError.set("읽을 수 없는 정규식");
    flushSync();
    expect(textOf(".error")).toContain("읽을 수 없는 정규식");
    expect(document.querySelector(".replace-panel")).toBeNull();
  });
});
