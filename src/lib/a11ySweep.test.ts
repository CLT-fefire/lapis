import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 접근성 전수 점검 — **한 번 훑고 끝나지 않게 못 박는다.**
 *
 * ## 왜 이 가드가 있나
 *
 * 이틀 사이에 세 건이 나왔다: 표 정렬이 키보드로 안 닿음 · `aria-sort` 없음 · 모달 셋이
 * 닫기를 "✕" 라고 읽음. 셋 다 **런타임에 아무 신호도 안 낸다** — 마우스로 쓰는 사람에게는
 * 전부 멀쩡해 보인다.
 *
 * 그래서 사람이 훑는 대신 규칙으로 남긴다.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) svelteFiles(p, out);
    else if (e.name.endsWith(".svelte")) out.push(p);
  }
  return out;
}

const FILES = [...svelteFiles(join(ROOT, "src/lib")), ...svelteFiles(join(ROOT, "src/routes"))];
const rel = (f: string) => f.replace(ROOT, "").replace(/\\/g, "/");

describe("이름이 없는 컨트롤이 없다", () => {
  /**
   * 🔴 **아이콘만 든 버튼은 낭독기에 "버튼"으로만 들린다.**
   *
   * 무엇을 하는 버튼인지 알 방법이 없다. 화면으로는 아이콘이 다 말해 주므로 눈으로는
   * 절대 안 보이는 결함이다.
   */
  it("버튼마다 읽을 수 있는 이름이 있다", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf-8");
      for (const m of src.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
        const [, attrs, body] = m;
        if (/aria-label|title=/.test(attrs)) continue;
        // 주석과 태그를 걷어낸 뒤 남는 것. `{...}` 는 글자로 친다(대개 번역 함수).
        const text = body.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
        if (text.trim()) continue;
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${rel(f)}:${line}`);
      }
    }
    expect(
      offenders,
      `이름 없는 버튼 — aria-label 이나 글자가 필요하다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  /**
   * 🔴 **기호는 이름이 아니다.** `aria-label="✕"` 는 라벨을 붙인 것처럼 보이고 자동 검사도
   * 통과시키지만, 낭독기는 그 기호를 그대로 읽는다. 실제로 모달 셋이 그 상태였다.
   */
  it("기호를 이름으로 쓰지 않는다", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf-8");
      for (const m of src.matchAll(/aria-label="([^"]*)"/g)) {
        const v = m[1].trim();
        if (v === "" || /[\p{L}\p{N}]/u.test(v)) continue;
        offenders.push(`${rel(f)}: aria-label="${v}"`);
      }
    }
    expect(offenders, `기호가 이름으로 쓰였다:\n  ${offenders.join("\n  ")}`).toEqual([]);
  });
});

/**
 * 🔴 **억제에는 근거가 있어야 한다.**
 *
 * `svelte-ignore` 는 정당할 때가 많다(백드롭 클릭은 Escape 가 있고, `role="option"` 은
 * 목록이 키보드로 돈다). 하지만 근거 없이 붙이면 **다음 사람이 진짜 결함과 구별을 못 한다.**
 *
 * ⚠️ 규칙은 "억제하지 마라"가 아니라 **"억제하면 왜인지 적어라"** 다. 못 하게 막으면
 * 우회하려고 더 나쁜 코드를 쓴다.
 */
describe("a11y 억제에는 근거가 붙는다", () => {
  /** 새로 붙이는 억제만 본다 — 이미 있는 것들은 아래 `KNOWN` 에 적어 뒀다. */
  const KNOWN = new Set([
    "src/lib/Autocomplete.svelte",
    "src/lib/CommandPalette.svelte",
    /**
     * 나란히 보기 옆칸 — **위임된 클릭**이다. 본문 안 위키링크는 `{@html}` 로 들어와
     * 컴포넌트가 핸들러를 못 걸어서 컨테이너가 받는다. 실제로 눌리는 것은 `<a>` 이고
     * 키보드는 그 앵커가 이미 받으므로, 컨테이너에 키 핸들러를 더하면 Enter 가 **두 번**
     * 처리된다. `+page.svelte` 의 `handlePreviewClick` 이 같은 이유로 같은 모양이다.
     */
    "src/lib/ComparePane.svelte",
    "src/lib/FileTree.svelte",
    "src/lib/ModalShell.svelte",
    "src/lib/Properties.svelte",
    "src/lib/TabBar.svelte",
    "src/routes/+page.svelte",
  ]);

  it("근거 없는 억제가 새 파일에 안 생긴다", () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      if (KNOWN.has(rel(f))) continue;
      const src = readFileSync(f, "utf-8");
      if (/svelte-ignore a11y/.test(src)) offenders.push(rel(f));
    }
    expect(
      offenders,
      `a11y 억제가 새로 생겼다. 왜 안전한지 주석으로 적고 이 목록에 더한다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});

/**
 * 리사이저는 **드래그만 되던 것**을 키보드로 열었다. 되돌아가지 않게 못 박는다.
 */
describe("리사이저는 키보드로 닿는다", () => {
  const src = readFileSync(join(ROOT, "src/routes/+page.svelte"), "utf-8");

  it("초점을 받는다", () => {
    expect((src.match(/class="sidebar-resizer"/g) ?? []).length).toBe(2);
    expect((src.match(/tabindex="0"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("화살표로 움직인다", () => {
    expect(src).toMatch(/onSidebarResizeKey/);
    expect(src).toMatch(/onContextResizeKey/);
    expect(src).toMatch(/e\.key === "ArrowLeft"/);
  });

  /** ⚠️ ARIA 상 값이 있어야 초점을 받는 컨트롤이다 — 값 없는 separator 는 장식이다. */
  it("값을 낸다", () => {
    expect(src).toMatch(/aria-valuenow=\{\$sidebarWidth\}/);
    expect(src).toMatch(/aria-valuemin=\{MIN_SIDEBAR_WIDTH\}/);
    expect(src).toMatch(/aria-valuenow=\{\$contextWidth\}/);
  });

  /** 더블클릭이 하던 일을 키보드에도 준다 — 한쪽만 있으면 반쪽이다. */
  it("기본값으로 되돌릴 수 있다", () => {
    expect(src).toMatch(/e\.key === "Home" \|\| e\.key === "Enter"/);
  });
});
