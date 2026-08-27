import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runExport, ExportError } from "./exportRun.ts";
import { buildIndex } from "$lib/linkIndex";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * `lapis export` — **자립**이 이 명령의 전부다.
 *
 * ⚠️ 외부 참조가 하나라도 남으면 다른 기기에서 열었을 때 **스타일 없는 문서**가 된다.
 * 열리기는 열려서 사용자는 자기가 뭘 잘못한 줄 안다.
 */

const REPO = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

function tmpNote(body: string, name = "note.md"): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lapis-export-"));
  const p = path.join(dir, name);
  writeFileSync(p, body, "utf8");
  return p;
}

describe("자립", () => {
  const html = runExport({
    notePath: tmpNote("# 제목\n\n> [!WARNING]\n> 조심\n\n| a | b |\n|---|---|\n| 1 | 2 |\n"),
    repoRoot: REPO,
  }).html;

  it("외부 참조가 없다", () => {
    expect(html).not.toMatch(/<link[^>]+href=/i);
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it("토큰 값이 박혀 있다", () => {
    expect(html).toMatch(/--text-primary:/);
    expect(html).toMatch(/--surface-base:/);
  });

  /** ⚠️ 토큰 블록의 `var()`가 자기 안에서 다 풀려야 한다. 하나라도 밖을 가리키면 회색이 된다. */
  it("미선언 var() 참조가 남지 않는다", () => {
    const m = /^:root \{(.*?)^\}/ms.exec(html);
    expect(m, ":root 블록이 없다").not.toBeNull();
    const body = m![1];
    const declared = new Set([...body.matchAll(/(--[\w-]+):/g)].map((x) => x[1]));
    const refs = new Set([...body.matchAll(/var\((--[\w-]+)/g)].map((x) => x[1]));
    const missing = [...refs].filter((r) => !declared.has(r));
    expect(missing, `선언되지 않은 참조: ${missing.join(", ")}`).toEqual([]);
  });

  it("콜아웃과 표가 살아 있다", () => {
    expect(html).toContain("callout callout-warning");
    expect(html).toContain("<table>");
  });

  /**
   * ⚠️ **Windows 네이티브 경로가 들어와도** 파일 이름만 남아야 한다. `$lib` 쪽은
   * `/` 구분자를 전제하는데(`to_ui` 계약) CLI는 그 파이프라인 밖이다. 처음엔
   * `<title>C:\\Users\\…\\note</title>` 가 나왔다 — 문서는 멀쩡하고 탭 이름만 이상했다.
   */
  it("제목이 파일 이름에서 온다", () => {
    expect(html).toContain("<title>note</title>");
  });
});

describe("이미지", () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  it("로컬 이미지를 data URI 로 넣는다", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lapis-img-"));
    mkdirSync(path.join(dir, "assets"));
    writeFileSync(path.join(dir, "assets", "dot.png"), Buffer.from(png, "base64"));
    const note = path.join(dir, "n.md");
    writeFileSync(note, "![점](assets/dot.png)", "utf8");
    const r = runExport({ notePath: note, repoRoot: REPO });
    expect(r.images).toEqual({ inlined: 1, failed: 0 });
    expect(r.html).toContain("data:image/png;base64,");
  });

  /** ⚠️ 못 넣은 것을 **세어서** 돌려준다. 조용히 두면 "자립"이 거짓이 된다. */
  it("없는 이미지는 실패로 센다", () => {
    const r = runExport({ notePath: tmpNote("![x](없는파일.png)"), repoRoot: REPO });
    expect(r.images.failed).toBe(1);
    expect(r.images.inlined).toBe(0);
  });

  /** 원격은 건드리지 않는다 — 받아오려다 실패하면 이미지가 통째로 사라진다. */
  it("http 이미지는 그대로 둔다", () => {
    const r = runExport({
      notePath: tmpNote("![x](https://example.com/a.png)"),
      repoRoot: REPO,
    });
    expect(r.images).toEqual({ inlined: 0, failed: 0 });
    expect(r.html).toContain("https://example.com/a.png");
  });
});

describe("소리내어 실패한다", () => {
  it("노트를 못 읽으면 던진다", () => {
    expect(() => runExport({ notePath: "/없는/노트.md", repoRoot: REPO })).toThrow(ExportError);
  });

  /**
   * ⚠️ 스타일시트를 못 읽었을 때 **조용히 넘어가면 스타일 없는 HTML이 나간다.**
   * 열리기는 열려서 사용자는 자기가 뭘 잘못한 줄 안다.
   */
  it("스타일시트를 못 읽으면 던진다", () => {
    expect(() =>
      runExport({ notePath: tmpNote("# x"), repoRoot: os.tmpdir() }),
    ).toThrow(ExportError);
  });
});

describe("색 테마", () => {
  it("고른 테마가 토큰에 반영된다", () => {
    const note = tmpNote("# x");
    const base = runExport({ notePath: note, repoRoot: REPO }).html;
    const tinted = runExport({ notePath: note, repoRoot: REPO, colorTheme: "crimson" }).html;
    expect(tinted).not.toBe(base);
    expect(tinted).toContain("--accent: #ed4245");
  });

  it("모르는 테마 id 는 기본과 같다", () => {
    const note = tmpNote("# x");
    const base = runExport({ notePath: note, repoRoot: REPO }).html;
    expect(runExport({ notePath: note, repoRoot: REPO, colorTheme: "없는테마" }).html).toBe(base);
  });
});

describe("임베드 — 앱과 같은 규칙", () => {
  const info = (p: string): LinkInfo => ({
    source_path: p,
    source_name: p.split("/").pop()!.replace(/\.md$/i, ""),
    title: null,
    aliases: [],
    tags: [],
    doc_kind: null,
    topic: null,
    related: [],
    targets: [],
    props: {},
  });

  /** 실제 파일을 만든다 — CLI 쪽은 디스크에서 읽으므로 가짜 로더가 없다. */
  function vault(files: Record<string, string>): { dir: string; index: ReturnType<typeof buildIndex> } {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lapis-embed-"));
    const infos: LinkInfo[] = [];
    for (const [name, body] of Object.entries(files)) {
      const abs = path.join(dir, name).split(path.sep).join("/");
      writeFileSync(abs, body, "utf8");
      infos.push(info(abs));
    }
    return { dir, index: buildIndex(infos) };
  }

  it("임베드를 채운다", () => {
    const v = vault({ "main.md": "![[bit]]", "bit.md": "당겨온 본문" });
    const r = runExport({
      notePath: path.join(v.dir, "main.md").split(path.sep).join("/"),
      repoRoot: REPO,
      index: v.index,
    });
    expect(r.html).toContain("당겨온 본문");
    expect(r.html).not.toContain("![[bit]]");
  });

  it("앵커가 있으면 그 절만", () => {
    const v = vault({
      "main.md": "![[bit#둘째]]",
      "bit.md": "# 제목\n첫째\n\n## 둘째\n둘째 본문",
    });
    const r = runExport({
      notePath: path.join(v.dir, "main.md").split(path.sep).join("/"),
      repoRoot: REPO,
      index: v.index,
    });
    expect(r.html).toContain("둘째 본문");
    expect(r.html).not.toContain("첫째");
  });

  /** ⚠️ 앱과 **같은 문구**여야 한다. 갈리면 같은 문서가 두 곳에서 다르게 읽힌다. */
  it("없는 노트는 자리에 이름을 남긴다", () => {
    const v = vault({ "main.md": "![[없는것]]" });
    const r = runExport({
      notePath: path.join(v.dir, "main.md").split(path.sep).join("/"),
      repoRoot: REPO,
      index: v.index,
    });
    expect(r.html).toContain("embed-failed");
    expect(r.html).toContain("없는것");
  });

  /** ⚠️ 이게 없으면 내보내기가 **끝나지 않는다.** 테스트가 끝나는 것 자체가 단언이다. */
  it("순환을 끊는다", () => {
    const v = vault({ "main.md": "![[a]]", "a.md": "A\n\n![[b]]", "b.md": "B\n\n![[a]]" });
    const r = runExport({
      notePath: path.join(v.dir, "main.md").split(path.sep).join("/"),
      repoRoot: REPO,
      index: v.index,
    });
    expect(r.html).toContain("돌아온다");
  });

  /** 인덱스를 안 주면 원문이 남는다 — 빈 자리보다 낫다. */
  it("인덱스가 없으면 자리표시자 원문이 남는다", () => {
    const v = vault({ "main.md": "![[bit]]", "bit.md": "x" });
    const r = runExport({
      notePath: path.join(v.dir, "main.md").split(path.sep).join("/"),
      repoRoot: REPO,
    });
    expect(r.html).toContain("![[bit]]");
  });
});
