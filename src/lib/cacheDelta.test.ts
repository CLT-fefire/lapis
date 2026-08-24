import { describe, it, expect } from "vitest";
import { diffFileStats, deltaGate, touchedPaths } from "$lib/cacheDelta";
import type { FileStat } from "$lib/tauri/notes";

function f(path: string, mtime_ms: number, size: number): FileStat {
  return { path, mtime_ms, size };
}

/** 실제 `decideShardCount`와 같은 성격 — 노트 수 임계로 shard 수가 계단식으로 변한다. */
function shardsFor(noteCount: number): number {
  if (noteCount < 1000) return 1;
  if (noteCount < 5000) return 4;
  return 8;
}

describe("diffFileStats", () => {
  it("mtime이 바뀌면 modified", () => {
    const prev = [f("/v/a.md", 100, 10), f("/v/b.md", 100, 10)];
    const cur = [f("/v/a.md", 200, 10), f("/v/b.md", 100, 10)];
    expect(diffFileStats(prev, cur)).toMatchObject({
      added: [],
      modified: ["/v/a.md"],
      removed: [],
      noteCount: 2,
    });
  });

  it("mtime이 같아도 size가 다르면 modified — 같은 초에 덮어쓴 편집을 놓치지 않는다", () => {
    const prev = [f("/v/a.md", 100, 10)];
    const cur = [f("/v/a.md", 100, 42)];
    expect(diffFileStats(prev, cur).modified).toEqual(["/v/a.md"]);
  });

  it("신규와 수정을 가른다 — 노트 수를 바꾸는 건 신규뿐이다", () => {
    const prev = [f("/v/a.md", 100, 10)];
    const cur = [f("/v/a.md", 200, 10), f("/v/new.md", 300, 5)];
    const d = diffFileStats(prev, cur);
    expect(d.added).toEqual(["/v/new.md"]);
    expect(d.modified).toEqual(["/v/a.md"]);
    expect(d.noteCount).toBe(2);
  });

  it("사라진 파일은 removed", () => {
    const prev = [f("/v/a.md", 100, 10), f("/v/gone.md", 100, 10)];
    const cur = [f("/v/a.md", 100, 10)];
    const d = diffFileStats(prev, cur);
    expect(d.removed).toEqual(["/v/gone.md"]);
    expect(d.noteCount).toBe(1);
  });

  it("변경이 없으면 전부 빈 배열", () => {
    const same = [f("/v/a.md", 100, 10), f("/v/b.md", 200, 20)];
    const d = diffFileStats(same, [...same]);
    expect(touchedPaths(d)).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it("touchedPaths는 신규+수정 — 적용 방식이 같다", () => {
    const prev = [f("/v/a.md", 100, 10)];
    const cur = [f("/v/a.md", 200, 10), f("/v/n.md", 1, 1)];
    expect(touchedPaths(diffFileStats(prev, cur)).sort()).toEqual(["/v/a.md", "/v/n.md"]);
  });
});

describe("deltaGate", () => {
  const base = { metaShardCount: 1, decideShardCount: shardsFor, max: 200 };

  it("적은 변경은 적용한다", () => {
    const delta = diffFileStats([f("/v/a.md", 1, 1)], [f("/v/a.md", 2, 1)]);
    expect(deltaGate({ ...base, delta })).toEqual({ apply: true });
  });

  it("델타 0건은 **거절한다** — fingerprint가 어긋났는데 변경이 없는 건 믿을 수 없다", () => {
    // 여기서 "변경 없음"으로 처리하면 캐시가 실제로 낡았을 때 그 상태를 영구히 고정한다.
    const same = [f("/v/a.md", 1, 1)];
    const delta = diffFileStats(same, [...same]);
    expect(deltaGate({ ...base, delta })).toEqual({ apply: false, reason: "empty" });
  });

  it("상한을 넘으면 풀 빌드 — 개별 IPC보다 bundle 한 번이 싸다", () => {
    const prev = Array.from({ length: 300 }, (_, i) => f(`/v/${i}.md`, 1, 1));
    const cur = prev.map((x) => f(x.path, 2, 1));
    const delta = diffFileStats(prev, cur);
    expect(deltaGate({ ...base, delta, max: 200 })).toEqual({
      apply: false,
      reason: "too-many",
    });
  });

  it("상한과 정확히 같으면 아직 적용한다 (경계)", () => {
    const prev = Array.from({ length: 200 }, (_, i) => f(`/v/${i}.md`, 1, 1));
    const cur = prev.map((x) => f(x.path, 2, 1));
    const delta = diffFileStats(prev, cur);
    expect(deltaGate({ ...base, delta, max: 200 })).toEqual({ apply: true });
  });

  it("shard 수가 바뀌면 풀 빌드 — computeShardId가 모든 문서에서 달라진다", () => {
    // 999 → 1000: shardsFor가 1 → 4. 디스크 shard를 재사용할 수 없다.
    const prev = Array.from({ length: 999 }, (_, i) => f(`/v/${i}.md`, 1, 1));
    const cur = [...prev, f("/v/new.md", 1, 1)];
    const delta = diffFileStats(prev, cur);
    expect(deltaGate({ ...base, delta, metaShardCount: 1 })).toEqual({
      apply: false,
      reason: "shard-count-change",
    });
  });

  it("삭제로 임계 아래로 내려가도 풀 빌드", () => {
    const prev = Array.from({ length: 1000 }, (_, i) => f(`/v/${i}.md`, 1, 1));
    const cur = prev.slice(0, 999);
    const delta = diffFileStats(prev, cur);
    expect(deltaGate({ ...base, delta, metaShardCount: 4 })).toEqual({
      apply: false,
      reason: "shard-count-change",
    });
  });

  it("수정만 200건이면 노트 수가 안 변하므로 shard 판정에 걸리지 않는다", () => {
    const prev = Array.from({ length: 1200 }, (_, i) => f(`/v/${i}.md`, 1, 1));
    const cur = prev.map((x, i) => (i < 200 ? f(x.path, 2, 1) : x));
    const delta = diffFileStats(prev, cur);
    expect(deltaGate({ ...base, delta, metaShardCount: 4 })).toEqual({ apply: true });
  });
});
