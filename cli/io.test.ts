import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeCliIo } from "./io.ts";

/**
 * CLI 의 파일 IO — **테스트가 0이었다.**
 *
 * ## ⚠️ 앱과 **같은 보장**이어야 한다
 *
 * 앱은 Rust `write_note` 를 거치고, 그게 원자적 쓰기 · vault 이탈 차단 · 확장자
 * 화이트리스트 셋을 준다. CLI 가 이보다 느슨하면 **같은 트랜잭션(`safeWrite`)을 쓰는데
 * 안전성만 갈린다.**
 *
 * ⚠️ 이탈 차단은 **조용히 통과하면 안 되는 종류**다. 통과하면 vault 밖 파일을 덮어쓰고,
 * 그건 되돌릴 수 없다. 그래서 가드가 실제로 던지는지를 본다.
 */

let vault: string;
const io = makeCliIo({ log: () => {} });

beforeEach(() => {
  vault = mkdtempSync(path.join(tmpdir(), "lapis-io-"));
  mkdirSync(path.join(vault, "notes"), { recursive: true });
  writeFileSync(path.join(vault, "notes", "a.md"), "원래 내용", "utf8");
});

afterEach(() => rmSync(vault, { recursive: true, force: true }));

const at = (...p: string[]) => path.join(vault, ...p);

describe("읽기·쓰기", () => {
  it("읽은 것을 그대로 낸다", async () => {
    expect(await io.readNote(at("notes", "a.md"))).toBe("원래 내용");
  });

  it("쓴 것이 디스크에 남는다", async () => {
    await io.writeNote(vault, at("notes", "a.md"), "새 내용");
    expect(readFileSync(at("notes", "a.md"), "utf8")).toBe("새 내용");
  });

  /** ⚠️ 임시 파일이 남으면 vault 가 더러워지고 인덱서가 그걸 노트로 센다. */
  it("임시 파일을 안 남긴다", async () => {
    await io.writeNote(vault, at("notes", "a.md"), "새 내용");
    expect(readdirSync(at("notes")).sort()).toEqual(["a.md"]);
  });

  it("`.mmd` 도 쓸 수 있다 — 앱이 지원하는 확장자다", async () => {
    writeFileSync(at("notes", "d.mmd"), "graph TD", "utf8");
    await io.writeNote(vault, at("notes", "d.mmd"), "graph LR");
    expect(readFileSync(at("notes", "d.mmd"), "utf8")).toBe("graph LR");
  });
});

describe("🔴 확장자 화이트리스트", () => {
  it("지원하지 않는 확장자는 던진다", async () => {
    writeFileSync(at("notes", "x.txt"), "x", "utf8");
    await expect(io.writeNote(vault, at("notes", "x.txt"), "덮어쓰기")).rejects.toThrow(
      /확장자/,
    );
  });

  /** ⚠️ 던지고 **끝나야** 한다 — 던지기 전에 이미 썼으면 가드가 없는 것과 같다. */
  it("던진 뒤 원본이 그대로다", async () => {
    writeFileSync(at("notes", "x.txt"), "건드리면 안 됨", "utf8");
    await io.writeNote(vault, at("notes", "x.txt"), "덮어쓰기").catch(() => {});
    expect(readFileSync(at("notes", "x.txt"), "utf8")).toBe("건드리면 안 됨");
  });
});

describe("🔴 vault 이탈 차단", () => {
  it("vault 밖 경로는 던진다", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "lapis-out-"));
    try {
      writeFileSync(path.join(outside, "b.md"), "남의 파일", "utf8");
      await expect(io.writeNote(vault, path.join(outside, "b.md"), "덮어쓰기")).rejects.toThrow(
        /vault 밖/,
      );
      expect(
        readFileSync(path.join(outside, "b.md"), "utf8"),
        "던졌는데 이미 썼으면 가드가 없는 것과 같다",
      ).toBe("남의 파일");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  /**
   * ⚠️ **문자열 비교만으로는 부족하다.** `vault/link` → 바깥 을 가리키는 심링크가 있으면
   * 문자열은 vault 안인데 실제로는 밖이다. Rust 가 `canonicalize` 후 `starts_with` 를
   * 하는 이유와 같다.
   *
   * 심링크를 못 만드는 환경(권한 없는 Windows)에서는 건너뛴다 — **못 만든 것을 통과로
   * 세지 않는다.**
   */
  it("심링크로 밖을 가리켜도 막는다", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "lapis-out-"));
    const link = at("notes", "escape.md");
    try {
      writeFileSync(path.join(outside, "b.md"), "남의 파일", "utf8");
      const { symlinkSync } = await import("node:fs");
      try {
        symlinkSync(path.join(outside, "b.md"), link, "file");
      } catch {
        return; // 심링크를 못 만드는 환경 — 이 단언은 건너뛴다
      }
      await expect(io.writeNote(vault, link, "덮어쓰기")).rejects.toThrow(/vault 밖/);
      expect(readFileSync(path.join(outside, "b.md"), "utf8")).toBe("남의 파일");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe("백업", () => {
  it("원본을 상대 경로 구조 그대로 복사한다", async () => {
    const root = await io.backupNotes(vault, [at("notes", "a.md")], ".lapis/bk");
    expect(readFileSync(path.join(root, "notes", "a.md"), "utf8")).toBe("원래 내용");
  });

  /** ⚠️ 백업 대상도 vault 안이어야 한다 — 아니면 남의 파일을 vault 안으로 끌어온다. */
  it("vault 밖 파일은 백업하지 않는다", async () => {
    const outside = mkdtempSync(path.join(tmpdir(), "lapis-out-"));
    try {
      writeFileSync(path.join(outside, "b.md"), "남의 파일", "utf8");
      await expect(
        io.backupNotes(vault, [path.join(outside, "b.md")], ".lapis/bk"),
      ).rejects.toThrow(/vault 밖/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
