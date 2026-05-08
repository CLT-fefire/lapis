import MarkdownIt from "markdown-it";
import yaml from "js-yaml";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  typographer: true,
});

export interface ParsedNote {
  data: Record<string, unknown>;
  body: string;
  html: string;
}

const FRONTMATTER_RE = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/;

export function parseNote(raw: string): ParsedNote {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      data: {},
      body: raw,
      html: md.render(raw),
    };
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

  return {
    data,
    body,
    html: md.render(body),
  };
}
