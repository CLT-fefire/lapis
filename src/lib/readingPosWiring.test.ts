import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 읽던 자리의 **배선**.
 *
 * ⚠️ 스토어가 전부 초록이어도 화면이 안 부르면 자리는 영영 안 돌아온다 — 에러 없이.
 * 이 저장소에서 반복된 실패다.
 */

const src = readFileSync(
  fileURLToPath(new URL("../routes/+page.svelte", import.meta.url)),
  "utf-8",
);

describe("적는 쪽", () => {
  it("스크롤할 때 자리를 적는다", () => {
    expect(src).toMatch(/rememberCurrentPreviewPos\(\)/);
    expect(src).toMatch(/rememberPos\(path, \{ scroll: el\.scrollTop \}\)/);
  });

  /**
   * 🔴 **rAF 안에서 적으면 안 된다.** 창이 가려지면 rAF 가 한 번도 안 온다(v3.5.1 에서
   * 인덱스가 그렇게 멈췄다). 마지막으로 읽던 자리가 정확히 그때 안 남는다.
   */
  it("rAF 밖에서 적는다", () => {
    const at = src.indexOf("rememberCurrentPreviewPos();");
    const raf = src.indexOf("requestAnimationFrame", src.indexOf("function handlePreviewScroll"));
    expect(at).toBeGreaterThan(-1);
    expect(at, "자리 적기가 rAF 뒤에 있다").toBeLessThan(raf);
  });
});

describe("되돌리는 쪽", () => {
  it("본문이 그려진 뒤에 되돌린다", () => {
    expect(src).toMatch(/afterPreviewRender\(\(\) => void restoreReadingPos\(path\)\)/);
  });

  /**
   * 🔴 **남의 자리로 복원하면 안 된다.** 적용 직전에 경로를 다시 본다 — 그 사이에 또
   * 바뀌었을 수 있고, 그러면 엉뚱한 데로 튄다.
   */
  it("적용 직전에 경로를 다시 확인한다", () => {
    expect(src).toMatch(/\$currentNotePath !== path/);
  });

  /** ⚠️ 복원이 만든 스크롤이 자리를 덮어쓰면 값이 한 틱 낡은 것으로 굳는다. */
  it("복원 중에는 안 적는다", () => {
    expect(src).toMatch(/if \(restoringPos\) return;/);
  });

  /** 사용자가 `[[노트#헤딩]]` 으로 지목한 자리가 우선이다. */
  it("헤딩 앵커가 대기 중이면 건너뛴다", () => {
    expect(src).toMatch(/if \(get\(pendingHeadingAnchor\)\) return;/);
  });
});
