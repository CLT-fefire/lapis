import { describe, it, expect, beforeEach, vi } from "vitest";
import { enhanceRendered, type RenderedLabels } from "./renderedEnhance";

/**
 * 렌더된 본문의 **배선**.
 *
 * ⚠️ 순수 함수(`renderedActions.ts`)가 전부 초록이어도 DOM 에 안 붙으면 화면은 그대로다 —
 * 에러 없이. 이 세션에서 실제로 여러 번 겪은 실패다.
 */

const LABELS: RenderedLabels = {
  copy: "복사",
  copied: "복사됨",
  copyMarkdown: "마크다운으로 복사",
  copyCsv: "CSV로 복사",
  sortHint: "눌러서 정렬",
};

const writeText = vi.fn<(t: string) => Promise<void>>();

beforeEach(() => {
  document.body.innerHTML = "";
  writeText.mockReset();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "rendered";
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const TABLE = `
<table>
  <thead><tr><th>이름</th><th>수</th></tr></thead>
  <tbody>
    <tr><td>나</td><td>2</td></tr>
    <tr><td>가</td><td>10</td></tr>
    <tr><td>다</td><td>1</td></tr>
  </tbody>
</table>`;

describe("코드블록 복사", () => {
  it("버튼을 붙인다", () => {
    const el = root('<pre class="hljs"><code>echo hi</code></pre>');
    enhanceRendered(el, LABELS);
    expect(el.querySelector(".rendered-copy")?.textContent).toBe("복사");
  });

  it("코드 내용을 복사한다", () => {
    const el = root('<pre class="hljs"><code>echo hi</code></pre>');
    enhanceRendered(el, LABELS);
    el.querySelector<HTMLButtonElement>(".rendered-copy")!.click();
    expect(writeText).toHaveBeenCalledWith("echo hi");
  });

  /** ⚠️ 아무 반응이 없으면 복사됐는지 알 수 없어 다시 누르게 된다. */
  it("성공을 말한다", async () => {
    const el = root('<pre class="hljs"><code>x</code></pre>');
    enhanceRendered(el, LABELS);
    const btn = el.querySelector<HTMLButtonElement>(".rendered-copy")!;
    btn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.textContent).toBe("복사됨");
  });

  /** ⚠️ 클립보드가 막혀 있어도 **던지면 안 된다** — 본문 렌더가 그것 때문에 죽는다. */
  it("복사 실패해도 안 죽는다", () => {
    writeText.mockRejectedValue(new Error("denied"));
    const el = root('<pre class="hljs"><code>x</code></pre>');
    enhanceRendered(el, LABELS);
    expect(() => el.querySelector<HTMLButtonElement>(".rendered-copy")!.click()).not.toThrow();
  });
});

describe("표 정렬", () => {
  it("머리글이 눌리는 상태가 된다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    expect(el.querySelectorAll("th.sortable")).toHaveLength(2);
  });

  /**
   * 🔴 **키보드로 정렬할 수 없었다.** 머리글에 클릭 리스너만 있고 `tabindex` 도 버튼도
   * 없어서, 마우스가 없으면 이 기능에 **닿을 방법이 아예 없다.** 단축키로 도는 앱에서
   * 마우스 전용 조작은 앞뒤가 안 맞는다. 프리뷰에서 머리글 속성을 읽어 보고 걸렸다.
   */
  it("키보드로 정렬한다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    const th = el.querySelector<HTMLElement>("th.sortable")!;
    const btn = th.querySelector<HTMLButtonElement>("button");
    expect(btn, "머리글에 초점 받을 수 있는 컨트롤이 없다").not.toBeNull();

    const before = names(el).join();
    btn!.click();
    expect(names(el).join(), "키보드로 닿는 컨트롤이 정렬을 안 한다").not.toBe(before);
  });

  /** 정렬 상태를 보조기술이 읽을 수 있어야 한다 — 시각 표시만으로는 안 닿는다. */
  it("정렬 상태를 aria-sort 로 알린다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    const th = el.querySelector<HTMLElement>("th.sortable")!;
    const click = () => th.querySelector<HTMLButtonElement>("button")!.click();

    expect(th.getAttribute("aria-sort")).toBe("none");
    click();
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    click();
    expect(th.getAttribute("aria-sort")).toBe("descending");
    click();
    expect(th.getAttribute("aria-sort"), "원문으로 돌아가면 none").toBe("none");
  });

  /** ⚠️ 버튼을 넣어도 머리글 **글자**는 그대로여야 한다 — 복사가 그걸 읽는다. */
  it("버튼을 넣어도 머리글 글자가 그대로다", () => {
    const el = root(TABLE);
    const beforeText = [...el.querySelectorAll("th")].map((h) => h.textContent);
    enhanceRendered(el, LABELS);
    expect([...el.querySelectorAll("th")].map((h) => h.textContent)).toEqual(beforeText);
  });

  const names = (el: HTMLElement) =>
    [...el.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((r) => r.cells[0].textContent);

  it("오름 → 내림 → 원문 으로 돈다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    const th = el.querySelector<HTMLElement>("th")!;

    th.click();
    expect(names(el)).toEqual(["가", "나", "다"]);
    th.click();
    expect(names(el)).toEqual(["다", "나", "가"]);
    // 🔴 **원문으로 돌아온다.** 원래 순서를 안 들고 있으면 못 돌아온다.
    th.click();
    expect(names(el)).toEqual(["나", "가", "다"]);
  });

  it("숫자 열은 숫자로 정렬한다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    el.querySelectorAll<HTMLElement>("th")[1].click();
    // 문자열이면 10 이 2 앞에 온다.
    expect(names(el)).toEqual(["다", "나", "가"]);
  });

  /** 지금 무엇으로 정렬돼 있는지 모르면 표를 못 믿는다. */
  it("정렬 방향을 표시한다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    const th = el.querySelector<HTMLElement>("th")!;
    th.click();
    expect(th.getAttribute("data-sort")).toBe("asc");
    th.click();
    expect(th.getAttribute("data-sort")).toBe("desc");
    th.click();
    expect(th.hasAttribute("data-sort")).toBe(false);
  });

  /** ⚠️ 다른 열을 누르면 이전 열의 표시가 사라져야 한다 — 둘 다 켜지면 거짓말이다. */
  it("다른 열을 누르면 이전 표시가 꺼진다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    const [a, b] = [...el.querySelectorAll<HTMLElement>("th")];
    a.click();
    b.click();
    expect(a.hasAttribute("data-sort")).toBe(false);
    expect(b.getAttribute("data-sort")).toBe("asc");
  });

  /** 행이 하나면 정렬할 것이 없다 — 자리만 먹는다. */
  it("행이 하나면 정렬을 안 붙인다", () => {
    const el = root(
      "<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>",
    );
    enhanceRendered(el, LABELS);
    expect(el.querySelectorAll("th.sortable")).toHaveLength(0);
  });
});

describe("표 복사", () => {
  it("마크다운과 CSV 버튼이 붙는다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    const labels = [...el.querySelectorAll(".table-tools button")].map((b) => b.textContent);
    expect(labels).toEqual(["마크다운으로 복사", "CSV로 복사"]);
  });

  it("마크다운으로 복사한다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    el.querySelectorAll<HTMLButtonElement>(".table-tools button")[0].click();
    expect(writeText.mock.calls[0][0]).toContain("| 이름 | 수 |");
  });

  it("CSV 로 복사한다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    el.querySelectorAll<HTMLButtonElement>(".table-tools button")[1].click();
    expect(writeText.mock.calls[0][0]).toBe("이름,수\n나,2\n가,10\n다,1");
  });

  /** ⚠️ 정렬한 **뒤에** 복사하면 보이는 순서로 나와야 한다 — 화면과 다르면 거짓말이다. */
  it("정렬한 순서대로 복사한다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    el.querySelector<HTMLElement>("th")!.click();
    el.querySelectorAll<HTMLButtonElement>(".table-tools button")[1].click();
    expect(writeText.mock.calls[0][0]).toBe("이름,수\n가,10\n나,2\n다,1");
  });
});

describe("🔴 두 번 불려도 안전하다", () => {
  /**
   * 프리뷰는 노트를 바꿀 때마다 다시 그리고 그때마다 이 함수가 돈다. 막지 않으면
   * **버튼이 쌓인다.**
   */
  it("버튼이 안 쌓인다", () => {
    const el = root(TABLE + '<pre class="hljs"><code>x</code></pre>');
    enhanceRendered(el, LABELS);
    enhanceRendered(el, LABELS);
    enhanceRendered(el, LABELS);
    expect(el.querySelectorAll(".table-tools")).toHaveLength(1);
    expect(el.querySelectorAll("pre.hljs .rendered-copy")).toHaveLength(1);
  });

  it("정렬 핸들러도 한 번만 붙는다", () => {
    const el = root(TABLE);
    enhanceRendered(el, LABELS);
    enhanceRendered(el, LABELS);
    const th = el.querySelector<HTMLElement>("th")!;
    th.click();
    // 두 번 붙었으면 오름 → 내림이 한 번에 일어나 원문 순서로 보인다.
    expect([...el.querySelectorAll<HTMLTableRowElement>("tbody tr")].map((r) => r.cells[0].textContent)).toEqual([
      "가",
      "나",
      "다",
    ]);
  });
});
