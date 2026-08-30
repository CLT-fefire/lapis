import type { LinkInfo } from "$lib/tauri/notes";
import { filterRows } from "$lib/tableView";
import { parseSavedQuery } from "$lib/savedQuery";
import { noteStem, noteDisplayName } from "$lib/notePath";
import { noteHasAnyTag } from "$lib/tagMatch";

/**
 * 저장된 질의를 **그 자리에서** 채운다. `renderMermaidIn` 과 같은 자리에서 돈다.
 *
 * ## 🔴 고르는 일은 여기서 안 한다
 *
 * `tableView.ts` 의 `filterRows` — 표 화면이 쓰는 **바로 그 함수**를 부른다.
 * 여기서 따로 골랐다면 같은 질의가 표와 노트에서 다른 답을 냈을 것이다.
 *
 * ## 🔴 클릭도 새로 안 만든다
 *
 * 결과 줄을 `span.wikilink[data-target]` 으로 낸다. 그러면 `previewClick.ts` 의
 * **같은 규칙**이 그대로 받아서 `jumpToWikilink` 로 푼다 — 본문 칸이든 옆칸이든 동작이
 * 같고, 이름이 겹칠 때의 판정도 앱의 나머지와 같아진다.
 *
 * ⚠️ 그래서 `data-target` 에 **경로가 아니라 이름(stem)** 을 넣는다. 경로를 넣으면
 * 위키링크 해석기가 못 푼다.
 */

export interface QueryContext {
  infos: readonly LinkInfo[];
  vaultRoot: string;
}

/** 이미 채운 자리는 다시 안 채운다 — mermaid 와 같은 표식. */
const DONE = "data-rendered";

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 오류는 **접지 않고** 보여준다 — 조용히 빈 칸이면 "결과 없음"과 구별이 안 된다. */
function renderErrors(host: HTMLElement, title: string, errors: readonly string[]): void {
  const box = el("div", "lapis-query lapis-query--error");
  box.appendChild(el("p", "lapis-query-title", title));
  const ul = el("ul", "lapis-query-errors");
  for (const e of errors) ul.appendChild(el("li", "", e));
  box.appendChild(ul);
  host.replaceChildren(box);
}

/**
 * @param root 그려진 본문
 * @param ctx  vault 가 아직 없으면 `null` — 그때는 "아직 인덱스가 없다"고 말한다.
 * @param t    문구. 호출부가 paraglide 에서 가져다 넘긴다(이 파일은 i18n 을 안 import 한다 —
 *             순수하게 두어야 테스트가 메시지 묶음 없이 돈다).
 */
export function renderQueriesIn(
  root: HTMLElement,
  ctx: QueryContext | null,
  t: { badQuery: string; noIndex: string; empty: string; count: (n: number) => string },
): void {
  const hosts = root.querySelectorAll<HTMLElement>(`.lapis-query-host:not([${DONE}])`);
  for (const host of hosts) {
    host.setAttribute(DONE, "1");
    const source = host.getAttribute("data-source") ?? "";
    const parsed = parseSavedQuery(source);

    if (!parsed.ok) {
      renderErrors(host, t.badQuery, parsed.errors);
      continue;
    }
    if (!ctx) {
      renderErrors(host, t.noIndex, []);
      continue;
    }

    const q = parsed.query;
    // ⚠️ `filterRows` 는 Set 을 받는다. 빈 Set 인 축은 안 거른다 — 그쪽 계약 그대로다.
    const byAxes = filterRows(
      ctx.infos,
      {
        docKinds: new Set(q.docKinds),
        topics: new Set(q.topics),
        text: q.text,
      },
      ctx.vaultRoot,
    );
    // 🔴 태그는 `filterRows` 에 없다 — 표 화면에 칩이 없어서다. 규칙은 `tagMatch` 하나를
    //    쓰므로 앱 필터·`core/query.ts` 와 같은 답이 나온다. 축 사이는 AND.
    const rows = byAxes.filter((info) => noteHasAnyTag(info.tags, q.tags));

    const box = el("div", "lapis-query");
    // 🔴 **몇 건인지 먼저 말한다.** 잘린 목록만 보여주면 그게 전부인 줄 안다.
    box.appendChild(el("p", "lapis-query-title", t.count(rows.length)));

    if (rows.length === 0) {
      box.appendChild(el("p", "lapis-query-empty", t.empty));
      host.replaceChildren(box);
      continue;
    }

    const ul = el("ul", "lapis-query-list");
    for (const info of rows.slice(0, q.limit)) {
      const li = document.createElement("li");
      const link = el("span", "wikilink", noteStem(info.source_path));
      link.setAttribute("data-target", noteStem(info.source_path));
      link.setAttribute("role", "link");
      link.setAttribute("tabindex", "0");
      li.appendChild(link);
      li.appendChild(el("span", "lapis-query-sub", noteDisplayName(info.source_path)));
      ul.appendChild(li);
    }
    box.appendChild(ul);

    // ⚠️ 자른 것을 **말한다.** 조용히 자르면 결과 수와 줄 수가 어긋난 채로 읽힌다.
    if (rows.length > q.limit) {
      box.appendChild(el("p", "lapis-query-more", `… ${rows.length - q.limit}`));
    }
    host.replaceChildren(box);
  }
}
