import { parseNote } from "$lib/markdown";
import { resolveWikilink, type LinkIndex } from "$lib/linkIndex";
import {
  EMBED_MAX_DEPTH,
  embedFailureText,
  isCycle,
  sliceSection,
  type EmbedFailure,
} from "$lib/embed";

/**
 * 렌더된 프리뷰의 임베드 자리표시자를 채운다 — **앱 쪽 순회**.
 *
 * ⚠️ 규칙(깊이 · 순환 · 실패 문구)은 여기 없다. `$lib/embed.ts` 하나에 있고 CLI도 그걸
 * 쓴다. 여기 있는 것은 **DOM을 어떻게 훑느냐**뿐이다.
 *
 * ⚠️ `load` 를 주입받는다. 앱에서는 IPC(`readNote`)지만 테스트에서는 맵이다 — 주입하지
 * 않으면 이 로직을 DOM 테스트로 못 본다.
 */

export interface EmbedContext {
  index: LinkIndex;
  /** 지금 그리고 있는 노트 — 같은 이름의 노트가 둘일 때 어느 쪽인지 가른다. */
  fromPath: string;
  load(path: string): Promise<string>;
}

function fail(el: HTMLElement, kind: EmbedFailure, target: string): void {
  el.classList.add("embed-failed");
  el.textContent = embedFailureText(kind, target);
}

/**
 * @param chain 여기까지 지나온 노트 경로들. 재귀가 자기를 다시 부르는 것을 막는다.
 */
export async function fillEmbeds(
  root: HTMLElement,
  ctx: EmbedContext,
  chain: readonly string[] = [],
): Promise<void> {
  // ⚠️ **스냅샷을 뜬다.** 채우면서 새 자리표시자가 생기므로, 살아 있는 NodeList 를
  //    그대로 돌면 같은 것을 다시 만나거나 무한히 자란다.
  const slots = [...root.querySelectorAll<HTMLElement>(".embed[data-embed-target]")].filter(
    (el) => !el.dataset.embedDone,
  );

  for (const el of slots) {
    el.dataset.embedDone = "1";
    const target = el.dataset.embedTarget ?? "";
    const anchor = el.dataset.embedAnchor ?? null;
    const label = anchor === null ? target : `${target}#${anchor}`;

    const hit = resolveWikilink(anchor === null ? target : `${target}#${anchor}`, ctx.index, ctx.fromPath);
    const path = hit.sameDoc ? ctx.fromPath : hit.path;
    if (!path) {
      fail(el, "unresolved", label);
      continue;
    }
    if (isCycle(chain, path)) {
      fail(el, "cycle", label);
      continue;
    }
    if (chain.length >= EMBED_MAX_DEPTH) {
      fail(el, "too-deep", label);
      continue;
    }

    let body: string;
    try {
      body = await ctx.load(path);
    } catch {
      // ⚠️ 읽기 실패를 빈 자리로 두면 문장이 끊긴 것을 못 알아챈다.
      fail(el, "unresolved", label);
      continue;
    }

    const parsed = parseNote(body);
    let html = parsed.html;
    if (anchor !== null) {
      const section = sliceSection(parsed.body, parsed.headings, anchor);
      if (section === null) {
        fail(el, "no-section", label);
        continue;
      }
      html = parseNote(section).html;
    }

    el.innerHTML = html;
    // 재귀 — 방금 넣은 것 안에 또 임베드가 있을 수 있다.
    await fillEmbeds(el, { ...ctx, fromPath: path }, [...chain, path]);
  }
}
