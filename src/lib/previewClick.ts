import { openUrl } from "@tauri-apps/plugin-opener";
import { jumpToWikilink } from "$lib/stores/vault";
import { exportMermaidHostToPng } from "$lib/mermaidExport";
import { logError } from "$lib/stores/usage";
import { m } from "$lib/paraglide/messages.js";
import { stripNoteExt } from "$lib/notePath";
import type { OpenSurface } from "$lib/usageSchema";

/**
 * 그려진 본문 안의 클릭 — **본문 칸과 옆칸이 같이 쓴다.**
 *
 * ## 🔴 왜 한 곳인가
 *
 * 나란히 보기를 넣을 때 이 처리를 옆칸에 **다시 적었고, 그 사본이 틀렸다.**
 * `a.wikilink` 를 찾았는데 플러그인이 내는 것은 `span.wikilink` 였고
 * (`markdownPlugins/wikilink.ts` 주석: *"a 태그의 default navigation 위험 회피"*),
 * 읽은 속성 `data-target-path` 는 **저장소 어디서도 만들지 않는 이름**이었다.
 * 둘 다 조용히 빗나가서 옆칸의 링크는 눌러도 아무 일도 안 났다.
 *
 * 두 칸은 **같은 부품**으로 그리므로(`parseNote` · `enhanceRendered` · `renderMermaidIn`)
 * 나오는 HTML 이 같다. 그러면 그것을 읽는 규칙도 하나여야 한다.
 *
 * ## ⚠️ 순서가 의미를 갖는다
 *
 * mermaid 버튼이 **anchor 검사보다 앞**이다. `<button>` 은 `closest("a")` 에 안 걸려
 * 아래 `if (!anchor) return` 에서 조용히 무시된다.
 *
 * @param notePath 그 칸이 지금 보고 있는 노트. mermaid PNG 의 파일 이름에만 쓴다.
 * @param via 어느 칸에서 눌렀나. 🔴 **호출부가 준다** — 여기서 추측하면 틀린다.
 *            옆칸을 통해 옮겨간 것과 본문에서 옮겨간 것은 **다른 사건**이고,
 *            그걸 구별 못 하면 "나란히 보기가 값을 하나"에 답할 수 없다.
 */
export async function handleRenderedClick(
  e: MouseEvent,
  notePath: string | null,
  via: OpenSurface,
): Promise<void> {
  const el = e.target as HTMLElement | null;
  if (!el) return;

  // 0) mermaid PNG 내보내기 버튼
  const exportBtn = el.closest(".mermaid-export-btn") as HTMLElement | null;
  if (exportBtn) {
    e.preventDefault();
    const host = exportBtn.closest(".mermaid-host") as HTMLElement | null;
    if (host) {
      const fileName = notePath?.split("/").pop() ?? "diagram";
      const base = stripNoteExt(fileName);
      try {
        await exportMermaidHostToPng(host, base);
      } catch (err) {
        logError("previewClick", m.page_mermaid_export_failed(), err);
      }
    }
    return;
  }

  // 1) 위키링크 — `span.wikilink[data-target]`. 값은 **이름이지 경로가 아니다.**
  //    푸는 것은 `jumpToWikilink` 다: 같은 이름의 노트가 둘일 때 지금 보는 노트를
  //    맥락으로 쓰고, `[[#헤딩]]` 이면 이동 없이 스크롤만 한다.
  const wikilink = el.closest(".wikilink") as HTMLElement | null;
  if (wikilink) {
    e.preventDefault();
    const target = wikilink.getAttribute("data-target");
    if (target) {
      const ok = await jumpToWikilink(target, via);
      if (!ok) console.info("wikilink unresolved:", target);
    }
    return;
  }

  // 2) 일반 <a> — 마크다운 링크 `[텍스트](경로)`
  const anchor = el.closest("a") as HTMLAnchorElement | null;
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";

  // 바깥 URL → 시스템 브라우저. 웹뷰가 그리로 가면 앱이 사라진다.
  if (/^(https?:|mailto:|tel:)/i.test(href)) {
    e.preventDefault();
    try {
      await openUrl(href);
    } catch (err) {
      logError("previewClick", "openUrl failed", err);
    }
    return;
  }

  // 빈 href · `#` · 안쪽 경로 → SPA 라우팅 차단
  e.preventDefault();
  if (!href || href === "#") return;

  // 확장자와 앞 경로를 떼고 **위키링크와 같은 판정**을 쓴다.
  // ⚠️ 벗기는 규칙은 `notePath.ts` 것을 쓴다 — 예전엔 `.md` 만 벗겨서 `.mmd` 링크가
  //    `diagram.mmd` 인 채로 해소를 시도했고, 위키링크는 `[[diagram]]` 이라 안 맞았다.
  const cleaned = stripNoteExt(href.replace(/^\.\//, "").replace(/^\//, ""));
  const lastSegment = cleaned.split("/").pop() ?? cleaned;
  const ok = await jumpToWikilink(lastSegment, via);
  if (!ok) console.info("note link unresolved:", href);
}
