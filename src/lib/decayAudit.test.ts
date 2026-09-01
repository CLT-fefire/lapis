import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { collectOpenTasks } from "./openTasks";
import { findDecayedNotes } from "./vaultAudit";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 지식 부패 — **한 노트가 자기 자신과 어긋난 것.**
 *
 * 프론트매터가 "끝났다"는데 본문에 `- [ ]` 가 남아 있다. 둘 다 그 노트 안에 있으므로
 * 세면 나오는 사실이고, **추론이 없다.**
 *
 * ## ⚠️ 왜 이게 `vaultAudit` 의 "판단하지 않는다"를 안 깨나
 *
 * 같은 파일이 이렇게 적어 두었다:
 *
 * > 동의어라고 말하지 않는다. 그건 **기계가 정할 수 없고**, 이 기능의 원칙은
 * > "판단하지 않는다"다.
 *
 * 그 말은 **두 노트 사이**를 이어붙이는 추론에 대한 것이다. 여기는 한 노트 안이라
 * 이어붙일 게 없다. `반영됨` 이 "끝났다"인지는 사람이 `docStatus` 에 선언했고,
 * 이 감사는 그 표를 읽을 뿐 늘리지 않는다.
 *
 * ## 🔴 왜 이게 필요했나 (2026-08-30)
 *
 * `todos/mcp-gate-issues-20260827.md` 가 `status: 닫힘` 인 채 미체크 12개를 달고
 * 있었다. 그래서 그 안의 **낡은 숫자**("태그 분열 15묶음")를 믿고 같은 날 두 번
 * 잘못 쟀다. 닫힌 문서에 열린 표시가 남으면 다음 사람이 다 된 일을 다시 한다.
 *
 * ⚠️ 그 한 건은 고쳤으므로 **지금 이 vault 에서는 0건이다.** 성과가 아니라 보험이다.
 */

function mkInfo(path: string, extra: Partial<LinkInfo> = {}): LinkInfo {
  const segs = path.split("/").filter(Boolean);
  return {
    source_path: path,
    source_name: (segs[segs.length - 1] ?? path).replace(/\.md$/i, ""),
    title: null,
    aliases: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    targets: [],
    props: {},
    ...extra,
  };
}

const OPEN_TWO = ["할 것", "", "- [ ] 첫째", "- [ ] 둘째", "- [x] 셋째"].join("\n");
const ALL_DONE = ["할 것", "", "- [x] 다 했다"].join("\n");

/** 인덱스와 본문을 같은 노트 목록에서 만든다 — 둘이 어긋나면 감사가 헛돈다. */
function audit(notes: { path: string; status?: string[]; body: string }[]) {
  const idx = buildIndex(notes.map((n) => mkInfo(n.path, { props: n.status ? { status: n.status } : {} })));
  const groups = collectOpenTasks(notes.map((n) => ({ path: n.path, body: n.body })));
  return findDecayedNotes(idx, groups);
}

describe("지식 부패 감사", () => {
  it("끝났다는데 미체크가 남은 노트를 찾는다", () => {
    const rows = audit([
      { path: "/v/closed-but-open.md", status: ["완료"], body: OPEN_TWO },
      { path: "/v/really-done.md", status: ["완료"], body: ALL_DONE },
    ]);
    expect(rows.map((r) => r.path)).toEqual(["/v/closed-but-open.md"]);
    expect(rows[0].open).toBe(2);
  });

  /** 🔴 다섯 낱말 전부가 "끝났다"다. 하나라도 빠지면 그 분모가 조용히 틀린다. */
  it("끝났다는 낱말 다섯을 전부 본다 — `완료` 만이 아니다", () => {
    const rows = audit(
      ["완료", "반영됨", "해결됨", "닫힘", "이전됨"].map((s, i) => ({
        path: `/v/${i}.md`,
        status: [s],
        body: OPEN_TWO,
      })),
    );
    expect(rows).toHaveLength(5);
  });

  it("적힌 낱말을 그대로 낸다 — 사람이 자기 말로 찾을 수 있게", () => {
    const rows = audit([{ path: "/v/a.md", status: ["반영됨"], body: OPEN_TWO }]);
    expect(rows[0].status).toBe("반영됨");
  });

  // ── 안 잡는 것 ───────────────────────────────────────────────────────────
  // 오탐을 섞으면 목록 자체를 안 믿게 된다 — 감사 가족의 공통 원칙이다.

  it("`status` 가 없는 노트는 안 잡는다", () => {
    // ⚠️ 실측 vault 에서 미완이 있는 노트 넷이 **전부** 이 경우다. 점검표는
    //    설계대로 영원히 미체크라, 여기 넣으면 목록이 오탐으로 채워진다.
    expect(audit([{ path: "/v/checklist.md", body: OPEN_TWO }])).toEqual([]);
  });

  it("모르는 `status` 는 안 잡는다 — 추측하지 않는다", () => {
    expect(audit([{ path: "/v/a.md", status: ["보류"], body: OPEN_TWO }])).toEqual([]);
    expect(audit([{ path: "/v/b.md", status: ["완료 — #232"], body: OPEN_TWO }])).toEqual([]);
  });

  it("진행 중 · 미착수는 어긋난 게 아니다", () => {
    const rows = audit([
      { path: "/v/a.md", status: ["진행 중"], body: OPEN_TWO },
      { path: "/v/b.md", status: ["미착수"], body: OPEN_TWO },
    ]);
    expect(rows).toEqual([]);
  });

  it("코드 블록 안의 체크박스는 안 센다 — `collectOpenTasks` 의 규칙 그대로", () => {
    const fenced = ["```md", "- [ ] 예시일 뿐이다", "```"].join("\n");
    expect(audit([{ path: "/v/a.md", status: ["완료"], body: fenced }])).toEqual([]);
  });

  it("빈 vault 에서 0건", () => {
    expect(audit([])).toEqual([]);
  });

  /** 같은 입력에 같은 답 — 다른 감사 다섯과 같은 계약이다. */
  it("미완이 많은 순, 동점은 경로 순", () => {
    const three = ["- [ ] a", "- [ ] b", "- [ ] c"].join("\n");
    const rows = audit([
      { path: "/v/b.md", status: ["완료"], body: OPEN_TWO },
      { path: "/v/many.md", status: ["완료"], body: three },
      { path: "/v/a.md", status: ["완료"], body: OPEN_TWO },
    ]);
    expect(rows.map((r) => r.path)).toEqual(["/v/many.md", "/v/a.md", "/v/b.md"]);
  });
});
