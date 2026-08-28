import { nextDir, sortedOrder, toMarkdownTable, toCsv, type SortDir } from "$lib/renderedActions";
import { logWarn } from "$lib/stores/usage";

/**
 * 렌더된 본문에 **버튼과 정렬을 붙인다**.
 *
 * ⚠️ 판정은 전부 `renderedActions.ts`(순수·테스트됨)에 있다. 여기는 DOM 만 만진다 —
 * 규칙이 두 곳에 있으면 갈린다.
 *
 * ⚠️ **원문을 안 고친다.** 정렬은 보기만 바꾼다. 새로고침하면 원래 순서로 돌아오는데
 * 그게 맞는 동작이다 — 파일을 다시 쓰는 것은 되돌릴 수 없는 쓰기다.
 *
 * ⚠️ **여러 번 불려도 안전해야 한다.** 프리뷰는 노트를 바꿀 때마다 다시 그리고, 그때마다
 * 이 함수가 돈다. 이미 붙인 것을 또 붙이면 버튼이 쌓인다 — `data-lapis-enhanced` 로 막는다.
 */

const DONE = "data-lapis-enhanced";

export function enhanceRendered(root: HTMLElement, labels: RenderedLabels): void {
  for (const pre of root.querySelectorAll<HTMLElement>("pre.hljs")) {
    if (pre.hasAttribute(DONE)) continue;
    pre.setAttribute(DONE, "");
    addCopyButton(pre, () => pre.querySelector("code")?.textContent ?? "", labels);
  }

  for (const table of root.querySelectorAll<HTMLTableElement>("table")) {
    if (table.hasAttribute(DONE)) continue;
    table.setAttribute(DONE, "");
    makeSortable(table, labels);
    addTableTools(table, labels);
  }
}

export interface RenderedLabels {
  copy: string;
  copied: string;
  copyMarkdown: string;
  copyCsv: string;
  sortHint: string;
}

function addCopyButton(host: HTMLElement, text: () => string, labels: RenderedLabels): void {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rendered-copy";
  btn.textContent = labels.copy;
  btn.title = labels.copy;
  btn.addEventListener("click", () => void copyText(text(), btn, labels));
  host.classList.add("has-copy");
  host.appendChild(btn);
}

async function copyText(text: string, btn: HTMLButtonElement, labels: RenderedLabels): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    // ⚠️ 성공을 **말한다.** 아무 반응이 없으면 복사됐는지 알 수 없어 다시 누르게 된다.
    const before = btn.textContent;
    btn.textContent = labels.copied;
    setTimeout(() => {
      btn.textContent = before;
    }, 1200);
  } catch (e) {
    logWarn("renderedEnhance", "클립보드 복사 실패", e);
  }
}

/**
 * 머리글 칸과 본문 행.
 *
 * ⚠️ `table.tHead` · `table.tBodies` 를 **안 쓴다.** 구현마다 채워지는 정도가 다르고
 * (happy-dom 은 `tHead.rows` 를 안 준다), `<thead>` 가 없는 표도 있다. DOM 질의는
 * 어디서나 같은 답을 낸다.
 */
function headCells(table: HTMLTableElement): HTMLElement[] {
  const row = table.querySelector("thead tr") ?? table.querySelector("tr");
  return row ? [...row.querySelectorAll<HTMLElement>("th, td")] : [];
}

function bodyRows(table: HTMLTableElement): HTMLElement[] {
  const body = table.querySelector("tbody");
  if (body) return [...body.querySelectorAll<HTMLElement>(":scope > tr")];
  // `<tbody>` 가 없으면 첫 행을 머리글로 보고 나머지를 본문으로.
  return [...table.querySelectorAll<HTMLElement>(":scope > tr")].slice(1);
}

const rowCells = (r: HTMLElement) =>
  [...r.querySelectorAll<HTMLElement>("th, td")].map((c) => c.textContent ?? "");

/** 표의 머리글을 눌러 정렬. */
function makeSortable(table: HTMLTableElement, labels: RenderedLabels): void {
  const head = headCells(table);
  const original = bodyRows(table);
  const parent = original[0]?.parentElement;
  if (head.length === 0 || original.length < 2 || !parent) return;

  // ⚠️ **원래 순서를 기억한다.** `null` 로 돌아갈 때 이게 없으면 못 돌아온다.
  const cells = () => original.map(rowCells);

  let sortedCol = -1;
  let dir: SortDir = null;

  head.forEach((th, col) => {
    th.classList.add("sortable");
    th.title = labels.sortHint;
    th.addEventListener("click", () => {
      dir = col === sortedCol ? nextDir(dir) : "asc";
      sortedCol = col;
      for (const other of head) other.removeAttribute("data-sort");
      if (dir) th.setAttribute("data-sort", dir);

      const order = sortedOrder(cells(), col, dir);
      // ⚠️ `appendChild` 는 **옮긴다**(복사가 아니다) — 그래서 원래 노드를 잃지 않는다.
      for (const i of order) parent.appendChild(original[i]);
    });
  });
}

/** 표 위의 복사 버튼 둘. */
function addTableTools(table: HTMLTableElement, labels: RenderedLabels): void {
  const head = headCells(table);
  if (head.length === 0) return;

  const headers = () => head.map((c) => c.textContent ?? "");
  // ⚠️ **부를 때마다 다시 읽는다.** 정렬한 뒤에 복사하면 보이는 순서로 나와야 한다 —
  //    화면과 다른 것을 복사하면 그건 거짓말이다.
  const rows = () => bodyRows(table).map(rowCells);

  const bar = document.createElement("div");
  bar.className = "table-tools";

  for (const [label, make] of [
    [labels.copyMarkdown, () => toMarkdownTable(headers(), rows())],
    [labels.copyCsv, () => toCsv(headers(), rows())],
  ] as const) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rendered-copy";
    btn.textContent = label;
    btn.addEventListener("click", () => void copyText(make(), btn, labels));
    bar.appendChild(btn);
  }

  // ⚠️ 표를 감싸지 않는다. 감싸면 `.rendered table` 선택자와 가로 스크롤 규칙이 어긋난다.
  table.parentElement?.insertBefore(bar, table);
}
