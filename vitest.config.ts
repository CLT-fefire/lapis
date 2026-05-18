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
    include: ["src/**/*.test.ts"],
  },
});
