import { COMMANDS, GLOBAL_OPTIONS, optionsFor, type CommandSpec } from "./spec.ts";

/**
 * 출력 렌더 — **순수 함수**다. 문자열을 만들 뿐 쓰지 않는다(테스트가 그래서 가능하다).
 *
 * ## 사람용 출력의 형태는 계약이 아니다
 *
 * 읽기 좋게 바뀔 수 있다. 파싱해야 하면 `--json`을 쓴다. 이걸 문서와 코드 양쪽에 적어
 * 두는 이유는, 안 적으면 누군가 `awk`로 사람용 출력을 파싱하고 **그게 곧 바꾸지 못하는
 * 계약이 되기** 때문이다.
 *
 * ## 색을 쓰지 않는다
 *
 * 파이프로 넘길 때 이스케이프가 섞이고, 그걸 피하려면 tty 판정이 필요해지고, 그러면
 * "터미널에서와 파이프에서 다르게 보이는" 표면이 하나 더 는다. 얻는 게 적다.
 */

/** 표시 폭 — 한글은 2칸을 차지한다. 안 맞추면 표가 어긋난다. */
function width(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    // CJK·한글 완성형·전각 기호 대역. 정밀한 East Asian Width 표가 아니라 **실용 근사**다.
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    n += wide ? 2 : 1;
  }
  return n;
}

function pad(s: string, to: number): string {
  const gap = to - width(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/** 왼쪽 정렬 표. 마지막 열은 채우지 않는다(줄 끝 공백을 남기지 않으려고). */
export function table(rows: readonly string[][]): string {
  if (rows.length === 0) return "";
  const cols = Math.max(...rows.map((r) => r.length));
  const w: number[] = [];
  for (let c = 0; c < cols - 1; c++) {
    w[c] = Math.max(...rows.map((r) => width(r[c] ?? "")));
  }
  return rows
    .map((r) =>
      r
        .map((cell, c) => (c === r.length - 1 ? cell : pad(cell, w[c])))
        .join("  ")
        .trimEnd(),
    )
    .join("\n");
}

// ─── 도움말 ──────────────────────────────────────────────────────────────────

export function renderRootHelp(): string {
  const lines = [
    "lapis — 터미널에서 Lapis vault를 다룬다. 앱이 떠 있지 않아도 동작한다.",
    "",
    "사용: lapis <명령> [인자] [옵션]",
    "",
    "명령",
    table(COMMANDS.map((c) => ["  " + c.name, c.desc])),
    "",
    "공통 옵션",
    table(GLOBAL_OPTIONS.map((o) => ["  --" + o.name, o.desc])),
    "",
    "자세한 것은 cli/README.md. 명령별 사용법은 `lapis <명령> --help`.",
  ];
  return lines.join("\n");
}

export function renderCommandHelp(cmd: CommandSpec): string {
  const args = cmd.positional.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`)).join(" ");
  const lines = [
    `lapis ${cmd.name} ${args}`.trimEnd(),
    "",
    cmd.desc,
  ];
  if (cmd.positional.length > 0) {
    lines.push("", "인자", table(cmd.positional.map((p) => ["  " + p.name, p.desc])));
  }
  lines.push("", "옵션", table(optionsFor(cmd).map((o) => ["  --" + o.name, o.desc])));
  return lines.join("\n");
}

// ─── 결과 ────────────────────────────────────────────────────────────────────

/** `lapisQuery` 결과 행에서 렌더에 필요한 것만. 전체 타입을 끌어오지 않는다. */
export interface RenderableRow {
  path: string;
  score: number | null;
  rel: number | null;
  doc_kind: string | null;
  title: string | null;
  snippet: string | null;
}

/**
 * 검색 결과.
 *
 * `rel`을 함께 낸다 — raw `score`는 질의 간 비교가 안 되지만 `rel`은 그 질의 안에서
 * top-1을 1.0으로 둔 값이라, 사람이 "이 아래는 안 봐도 되겠다"를 눈으로 판단할 수 있다.
 */
export function renderResults(rows: readonly RenderableRow[]): string {
  if (rows.length === 0) return "결과 없음";
  const body = table(
    rows.map((r) => [
      r.rel === null ? "—" : r.rel.toFixed(2),
      r.doc_kind ?? "—",
      r.title ?? r.path.split("/").pop() ?? r.path,
      r.path,
    ]),
  );
  return body;
}

export function renderFacet(items: readonly { value: string; count: number }[]): string {
  if (items.length === 0) return "값 없음";
  return table(items.map((i) => [String(i.count), i.value]));
}

export interface BrokenGroup {
  target: string;
  sources: { path: string; name: string }[];
}

export function renderBroken(groups: readonly BrokenGroup[]): string {
  if (groups.length === 0) return "끊긴 링크 없음";
  const out: string[] = [];
  for (const g of groups) {
    out.push(`[[${g.target}]]  ${g.sources.length}곳`);
    for (const s of g.sources) out.push(`    ${s.path}`);
  }
  return out.join("\n");
}

/**
 * 오류.
 *
 * `remedy`가 있으면 함께 낸다 — `mcp/README.md`의 "실패는 소리내어"와 같은 계약이고,
 * 무엇이 잘못됐는지만 알려주고 어떻게 하라는 말이 없으면 절반만 전한 것이다.
 */
export function renderError(kind: string, message: string, remedy?: string): string {
  const head = `오류(${kind}): ${message}`;
  return remedy ? `${head}\n  → ${remedy}` : head;
}
