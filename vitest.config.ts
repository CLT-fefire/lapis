import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

const alias = { $lib: resolve(__dirname, "src/lib") };

/**
 * Lapis용 vitest 설정 — **프로젝트 2개**로 갈라 둔다.
 *
 * `node`는 순수 TS 모듈(`linkRewrite`·`frontmatter`·`snippet`·`mcp/`)이고, 대부분이 여기다.
 * `dom`은 **DOM과 Svelte 반응성이 필요한 것**만 담는다(`*.dom.test.ts`).
 *
 * ⚠️ **왜 격리하나** — `dom` 쪽은 두 가지를 켜야 한다:
 *
 * 1. `environment: "happy-dom"` — `document`가 있어야 프리뷰 후처리 함수를 태울 수 있다.
 * 2. `resolve.conditions: ["browser"]` — **이게 없으면 룬이 조용히 죽는다.** vitest는
 *    기본이 SSR이라 `$effect`가 컴파일 단계에서 no-op이 되고, 테스트는 **"안 돌았는데
 *    통과"** 한다. 실측으로 확인했다(effect 호출 0회인데 초록).
 *
 * 그리고 2번을 **전역에 두지 않는 이유**가 있다. `conditions: ["browser"]`는 모든 패키지의
 * export 해석을 바꾼다 — 순수 Node 테스트가 갑자기 브라우저 빌드를 물어도 대개 그냥
 * 통과하므로 **어긋난 걸 아무도 모른다.** 이 프로젝트가 반복해 데인 실패 방식이다
 * (`CACHE_VERSION` skew · 설정 부분 쓰기 · 옵션 복사). 필요한 쪽에만 켠다.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "mcp/**/*.test.ts"],
          exclude: ["**/*.dom.test.ts"],
        },
      },
      {
        plugins: [svelte({ hot: false })],
        resolve: { alias, conditions: ["browser"] },
        test: {
          name: "dom",
          environment: "happy-dom",
          include: ["src/**/*.dom.test.ts"],
        },
      },
    ],
  },
});
