import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { yieldToPaint } from "./yieldToPaint";

/**
 * 🔴 **창이 가려지면 `requestAnimationFrame` 은 한 번도 안 온다.**
 *
 * 실측(dev 서버, 백그라운드 탭): `document.hidden === true` 인 동안 rAF 콜백이 1.5s 안에
 * 0회. 그 상태에서 인덱스 빌드가 첫 청크 경계에서 **영원히 멈췄다** — 에러도, 타임아웃도,
 * 로그도 없이 "인덱스 만드는 중…" 오버레이만 남는다. 정확히 이 저장소가 경계하는 종류다.
 *
 * 그래서 rAF 를 **기다리기만 하지 않는다.** 타이머와 경주시켜 먼저 오는 쪽을 쓴다.
 */

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("yieldToPaint", () => {
  it("rAF 가 영영 안 와도 풀린다", async () => {
    // 콜백을 삼키는 rAF — 가려진 창의 실제 동작이다.
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("document", { hidden: true });

    const settled = await Promise.race([
      yieldToPaint().then(() => "resolved"),
      new Promise((r) => setTimeout(() => r("hung"), 1000)),
    ]);
    expect(settled, "rAF 만 기다리면 인덱스 빌드가 멈춘다").toBe("resolved");
  });

  it("보이는 창에서는 rAF 를 쓴다", async () => {
    let called = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: () => void) => {
      called++;
      setTimeout(cb, 0);
      return 1;
    });
    vi.stubGlobal("document", { hidden: false });

    await yieldToPaint();
    expect(called, "보일 때는 paint 를 기다려야 스피너가 갱신된다").toBe(1);
  });

  it("rAF 가 없는 환경(워커·노드)에서도 풀린다", async () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    vi.stubGlobal("document", undefined);
    await expect(yieldToPaint()).resolves.toBeUndefined();
  });
});

/**
 * ⚠️ **사본을 금지한다.** 같은 헬퍼가 세 곳(`linkIndex` · `relations` · `stores/vault`)에
 * 복제돼 있었고, 그래서 결함도 세 벌이었다. 이 저장소에서 가장 자주 나온 버그 유형이
 * "같은 규칙이 두 군데 적혀 있다" 다.
 */
describe("사본 금지", () => {
  function tsFiles(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) tsFiles(p, out);
      else if (/\.(ts|svelte)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("rAF 를 그냥 await 하는 곳이 없다", () => {
    const offenders: string[] = [];
    for (const f of tsFiles(join(ROOT, "src"))) {
      if (f.endsWith("yieldToPaint.ts")) continue;
      const body = readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      // `requestAnimationFrame(...)` 을 resolve 로 직접 잇는 형태.
      if (/requestAnimationFrame\(\s*\(\)\s*=>\s*resolve\(\)\s*\)/.test(body)) {
        offenders.push(f.replace(ROOT, ""));
      }
    }
    expect(
      offenders,
      `rAF 를 직접 기다린다 — 창이 가려지면 여기서 멈춘다. yieldToPaint() 를 쓴다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
