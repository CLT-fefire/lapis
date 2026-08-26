import { describe, it, expect, vi } from "vitest";
import { claimCliOpen, type CliOpenDeps } from "./cliOpen";
import type { PendingOpen } from "$lib/tauri/cliOpen";

function deps(over: Partial<CliOpenDeps> = {}) {
  const calls = {
    take: [] as (string | null)[],
    openVault: [] as string[],
    selectNote: [] as string[],
    focus: 0,
    warned: [] as string[],
  };
  const base: CliOpenDeps = {
    take: async () => null,
    openVault: async (p) => {
      calls.openVault.push(p);
    },
    selectNote: async (p) => {
      calls.selectNote.push(p);
    },
    currentVault: () => "/v",
    focus: async () => {
      calls.focus++;
    },
    search: () => "",
    warn: (m) => {
      calls.warned.push(m);
    },
  };
  const merged: CliOpenDeps = { ...base, ...over };
  // ⚠️ 기록은 오버라이드 **바깥**에서 감싼다. 안에 두면 `take`를 갈아끼운 테스트에서
  // 호출 기록이 통째로 사라져, "무엇으로 물었나"를 보는 단언이 빈 배열끼리 비교하며
  // 조용히 통과한다.
  const take = merged.take;
  merged.take = async (v) => {
    calls.take.push(v);
    return take(v);
  };
  return { deps: merged, calls };
}

const pending: PendingOpen = { path: "/v/a.md", vault: "/v" };

describe("claimCliOpen", () => {
  it("자기 vault로 물어 받으면 연다", async () => {
    const { deps: d, calls } = deps({ take: async () => pending });
    expect(await claimCliOpen(d)).toBe("opened");
    expect(calls.selectNote).toEqual(["/v/a.md"]);
    // 평범한 창은 vault를 다시 열지 않는다 — 이미 그 vault다.
    expect(calls.openVault).toEqual([]);
    expect(calls.focus).toBe(1);
  });

  it("자기 것이 아니면 아무것도 안 한다", async () => {
    const { deps: d, calls } = deps();
    expect(await claimCliOpen(d)).toBe("not-mine");
    expect(calls.take).toEqual(["/v"]);
    expect(calls.selectNote).toEqual([]);
    expect(calls.focus).toBe(0);
  });

  it("vault 없는 평범한 창은 묻지도 않는다", async () => {
    const { deps: d, calls } = deps({ currentVault: () => null });
    expect(await claimCliOpen(d)).toBe("skipped");
    expect(calls.take).toEqual([]);
  });

  /**
   * ⚠️ 순서가 중요하다. 노트를 먼저 열면 인덱스가 없는 상태에서 열게 되고, 뒤이은
   * `openVault`가 탭을 자기 것으로 갈아치운다.
   */
  it("CLI가 만든 창은 vault부터 열고 노트를 연다", async () => {
    const order: string[] = [];
    const { deps: d } = deps({
      search: () => "?cli-open=1",
      currentVault: () => null,
      take: async () => pending,
      openVault: async (p) => {
        order.push(`vault:${p}`);
      },
      selectNote: async (p) => {
        order.push(`note:${p}`);
      },
    });
    expect(await claimCliOpen(d)).toBe("opened");
    expect(order).toEqual(["vault:/v", "note:/v/a.md"]);
  });

  it("CLI가 만든 창은 null로 묻는다", async () => {
    const { deps: d, calls } = deps({ search: () => "?cli-open=1", take: async () => pending });
    await claimCliOpen(d);
    expect(calls.take).toEqual([null]);
  });

  /**
   * ⚠️ 이건 기동 경로에서도 불린다. 여기서 예외가 새면 vault 복원 이후의 초기화가 통째로
   * 멈춘다 — CLI로 노트 하나 여는 편의 기능 때문에 앱이 안 뜨면 안 된다.
   */
  it("실패해도 던지지 않는다", async () => {
    const { deps: d, calls } = deps({
      take: async () => {
        throw new Error("IPC 끊김");
      },
    });
    await expect(claimCliOpen(d)).resolves.toBe("not-mine");
    expect(calls.warned).toHaveLength(1);
  });

  it("노트 열기가 실패해도 던지지 않는다", async () => {
    const { deps: d, calls } = deps({
      take: async () => pending,
      selectNote: async () => {
        throw new Error("없는 파일");
      },
    });
    await expect(claimCliOpen(d)).resolves.toBe("not-mine");
    expect(calls.warned).toHaveLength(1);
  });

  it("포커스가 실패해도 노트는 이미 열려 있다", async () => {
    const { deps: d, calls } = deps({
      take: async () => pending,
      focus: async () => {
        throw new Error("창 없음");
      },
    });
    // 결과는 실패로 보고하되, 노트를 여는 단계까지는 끝났다.
    await claimCliOpen(d);
    expect(calls.selectNote).toEqual(["/v/a.md"]);
  });
});

describe("claimCliOpen — 두 창이 동시에 물을 때", () => {
  it("Rust가 원자적으로 하나에만 준다는 전제를 지킨다", async () => {
    // 꺼내기를 한 번만 성공시키는 가짜 — 실제 `take_pending_open`의 계약이다.
    let left: PendingOpen | null = pending;
    const take = vi.fn(async (v: string | null) => {
      if (!left) return null;
      if (v !== null && v !== left.vault) return null;
      const got = left;
      left = null;
      return got;
    });
    const a = deps({ take, currentVault: () => "/v" });
    const b = deps({ take, currentVault: () => "/v" });
    const [ra, rb] = await Promise.all([claimCliOpen(a.deps), claimCliOpen(b.deps)]);
    expect([ra, rb].filter((r) => r === "opened")).toHaveLength(1);
  });
});
