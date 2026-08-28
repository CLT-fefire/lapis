import { describe, it, expect } from "vitest";
import { sortedOrder } from "./renderedActions";
import { sortRows, type SortSpec } from "./tableView";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 🔴 **정렬기가 둘이다 — 빈 값 규칙은 하나여야 한다.**
 *
 * - `renderedActions.sortedOrder` — 본문에 렌더된 마크다운 표(머리글 클릭)
 * - `tableView.sortRows` — 문서 표 뷰(컬럼 정렬)
 *
 * 타입 판별은 서로 다르다(저쪽은 ISO 날짜, 이쪽은 `1,234`·`12%`). 그건 의도다.
 * 하지만 **빈 값을 어디에 두는가**는 같아야 한다 — 한 앱 안에서 같은 조작이 표에 따라
 * 다르게 굴면 그건 학습이 안 된다.
 *
 * 실제로 갈렸다: `sortRows` 는 빈 값을 `sign` 곱하기 전에 처리해 맞았고,
 * `sortedOrder` 는 비교 결과 전체에 곱해 **내림차순에서 빈 칸이 맨 위로** 왔다.
 * 이 저장소에서 가장 자주 나온 결함 모양이라 함수 단위 테스트로는 안 잡힌다 —
 * 양쪽을 **같은 질문에 세워야** 잡힌다.
 */

const info = (path: string, status: string): LinkInfo =>
  ({
    source_path: `/v/${path}`,
    source_name: path.replace(/\.md$/, ""),
    title: null,
    aliases: [],
    targets: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    props: status === "" ? {} : { status: [status] },
  }) as unknown as LinkInfo;

describe("두 정렬기의 빈 값 규칙이 같다", () => {
  // 같은 데이터를 양쪽 모양으로. 값 둘 + 빈 값 하나.
  const cells = [["a", "2"], ["b", ""], ["c", "1"]];
  const infos = [info("a.md", "2"), info("b.md", ""), info("c.md", "1")];
  const spec = (dir: "asc" | "desc"): SortSpec => ({ key: "status" as never, dir });

  for (const dir of ["asc", "desc"] as const) {
    it(`${dir} — 빈 값이 마지막이다 (양쪽 다)`, () => {
      const rendered = sortedOrder(cells, 1, dir).map((i) => cells[i][0]);
      const table = sortRows(infos, spec(dir), "/v").map((i) => i.source_name);

      expect(rendered.at(-1), "본문 렌더 표에서 빈 값이 마지막이 아니다").toBe("b");
      expect(table.at(-1), "문서 표 뷰에서 빈 값이 마지막이 아니다").toBe("b");
      // 그리고 값 있는 것들의 순서도 서로 같아야 한다.
      expect(rendered, "두 정렬기의 결과가 다르다").toEqual(table);
    });
  }
});
