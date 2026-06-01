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
import { wikilinkPlugin } from "$lib/markdownPlugins/wikilink";
import { mermaidPlugin } from "$lib/markdownPlugins/mermaid";
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
};
for (const [name, lang] of Object.entries(HLJS_LANGUAGES)) {
  hljs.registerLanguage(name, lang as never);
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
  // 코드 펜스 하이라이트. info-string 언어가 등록돼 있으면 hljs로 토큰화한 HTML 반환.
  // 토큰 색은 app.css의 .hljs-* → --cm-* 토큰 매핑이 담당(에디터와 일치 + 라이트/다크 자동).
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
  .use(mermaidPlugin)
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
    const parsed = yaml.load(fmRaw);
    if (parsed && typeof parsed === "object") {
      data = parsed as Record<string, unknown>;
    }
  } catch (err) {
    console.warn("Frontmatter YAML parse failed:", err);
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
