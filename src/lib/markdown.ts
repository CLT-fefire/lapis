import { logWarn } from "$lib/stores/usage";
import MarkdownIt from "markdown-it";
import yaml from "js-yaml";
import hljs from "highlight.js/lib/core";
import swift from "highlight.js/lib/languages/swift";
import objectivec from "highlight.js/lib/languages/objectivec";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import cssLang from "highlight.js/lib/languages/css";
import rust from "highlight.js/lib/languages/rust";
import goLang from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import kotlin from "highlight.js/lib/languages/kotlin";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import yamlLang from "highlight.js/lib/languages/yaml";
import markdownLang from "highlight.js/lib/languages/markdown";
import sql from "highlight.js/lib/languages/sql";
import diff from "highlight.js/lib/languages/diff";
import toml from "highlight.js/lib/languages/ini";
import dart from "highlight.js/lib/languages/dart";
import ruby from "highlight.js/lib/languages/ruby";
import http from "highlight.js/lib/languages/http";
import { FRONTMATTER_YAML_SCHEMA } from "$lib/frontmatter";
import { wikilinkPlugin } from "$lib/markdownPlugins/wikilink";
import { mermaidPlugin } from "$lib/markdownPlugins/mermaid";
import { lapisQueryPlugin } from "$lib/markdownPlugins/lapisQuery";
import { taskListPlugin } from "./markdownPlugins/taskList";
import { calloutPlugin } from "$lib/markdownPlugins/callout";
import { embedPlugin } from "$lib/markdownPlugins/embed";
import {
  headingAnchorPlugin,
  type HeadingInfo,
} from "$lib/markdownPlugins/headingAnchor";

// 코드 펜스 구문 하이라이팅용 언어 등록 (core 빌드 + 선택 언어만 → 번들 경량).
// 각 언어 모듈은 자체 alias(js/ts/py/sh/yml 등)도 함께 등록한다.
const HLJS_LANGUAGES: Record<string, (hljs: typeof import("highlight.js").default) => unknown> = {
  swift,
  objectivec,
  javascript,
  typescript,
  python,
  bash,
  json,
  xml,
  css: cssLang,
  rust,
  go: goLang,
  java,
  kotlin,
  c,
  cpp,
  yaml: yamlLang,
  markdown: markdownLang,
  sql,
  diff,
  toml,
  // 아래 3종은 vault 실측으로 추가(2026-08-24) — 등록 전엔 무색으로 그려졌다.
  dart,
  ruby,
  http,
};
for (const [name, lang] of Object.entries(HLJS_LANGUAGES)) {
  hljs.registerLanguage(name, lang as never);
}

/**
 * hljs가 언어를 갖고 있지만 **그 이름으로는 못 찾는** 경우를 잇는다.
 *
 * `highlight()`가 info string을 소문자화만 하고 그대로 `getLanguage`에 넘기므로,
 * alias 목록에 없는 표기는 등록된 언어를 두고도 무색으로 떨어진다.
 *
 * - `objective-c` — `objectivec`의 alias는 `objc`/`mm`/`obj-c`뿐이라 이 표기가 샌다.
 * - `svelte` — hljs에 전용 언어가 없다. `xml`이 `<script>`/`<style>` 안을 하위 언어로
 *   넘기므로 마크업+스크립트는 제대로 칠해진다. 룬(`$state` 등)은 못 알아보지만
 *   **무색보다는 낫다**는 판단.
 */
const HLJS_ALIASES: Record<string, string> = {
  "objective-c": "objectivec",
  svelte: "xml",
};
for (const [alias, languageName] of Object.entries(HLJS_ALIASES)) {
  hljs.registerAliases(alias, { languageName });
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
  // 코드 펜스 하이라이트. info-string 언어가 등록돼 있으면 hljs로 토큰화한 HTML 반환.
  // 토큰 색은 lib/styles/rendered.css의 .rendered .hljs-* → --cm-* 매핑이 담당
  // (에디터와 일치 + 라이트/다크 자동). 이 HTML은 `.rendered` 안에서만 렌더된다.
  highlight(str, lang): string {
    const language = lang ? lang.trim().toLowerCase() : "";
    if (language && hljs.getLanguage(language)) {
      try {
        const out = hljs.highlight(str, {
          language,
          ignoreIllegals: true,
        }).value;
        return `<pre class="hljs"><code class="language-${language}">${out}</code></pre>`;
      } catch {
        /* 하이라이트 실패 시 아래 escape 경로로 폴백 */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
})
  .use(wikilinkPlugin)
  // ⚠️ `embedPlugin` 이 `wikilink` **앞에** 끼어든다(`ruler.before`). 등록 순서가 아니라
  //    그 인자가 순서를 정하므로, 여기 줄 순서를 바꿔도 안전하다.
  .use(embedPlugin)
  .use(mermaidPlugin)
  // ⚠️ `mermaid` 와 같은 자리(fence)를 본다. 둘 다 자기 info-string 만 가로채고
  //    나머지는 앞 렌더러에 넘기므로 순서는 안 따진다.
  .use(lapisQueryPlugin)
  .use(calloutPlugin)
  .use(taskListPlugin)
  .use(headingAnchorPlugin);

export interface ParsedNote {
  data: Record<string, unknown>;
  body: string;
  html: string;
  /** 문서 아웃라인(TOC)용 헤딩 목록. line은 원본 raw 기준 0-based. */
  headings: HeadingInfo[];
}

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

export function parseNote(raw: string): ParsedNote {
  const match = FRONTMATTER_RE.exec(raw);
  // md.render(_, env) — headingAnchorPlugin이 env.headings를 채운다.
  const env: { headings?: HeadingInfo[] } = {};

  if (!match) {
    const html = md.render(raw, env);
    return { data: {}, body: raw, html, headings: env.headings ?? [] };
  }

  const [, fmRaw, body] = match;
  let data: Record<string, unknown> = {};
  try {
    // 스키마를 명시한다 — 기본값이면 `date: 2026-08-20`이 Date 객체가 돼 Properties 패널에
    // `Thu Aug 20 2026 09:00:00 GMT+0900`으로 뜨고, 편집 시 그대로 파일에 되박힌다.
    // 근거는 `frontmatter.ts`의 `FRONTMATTER_YAML_SCHEMA` 주석.
    const parsed = yaml.load(fmRaw, { schema: FRONTMATTER_YAML_SCHEMA });
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>;
    }
  } catch (err) {
    logWarn("markdown", "Frontmatter YAML parse failed:", err);
  }

  const html = md.render(body, env);
  // 헤딩 line은 body 기준 0-based → frontmatter 줄 수만큼 보정해 raw 기준으로.
  // body는 raw의 접미사이므로 (raw 전체 − body) 구간의 개행 수 = frontmatter 줄 수.
  const fmOffset = (
    raw.slice(0, raw.length - body.length).match(/\n/g) ?? []
  ).length;
  const headings = (env.headings ?? []).map((h) => ({
    ...h,
    line: h.line + fmOffset,
  }));

  return { data, body, html, headings };
}
