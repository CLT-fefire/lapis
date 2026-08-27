import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * 실행 래퍼가 **양쪽 플랫폼에서** 도는지 본다.
 *
 * ## ⚠️ 왜 이 가드가 있나
 *
 * 래퍼는 `#!/bin/sh` 스크립트다. macOS에서는 그냥 돌지만 **Windows 셸(PowerShell·cmd)은
 * 그걸 실행할 줄 모른다.** `cli/lapis`를 치면 "이 파일을 열 앱을 고르라"는 창이 뜨고,
 * 편집기를 고르면 셸 스크립트 내용이 보인다.
 *
 * 에러 메시지가 없다는 게 고약하다 — 명령이 틀렸다고도, 지원 안 한다고도 안 한다.
 * `README`는 `cli/lapis search …`라고 적어 두고 있었고, Windows는 이 저장소의 **1급
 * 타깃**이다. 실제로 그 상태로 릴리스가 나갔다.
 *
 * 그래서 sh 래퍼마다 `.cmd` 짝이 있어야 하고, **둘이 같은 것을 가리켜야** 한다.
 * 짝이 갈리면 한쪽 플랫폼만 옛 진입점을 부르는데, 그것도 조용하다.
 */

const REPO = fileURLToPath(new URL("..", import.meta.url));

/** sh 래퍼 = `bundle-run.sh`를 부르는 확장자 없는 파일. */
function shLaunchers(): string[] {
  const out: string[] = [];
  for (const dir of ["cli", "mcp"]) {
    for (const name of readdirSync(path.join(REPO, dir))) {
      if (path.extname(name) !== "") continue;
      const full = path.join(REPO, dir, name);
      let text: string;
      try {
        text = readFileSync(full, "utf-8");
      } catch {
        continue; // 디렉터리
      }
      if (text.startsWith("#!/bin/sh") && text.includes("bundle-run.sh")) out.push(full);
    }
  }
  return out.sort();
}

/**
 * `bundle-run` 호출에서 (이름, 진입점 파일명)을 뽑는다. sh·cmd 공통.
 *
 * ⚠️ 두 셸이 **자기 디렉터리를 다르게 쓴다** — sh는 `$HERE/`, cmd는 `%~dp0`(끝에 이미
 * 구분자가 붙는다). 둘 다 떼고 파일명만 비교한다. 안 떼면 같은 파일을 가리키는 두 줄이
 * 다르다고 나와서, 가드가 진짜 불일치가 아니라 표기 차이에 운다.
 */
function callOf(text: string): { name: string; entry: string } | null {
  const m = /bundle-run\.(?:sh|mjs)"?\s+(\S+)\s+"([^"]+)"/.exec(text);
  if (!m) return null;
  const raw = m[2].replace(/\\/g, "/").replace(/^%~dp0/, "").replace(/^\$HERE\//, "");
  return { name: m[1], entry: path.basename(raw) };
}

/**
 * 줄머리 주석을 지운다 — sh는 `#`, mjs는 `//`.
 *
 * ⚠️ **이걸 안 하면 가드가 자기 설명을 보고 통과한다.** 실제로 겪었다: `bundle-run.mjs`의
 * 헤더가 `--alias:$lib=<repo>/src/lib`라고 적어 둬서, 진짜 alias 옵션을 지워도 초록이었다.
 * 카나리아를 안 돌렸으면 못 잡았을 것이다.
 */
const stripComments = (src: string) =>
  src.replace(/^\s*(?:#|\/\/).*$/gm, " ");

/**
 * 번들 러너 두 벌이 **공유하는 계약**. 나머지(node 탐색·임시 파일)는 플랫폼 사정이라
 * 갈리는 게 맞지만, 이 둘이 갈리면 한쪽 플랫폼에서만 조용히 안 된다.
 *
 * - `$lib` 별칭이 빠지면 번들이 앱 트리를 못 읽는다
 * - `LAPIS_REPO`가 빠지면 `--version`처럼 package.json이 필요한 곳이 죽는다
 */
describe("번들 러너 두 벌의 공유 계약", () => {
  const RUNNERS = ["scripts/bundle-run.sh", "scripts/bundle-run.mjs"] as const;

  for (const rel of RUNNERS) {
    const src = stripComments(readFileSync(path.join(REPO, rel), "utf-8"));

    it(`${rel} 를 실제로 읽었다`, () => {
      expect(src.length).toBeGreaterThan(500);
    });

    it(`${rel} 가 $lib 별칭을 준다`, () => {
      expect(src).toMatch(/alias.{0,12}\$lib|\$lib.{0,12}alias/s);
    });

    it(`${rel} 가 LAPIS_REPO 를 넘긴다`, () => {
      expect(src).toContain("LAPIS_REPO");
    });
  }
});

describe("실행 래퍼", () => {
  const shells = shLaunchers();

  /** ⚠️ 카나리아 — 못 찾으면 아래 전부가 빈 목록을 보고 통과한다. */
  it("sh 래퍼를 실제로 찾았다", () => {
    expect(shells.length).toBeGreaterThanOrEqual(4);
  });

  for (const sh of shells) {
    const rel = path.relative(REPO, sh).replace(/\\/g, "/");

    it(`${rel} 에 .cmd 짝이 있다`, () => {
      expect(existsSync(`${sh}.cmd`), `${rel}.cmd 가 없다 — Windows에서 안 돈다`).toBe(true);
    });

    it(`${rel} 와 짝이 같은 진입점을 부른다`, () => {
      const a = callOf(readFileSync(sh, "utf-8"));
      const b = callOf(readFileSync(`${sh}.cmd`, "utf-8"));
      expect(a, "sh 쪽에서 호출을 못 읽었다").not.toBeNull();
      expect(b, "cmd 쪽에서 호출을 못 읽었다").not.toBeNull();
      expect(b).toEqual(a);
    });

    it(`${rel} 가 부르는 진입점이 실재한다`, () => {
      const call = callOf(readFileSync(sh, "utf-8"));
      expect(existsSync(path.join(path.dirname(sh), call!.entry))).toBe(true);
    });
  }
});
