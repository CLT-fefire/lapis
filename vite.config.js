import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import { paraglideVitePlugin } from "@inlang/paraglide-js";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    // ⚠️ `sv add paraglide`(SvelteKit 통합)를 쓰지 않는다 — 그건 reroute/handle 훅으로
    // **URL 기반 로케일**(/ko/…)을 만드는데, Lapis는 ssr=false + adapter-static
    // 데스크톱 SPA라 로케일을 실을 URL이 없다. Vite 플러그인만 직접 붙인다.
    paraglideVitePlugin({
      project: "./project.inlang",
      outdir: "./src/lib/paraglide",
      emitTsDeclarations: true,
      // ⚠️ Paraglide의 `localStorage`·`preferredLanguage` 전략을 쓰지 않는다.
      // 첫 해소 때 `setLocale(resolved)`가 **감지 결과를 localStorage에 박아버려서**
      // (runtime.js의 `localeInitiallySet` 분기) 그 뒤로는 OS 언어를 바꿔도 안 따라온다.
      // 사용자가 고른 적도 없는데 고정되는 셈이라 "OS 언어 추종" 요구를 깬다.
      // → 해소는 `stores/locale.ts`가 `overwriteGetLocale()`로 직접 관장한다.
      strategy: ["baseLocale"],
    }),
    sveltekit(),
  ],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
