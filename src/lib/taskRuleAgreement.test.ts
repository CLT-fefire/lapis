import { describe, it, expect } from "vitest";
import MarkdownIt from "markdown-it";
import { taskListPlugin } from "./markdownPlugins/taskList";
import { findOpenTasks } from "./openTasks";

/**
 * 🔴 **작업 규칙이 두 곳에 적혀 있다.** 이 파일은 그 둘을 묶어 둔다.
 *
 * | 어디 | 무엇으로 | 쓰는 곳 |
 * |---|---|---|
 * | `markdownPlugins/taskList.ts` | markdown-it 토큰 | 화면에 체크박스를 **그린다** |
 * | `openTasks.ts` 의 `TASK_LINE` | 줄 단위 정규식 | `tasks audit` · `stats` · MCP 가 **센다** |
 *
 * 파서와 줄 스캐너라 합칠 수는 없다 — 렌더러는 markdown-it 이 이미 리스트를 판정한 뒤를
 * 보고, 감사는 인덱스 없이 본문만 훑는다(`links --unlinked` 와 같은 부류다).
 * 합칠 수 없으면 **어긋나는 것을 실패로 만든다.**
 *
 * ## ⚠️ 왜 생겼나 (2026-08-29 실측)
 *
 * 실제로 갈려 있었다. `+ [ ] 할 일` 과 `1. [ ] 할 일` 은 **앱이 체크박스로 그리는데
 * 감사는 안 셌다.** 앱에는 남은 일이 보이는데 도구는 "미완 작업이 없다"고 답하는 상태다.
 *
 * ⚠️ **이 vault 에서는 0건이다.** 127 노트 162건 중 새는 것이 없었다 — 아무도 `+` 로
 * 안 쓴다. 그러니 이건 **보험이지 성과가 아니다.** 값을 한다고 적지 않는다.
 * (같은 자리에서 같은 판단을 한 적이 있다 — 안 걸린 언급의 하한 3자 필터.)
 */

const md = new MarkdownIt().use(taskListPlugin);

/** 두 규칙에 같은 입력을 먹인다. */
function judge(src: string) {
  const g = findOpenTasks("/v/a.md", src);
  return {
    drawn: md.render(src).includes("task-checkbox"),
    counted: g.open.length + g.done > 0,
  };
}

/** `task`: 사람이 보기에 작업인가. */
const SAMPLES: readonly { src: string; task: boolean; why: string }[] = [
  { src: "- [ ] 하이픈", task: true, why: "가장 흔한 형태" },
  { src: "* [ ] 별표", task: true, why: "CommonMark 불릿" },
  { src: "+ [ ] 플러스", task: true, why: "🔴 CommonMark 불릿인데 감사가 놓치던 것" },
  { src: "1. [ ] 번호", task: true, why: "🔴 번호 목록의 작업도 작업이다" },
  { src: "1) [ ] 괄호 번호", task: true, why: "CommonMark 는 `)` 도 받는다" },
  { src: "- [x] 소문자 완료", task: true, why: "완료도 작업이다 — 분모가 된다" },
  { src: "- [X] 대문자 완료", task: true, why: "대소문자를 안 가린다" },
  { src: "-   [ ] 공백 여럿", task: true, why: "불릿 뒤 공백 수는 자유다" },
  { src: "  - [ ] 들여쓴 것", task: true, why: "중첩 작업" },

  { src: "- [ ]붙어 있음", task: false, why: "`]` 뒤 공백이 없으면 작업이 아니다" },
  { src: "- [-] 취소 표시", task: false, why: "이 앱이 아는 표시가 아니다" },
  { src: "- [ㅇ] 한글", task: false, why: "안에 들어갈 수 있는 것은 공백·x 뿐" },
  { src: "[ ] 불릿 없음", task: false, why: "목록 항목이 아니다" },
  { src: "그냥 글 - [ ] 가운데", task: false, why: "줄 첫머리가 아니다" },
  { src: "```\n- [ ] 코드 안\n```", task: false, why: "🔴 셸 예시를 할 일로 세면 목록을 못 믿는다" },
  { src: "~~~\n- [ ] 물결 펜스\n~~~", task: false, why: "펜스는 물결도 된다" },
];

describe("그리는 규칙과 세는 규칙이 같은 것을 본다", () => {
  for (const s of SAMPLES) {
    it(`${s.task ? "작업" : "작업 아님"} — ${s.why}`, () => {
      const { drawn, counted } = judge(s.src);
      expect(drawn, `그리는 쪽이 다르게 봤다: ${JSON.stringify(s.src)}`).toBe(s.task);
      expect(counted, `세는 쪽이 다르게 봤다: ${JSON.stringify(s.src)}`).toBe(s.task);
    });
  }
});

/**
 * ⚠️ 목록 자체에 붙는 표시도 같이 본다 — `.task-item` 만 붙고 `.task-list` 가 안 붙으면
 * 항목의 들여쓰기만 어긋난 채로 조용히 지나간다.
 */
describe("목록 표시", () => {
  it("불릿 목록에 task-list 가 붙는다", () => {
    expect(md.render("- [ ] 가")).toContain("task-list");
  });

  it("번호 목록에도 붙는다", () => {
    expect(md.render("1. [ ] 가"), "ol 을 못 찾으면 들여쓰기가 어긋난다").toContain("task-list");
  });

  it("작업이 아닌 목록에는 안 붙는다", () => {
    expect(md.render("- 그냥 항목")).not.toContain("task-list");
  });
});
