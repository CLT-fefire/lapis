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
  //
  // ⚠️ **1420이 아니다.** Tauri 기본값이 1420인데 이 개발 머신에서 다른 앱이 그 포트를
  // 점유하고 있다. `strictPort: true`라 충돌하면 조용히 다른 포트로 새지 않고 **실패**한다.
  // 바꿀 때는 `tauri.conf.json`의 `devUrl`과 **반드시 함께** 고칠 것 — 한쪽만 고치면
  // Tauri가 빈 창을 띄운다(흰 화면).
  //
  // ⚠️ 포트가 곧 **localStorage 오리진**이다(`src-tauri/src/paths.rs` 참조). 포트를 바꾸면
  // dev 앱의 탭·`last-vault-path`·페인 상태가 **처음 쓰는 것처럼 비어 보인다.** vault 파일과
  // Rust가 쓰는 디스크 상태(검색 캐시·창 위치)는 그대로다 — 잃는 게 아니라 갈리는 것이다.
  server: {
    port: 1430,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1431,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
