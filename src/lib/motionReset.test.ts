import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 모션 리셋의 **두 갈래가 같은 것을 복원하는가**.
 *
 * CSS 에는 "미디어 쿼리 OR 속성" 을 한 선택자로 합칠 방법이 없다. 그래서 기능 요소
 * (스피너·진행 바) 복원 목록이 두 곳에 산다:
 *
 * 1. `@media (prefers-reduced-motion: reduce)` — 시스템이 줄이라고 할 때
 * 2. `:root[data-motion="minimal"]` — 사용자가 설정에서 고를 때
 *
 * ⚠️ 한쪽만 늘리면 **그 상태에서만** 인디케이터가 멈춘다. 멈춘 진행 바는 "작업이
 * 끝났다"로 읽히고, 에러는 없다. 핸드오프가 준 `app.css` 도 실제로 `minimal` 쪽
 * 복원이 통째로 빠져 있었다.
 */

const css = readFileSync(fileURLToPath(new URL("../app.css", import.meta.url)), "utf-8");

/** 주석을 지운다 — 안 지우면 가드가 자기 설명 문구에 맞는다. */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

function mediaSpan(): [number, number] {
  const at = bare.indexOf("@media (prefers-reduced-motion: reduce)");
  if (at < 0) throw new Error("reduced-motion 미디어 쿼리를 못 찾았다");
  let depth = 0;
  for (let i = bare.indexOf("{", at); i < bare.length; i++) {
    if (bare[i] === "{") depth++;
    else if (bare[i] === "}" && --depth === 0) return [at, i];
  }
  throw new Error("미디어 쿼리 블록이 안 닫혔다");
}

const [MEDIA_FROM, MEDIA_TO] = mediaSpan();
const MEDIA = bare.slice(MEDIA_FROM, MEDIA_TO);

/**
 * ⚠️ 미디어 쿼리 **바깥**만. 처음엔 파일 전체를 훑었는데, 그러면 미디어 쿼리 안의
 * `.spinner` 가 속성 쪽 목록에도 잡혀 **두 목록이 항상 같아 보였다** — `minimal` 쪽
 * 복원을 통째로 지워도 가드가 초록이었다. 카나리아로 잡았다.
 */
const OUTSIDE = bare.slice(0, MEDIA_FROM) + bare.slice(MEDIA_TO);

/** 복원 대상 = `animation-iteration-count: infinite` 로 되살아나는 선택자들. */
function restored(scope: string, strip: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/animation-iteration-count:\s*infinite/.test(m[2])) continue;
    for (const sel of m[1].split(",")) {
      out.add(sel.trim().replace(strip, "").trim());
    }
  }
  return out;
}

describe("모션 리셋", () => {
  const media = MEDIA;

  it("시스템 쪽이 기능 요소를 되살린다", () => {
    expect(restored(media, /^$/).size).toBeGreaterThan(0);
  });

  /** 이 가드의 본체. */
  it("설정 '최소' 쪽이 같은 목록을 되살린다", () => {
    const fromMedia = restored(media, /^$/);
    const fromAttr = restored(OUTSIDE, /^:root\[data-motion="minimal"\]\s*/);
    for (const sel of fromMedia) {
      expect(fromAttr.has(sel), `'최소' 에서 안 되살아난다: ${sel}`).toBe(true);
    }
  });

  /**
   * ⚠️ `full` 은 시스템을 **이겨야** 한다. 미디어 쿼리가 `*` 에 그냥 걸려 있으면
   * "전체"를 골라도 아무 일이 안 일어난다 — 설정 화면만 바뀐다.
   */
  it("'전체' 는 시스템 미디어 쿼리에서 빠진다", () => {
    expect(media).toMatch(/:root:not\(\[data-motion="full"\]\)\s*\*/);
  });

  /** 두 갈래 모두 stagger 지연을 0 으로 놓는다 — 안 그러면 그 시간 동안 안 보인다. */
  it("팔레트 stagger 지연이 양쪽에서 풀린다", () => {
    expect(media).toMatch(/\.result\s*\{[^}]*animation-delay:\s*0ms/);
    expect(OUTSIDE).toMatch(
      /:root\[data-motion="minimal"\][^{]*\.result\s*\{[^}]*animation-delay:\s*0ms/,
    );
  });
});

/**
 * ⚠️ **복원 목록이 실재하는 이름만 들어야 한다.**
 *
 * 3.0 작업 중에 재 보니 다섯 중 **넷이 앱 어디에도 없는 이름**이었다
 * (`progress-fill` · `mirror-dot.syncing` · `loading-spinner` · 그리고 당시의
 * `progress-shimmer`). 옛 무한 슬라이딩 바가 사라지면서 같이 죽은 이름들인데 목록만
 * 남아 있었다.
 *
 * 죽은 이름은 조용히 틀리는 것보다 더 나쁘다 — 다음 사람이 목록을 보고 "이건 지켜지고
 * 있구나" 하고 읽는데, 지켜지는 대상이 없다. 어느 이름이 살아 있는지도 구별이 안 된다.
 */
describe("복원 목록이 실재를 가리킨다", () => {
  const SRC_DIR = fileURLToPath(new URL("./", import.meta.url));

  /** `src/` 아래 모든 `.svelte` 를 한 덩어리로. */
  function allSvelte(): string {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".svelte")) out.push(readFileSync(p, "utf-8"));
      }
    };
    walk(join(SRC_DIR, ".."));
    return out.join("\n");
  }

  it("되살리는 클래스가 전부 어딘가에서 쓰인다", () => {
    const markup = allSvelte();
    expect(markup.length, "svelte 파일을 못 읽었다").toBeGreaterThan(10000);

    const names = new Set<string>();
    for (const sel of restored(MEDIA, /^$/)) {
      // `.mirror-dot.syncing` 같은 복합 선택자는 첫 클래스만 본다.
      const first = sel.match(/\.([a-z0-9-]+)/i);
      if (first) names.add(first[1]);
    }
    expect(names.size, "복원 목록이 비었다").toBeGreaterThan(0);

    const dead = [...names].filter((n) => !new RegExp(`\\b${n}\\b`).test(markup));
    expect(dead, `앱에 없는 이름을 되살리고 있다: ${dead.join(", ")}`).toEqual([]);
  });
});
