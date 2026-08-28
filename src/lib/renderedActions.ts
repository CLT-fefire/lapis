/**
 * 렌더된 본문의 **상호작용** — 표 정렬, 코드블록·표 복사.
 *
 * ## ⚠️ 왜 여기인가 (2026-08-28 실측)
 *
 * | 구조 | 쓰는 노트 |
 * |---|---|
 * | 표 | **95 / 112 (85%)** |
 * | 코드블록 | 63 (`bash:33 · ts:12 · json:5`) |
 *
 * 표는 이 vault 의 **지배적 구조**인데 스타일만 있고 아무 기능이 없었다. 코드블록도
 * 복사가 실제 용도인데 버튼이 없었다.
 *
 * ## ⚠️ DOM 을 고치지 원문을 안 고친다
 *
 * 정렬은 **보기**만 바꾼다. 파일을 다시 쓰는 것은 되돌릴 수 없는 쓰기이고, `README` 가
 * "쓰기 도구가 아니다"라고 못 박았다. 그래서 새로고침하면 원래 순서로 돌아온다 —
 * 그게 맞는 동작이다.
 */

/** 정렬 방향. `null` 이면 원문 순서. */
export type SortDir = "asc" | "desc" | null;

/** 다음 방향 — 원문 → 오름 → 내림 → 원문. */
export function nextDir(cur: SortDir): SortDir {
  if (cur === null) return "asc";
  if (cur === "asc") return "desc";
  return null;
}

/**
 * 셀 값 비교. **오름차순 기준**이고 방향은 호출부가 뒤집는다.
 *
 * ⚠️ **숫자처럼 보이면 숫자로** 센다. 문자열로 비교하면 `10` 이 `9` 보다 앞에 오고,
 * 그건 표를 정렬한 사람이 바로 알아채는 종류의 오답이다.
 *
 * ⚠️ 빈 칸도 여기서는 뒤로 보내지만, **방향과 무관하게 뒤로 두는 책임은 `sortedOrder`**
 * 에 있다. 여기 결과에 `sign` 을 곱하면 내림차순에서 빈 칸이 맨 위로 온다 — 실제로 그렇게
 * 나가 있었다. `tableView.ts` 의 `sortRows` 와 같은 계약이다.
 */
export function compareCells(a: string, b: string): number {
  const ta = a.trim();
  const tb = b.trim();
  if (ta === "" && tb === "") return 0;
  if (ta === "") return 1;
  if (tb === "") return -1;

  const na = toNumber(ta);
  const nb = toNumber(tb);
  if (na !== null && nb !== null) return na - nb;

  return ta.localeCompare(tb);
}

/** `1,234` · `12%` · `3.5` 를 숫자로. 아니면 `null`. */
function toNumber(s: string): number | null {
  const cleaned = s.replace(/[,\s]/g, "").replace(/%$/, "");
  if (cleaned === "" || !/^[+-]?\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 행을 한 열 기준으로 정렬한 **인덱스 배열**.
 *
 * ⚠️ 행 자체가 아니라 순서를 낸다 — 호출부가 DOM 노드를 옮겨야 하고, 그러면 원래
 * 노드를 잃지 않는다(`null` 로 돌아갈 수 있다).
 *
 * ⚠️ **안정 정렬**이어야 한다. 같은 값이 매번 다른 순서면 같은 표를 두 번 정렬했을 때
 * 결과가 달라진다.
 */
export function sortedOrder(rows: readonly string[][], col: number, dir: SortDir): number[] {
  const idx = rows.map((_, i) => i);
  if (dir === null) return idx;
  const sign = dir === "asc" ? 1 : -1;
  return idx.sort((x, y) => {
    const a = (rows[x][col] ?? "").trim();
    const b = (rows[y][col] ?? "").trim();
    // 🔴 **빈 칸은 `sign` 밖에서 처리한다.** 비교 결과에 통째로 곱하면 "빈 칸은 뒤로"까지
    //    뒤집혀 내림차순에서 맨 위로 온다. `tableView.ts` 의 `sortRows` 와 같은 순서다.
    if (a === "" || b === "") {
      if (a === "" && b === "") return x - y;
      return a === "" ? 1 : -1;
    }
    const c = compareCells(a, b);
    // 동점은 **원래 순서**로 — 안정 정렬.
    return c !== 0 ? c * sign : x - y;
  });
}

/**
 * 표 → 마크다운 문자열.
 *
 * ⚠️ 셀 안의 `|` 를 이스케이프한다. 안 하면 붙여넣은 표의 **열이 하나 늘어난다** —
 * 조용히 깨지는 종류다.
 */
export function toMarkdownTable(headers: readonly string[], rows: readonly string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
  const out = [
    `| ${headers.map(esc).join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
  ];
  return out.join("\n");
}

/**
 * 표 → CSV.
 *
 * ⚠️ RFC 4180 — 쉼표·따옴표·개행이 든 셀은 따옴표로 감싸고 따옴표는 두 번 쓴다.
 * 안 하면 스프레드시트에서 열이 밀린다.
 */
export function toCsv(headers: readonly string[], rows: readonly string[][]): string {
  const cell = (s: string) => {
    const t = s.trim();
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}
