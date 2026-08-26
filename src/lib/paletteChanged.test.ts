import { describe, it, expect, beforeEach } from "vitest";
import { unifiedSearch, type PaletteResult } from "./palette";
import { quickEntries } from "./stores/search";
import { resetMtimes, touchMtime } from "./stores/mtimes";
import type { QuickEntry } from "./searchIndex";

function qe(path: string): QuickEntry {
  const name = path.split("/").pop()!.replace(/\.md$/, "");
  return { path, primaryLabel: name, parentPath: "", name } as unknown as QuickEntry;
}
const changed = (rs: PaletteResult[]) =>
  rs.filter((r) => r.entry.kind === "changed").map((r) => (r.entry as { path: string }).path);

describe("팔레트 — 최근 변경 그룹", () => {
  beforeEach(() => {
    resetMtimes();
    // ⚠️ **경로순이 아닌 순서로** 넣는다. `Array.sort`가 안정 정렬이므로 입력이 이미
    // 경로순이면 타이브레이크를 걷어내도 테스트가 통과한다 — 실패할 수 없는 테스트가 된다
    // (실제로 그렇게 짜서 카나리가 안 울렸다).
    quickEntries.set([qe("/v/c.md"), qe("/v/a.md"), qe("/v/b.md")]);
  });

  it("mtime 내림차순", async () => {
    touchMtime("/v/a.md", 100);
    touchMtime("/v/b.md", 300);
    touchMtime("/v/c.md", 200);
    expect(changed(await unifiedSearch(""))).toEqual(["/v/b.md", "/v/c.md", "/v/a.md"]);
  });

  it("동률이면 경로 오름차순 — git checkout이면 전부 동률이다", async () => {
    touchMtime("/v/c.md", 100);
    touchMtime("/v/a.md", 100);
    touchMtime("/v/b.md", 100);
    // quickEntries 가 [c, a, b] 순이므로 타이브레이크가 없으면 그 순서가 그대로 나온다.
    expect(changed(await unifiedSearch(""))).toEqual(["/v/a.md", "/v/b.md", "/v/c.md"]);
  });

  it("지도가 비면 그룹이 없다", async () => {
    expect(changed(await unifiedSearch(""))).toEqual([]);
  });

  it("vault에 없는 경로는 안 낸다", async () => {
    touchMtime("/v/gone.md", 999);
    touchMtime("/v/a.md", 1);
    expect(changed(await unifiedSearch(""))).toEqual(["/v/a.md"]);
  });

  // ⚠️ "입력이 있으면 이 그룹이 안 나온다"는 여기서 테스트하지 않는다. 비어 있지 않은
  // 질의는 `matchContent`(IPC · readNote × N)를 타므로 Tauri 표면을 통째로 세워야 하고,
  // 그 비용이 얻는 것보다 크다. 그 속성은 `unifiedSearch`의 `if (!query)` 분기 한 곳에만
  // 있어 눈으로 확인된다.
});
