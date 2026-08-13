import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * Lapis용 vitest 설정.
 *
 * SvelteKit plugin 없이 순수 Node 환경 — 단위 테스트는 Svelte 컴포넌트 외부의
 * 순수 TS 모듈(`linkRewrite`, `frontmatter`, `snippet` 등)에 집중.
 * `$lib` alias만 SvelteKit 컨벤션과 맞춰둔다.
 */
export default defineConfig({
  resolve: {
    alias: {
      $lib: resolve(__dirname, "src/lib"),
    },
  },
  test: {
    environment: "node",
    // `mcp/`는 앱이 만든 캐시를 읽는 지식 질의 MCP 서버 — `$lib`을 import하므로 같은
    // alias가 필요하고, 순수 Node라 같은 환경에서 돈다.
    include: ["src/**/*.test.ts", "mcp/**/*.test.ts"],
  },
});
