import { describe, it, expect } from "vitest";
import {
  backupAndWrite,
  describeFailure,
  relativeToVault,
  BACKUP_ROOT,
  type SafeWriteIo,
  type SafeWriteItem,
} from "./safeWrite";

/**
 * 되돌릴 수 없는 쓰기의 안전장치라 **실패 경로를 촘촘히** 고정한다.
 * 성공 경로는 한 번만 봐도 되지만, 실패는 종류마다 다르게 끝나야 한다.
 */

interface Recorder {
  io: SafeWriteIo;
  writes: { path: string; content: string }[];
  logs: string[];
}

function recorder(over: Partial<SafeWriteIo> = {}): Recorder {
  const writes: { path: string; content: string }[] = [];
  const logs: string[] = [];
  const backupContents = new Map<string, string>();
  const io: SafeWriteIo = {
    async backupNotes(_vault, sources, destRel) {
      for (const s of sources) backupContents.set(`/bk/${destRel}${s}`, `원본:${s}`);
      return `/bk/${destRel}`;
    },
    async readNote(path) {
      // 롤백이 읽는 경로는 `${backupDir}/${rel}`이다.
      const v = backupContents.get(path) ?? `원본:${path}`;
      return v;
    },
    async writeNote(_vault, path, content) {
      writes.push({ path, content });
    },
    async pruneBackups() {
      /* 기본은 성공. 실패 경로는 override 로 넣는다 */
    },
    log(level, message) {
      logs.push(`${level}: ${message}`);
    },
    timestamp: () => "TS",
    ...over,
  };
  return { io, writes, logs };
}

const items: SafeWriteItem[] = [
  { path: "/v/a.md", newContent: "새 A" },
  { path: "/v/b.md", newContent: "새 B" },
];

describe("성공 경로", () => {
  it("백업 후 순서대로 쓴다", async () => {
    const r = recorder();
    const out = await backupAndWrite("/v", items, r.io);
    expect(out.ok).toBe(true);
    expect(r.writes.map((w) => w.path)).toEqual(["/v/a.md", "/v/b.md"]);
  });

  it("백업 경로에 BACKUP_ROOT와 타임스탬프를 쓴다", async () => {
    const r = recorder();
    const out = await backupAndWrite("/v", items, r.io);
    expect(out.ok && out.backupDir).toBe(`/bk/${BACKUP_ROOT}/TS`);
  });

  it("쓸 게 없으면 백업도 안 만든다", async () => {
    // 빈 디렉터리가 prune 대상만 늘린다.
    let backedUp = false;
    const r = recorder({
      async backupNotes() {
        backedUp = true;
        return "/bk";
      },
    });
    const out = await backupAndWrite("/v", [], r.io);
    expect(out.ok).toBe(true);
    expect(backedUp).toBe(false);
  });
});

describe("백업 실패", () => {
  it("⭐ 아무것도 쓰지 않는다", async () => {
    // 되돌릴 수단이 없는 쓰기는 하지 않는다.
    const r = recorder({
      async backupNotes() {
        throw new Error("디스크 가득");
      },
    });
    const out = await backupAndWrite("/v", items, r.io);
    expect(out).toMatchObject({ ok: false, stage: "backup" });
    expect(r.writes).toEqual([]);
  });

  it("⭐ 호출부가 실패를 알 수 있다", async () => {
    // 예전 구현은 조용히 return 해서 모달이 성공한 듯 닫혔다.
    const r = recorder({
      async backupNotes() {
        throw new Error("권한 없음");
      },
    });
    const out = await backupAndWrite("/v", items, r.io);
    expect(out.ok).toBe(false);
    expect(describeFailure(out)).toContain("아무것도 쓰지 않았다");
  });
});

describe("쓰기 도중 실패", () => {
  it("이미 쓴 것을 되돌린다", async () => {
    const r = recorder({
      async writeNote(_v, path, content) {
        if (path === "/v/b.md" && content === "새 B") throw new Error("잠김");
        // 롤백 쓰기는 통과시킨다
      },
    });
    const out = await backupAndWrite("/v", items, r.io);
    expect(out).toMatchObject({ ok: false, stage: "write", failedPath: "/v/b.md", written: 1 });
    expect(out.ok === false && out.stage === "write" && out.rolledBack).toBe(1);
  });

  it("복원이 일부 실패해도 나머지를 계속 시도한다", async () => {
    // 하나가 막혔다고 나머지를 옛 상태로 남기면 vault가 더 뒤섞인다.
    const three: SafeWriteItem[] = [
      { path: "/v/a.md", newContent: "A" },
      { path: "/v/b.md", newContent: "B" },
      { path: "/v/c.md", newContent: "C" },
    ];
    let restoreAttempts = 0;
    const r = recorder({
      async writeNote(_v, path, content) {
        if (path === "/v/c.md" && content === "C") throw new Error("실패");
        if (content.startsWith("원본:")) {
          restoreAttempts++;
          if (path === "/v/a.md") throw new Error("복원 실패");
        }
      },
    });
    const out = await backupAndWrite("/v", three, r.io);
    expect(restoreAttempts).toBe(2); // a·b 둘 다 시도
    expect(out.ok === false && out.stage === "write" && out.rolledBack).toBe(1); // b만 성공
  });

  it("부분 복원이면 수동 복구가 필요하다고 말한다", async () => {
    const r = recorder({
      async writeNote(_v, path, content) {
        if (content === "새 B") throw new Error("실패");
        if (content.startsWith("원본:")) throw new Error("복원도 실패");
      },
    });
    const out = await backupAndWrite("/v", items, r.io);
    expect(describeFailure(out)).toContain("수동 복구");
  });

  it("vault 밖 경로는 롤백에서 건너뛴다", async () => {
    const outside: SafeWriteItem[] = [
      { path: "/other/x.md", newContent: "X" },
      { path: "/v/b.md", newContent: "새 B" },
    ];
    const r = recorder({
      async writeNote(_v, path) {
        if (path === "/v/b.md") throw new Error("실패");
      },
    });
    const out = await backupAndWrite("/v", outside, r.io);
    expect(out.ok === false && out.stage === "write" && out.rolledBack).toBe(0);
  });
});

describe("prune", () => {
  it("prune 실패가 전체를 실패시키지 않는다", async () => {
    const r = recorder({
      async pruneBackups() {
        throw new Error("prune 실패");
      },
    });
    const out = await backupAndWrite("/v", items, r.io);
    expect(out.ok).toBe(true);
  });
});

describe("relativeToVault", () => {
  it("vault 안이면 상대 경로", () => {
    expect(relativeToVault("/v", "/v/a/b.md")).toBe("a/b.md");
    expect(relativeToVault("/v/", "/v/a.md")).toBe("a.md");
  });

  it("vault 밖이면 null", () => {
    expect(relativeToVault("/v", "/other/a.md")).toBeNull();
    // 접두만 같은 형제 디렉터리에 속지 않는다.
    expect(relativeToVault("/v", "/vault-other/a.md")).toBeNull();
  });
});
