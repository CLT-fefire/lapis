import { describe, it, expect } from "vitest";
import { buildIndex } from "./linkIndex";
import { parseNote } from "./markdown";
import { fillEmbeds } from "./embedFill";
import { EMBED_MAX_DEPTH } from "./embed";
import type { LinkInfo } from "$lib/tauri/notes";

/**
 * 임베드 채우기 — **DOM 순회**.
 *
 * 규칙(`embed.test.ts`)과 갈라 둔 이유는 여기가 DOM을 만지기 때문이다. 순수 부분은
 * `node` 에서 보고, 여기서는 **자리표시자가 실제로 채워지는지**만 본다.
 */

const mk = (path: string, targets: string[] = []): LinkInfo => ({
  source_path: path,
  source_name: path.replace(/^.*\//, "").replace(/\.md$/i, ""),
  title: null,
  aliases: [],
  tags: [],
  doc_kind: null,
  topic: null,
  related: [],
  targets,
  props: {},
});

async function render(
  source: string,
  vault: Record<string, string>,
  from = "/v/여기.md",
): Promise<HTMLElement> {
  const infos = Object.keys(vault).map((p) => mk(p));
  if (!vault[from]) infos.push(mk(from));
  const root = document.createElement("div");
  root.innerHTML = parseNote(source).html;
  await fillEmbeds(root, {
    index: buildIndex(infos),
    fromPath: from,
    load: async (p) => {
      const v = vault[p];
      if (v === undefined) throw new Error("없다");
      return v;
    },
  });
  return root;
}

const slot = (r: HTMLElement) => r.querySelector<HTMLElement>(".embed")!;

describe("채운다", () => {
  it("노트 전체를 가져온다", async () => {
    const r = await render("![[대상]]", { "/v/대상.md": "# 제목\n\n본문이다." });
    expect(slot(r).textContent).toContain("본문이다");
    expect(slot(r).querySelector("h1")?.textContent).toBe("제목");
  });

  it("앵커가 있으면 그 절만", async () => {
    const r = await render("![[대상#둘째]]", {
      "/v/대상.md": "# 제목\n첫째 본문\n\n## 둘째\n둘째 본문\n\n## 셋째\n셋째 본문",
    });
    const t = slot(r).textContent ?? "";
    expect(t).toContain("둘째 본문");
    expect(t).not.toContain("첫째 본문");
    expect(t).not.toContain("셋째 본문");
  });

  it("frontmatter 는 딸려오지 않는다", async () => {
    const r = await render("![[대상]]", {
      "/v/대상.md": "---\ntitle: 감춘 것\n---\n\n본문",
    });
    expect(slot(r).textContent).not.toContain("감춘 것");
    expect(slot(r).textContent).toContain("본문");
  });

  it("한 문서가 같은 노트를 두 번 임베드해도 둘 다 채운다", async () => {
    const r = await render("![[대상]]\n\n![[대상]]", { "/v/대상.md": "본문" });
    const slots = r.querySelectorAll(".embed");
    expect(slots).toHaveLength(2);
    for (const s of slots) expect(s.textContent).toContain("본문");
  });

  it("임베드 안의 임베드도 채운다", async () => {
    const r = await render("![[가운데]]", {
      "/v/가운데.md": "가운데 본문\n\n![[안쪽]]",
      "/v/안쪽.md": "안쪽 본문",
    });
    expect(slot(r).textContent).toContain("가운데 본문");
    expect(slot(r).textContent).toContain("안쪽 본문");
  });
});

describe("⚠️ 실패는 자리에 남는다", () => {
  /** 빈 자리로 두면 원래 거기 뭐가 있었는지 알 길이 없다. */
  it("없는 노트", async () => {
    const r = await render("![[없는것]]", {});
    expect(slot(r).className).toContain("embed-failed");
    expect(slot(r).textContent).toContain("없는것");
  });

  it("없는 헤딩", async () => {
    const r = await render("![[대상#없는헤딩]]", { "/v/대상.md": "# 제목\n본문" });
    expect(slot(r).className).toContain("embed-failed");
    expect(slot(r).textContent).toContain("없는헤딩");
  });

  it("읽기가 실패해도 자리에 남는다", async () => {
    const root = document.createElement("div");
    root.innerHTML = parseNote("![[대상]]").html;
    await fillEmbeds(root, {
      index: buildIndex([mk("/v/대상.md"), mk("/v/여기.md")]),
      fromPath: "/v/여기.md",
      load: async () => {
        throw new Error("IO");
      },
    });
    expect(slot(root).className).toContain("embed-failed");
  });

  /**
   * ⚠️ **순환.** 이게 없으면 A→B→A 가 브라우저를 멈춘다. 테스트가 끝나는 것 자체가
   * 단언의 일부다.
   */
  it("순환을 끊는다", async () => {
    const r = await render("![[가]]", {
      "/v/가.md": "가 본문\n\n![[나]]",
      "/v/나.md": "나 본문\n\n![[가]]",
    });
    expect(r.textContent).toContain("가 본문");
    expect(r.textContent).toContain("나 본문");
    expect(r.querySelector(".embed-failed")?.textContent).toContain("돌아온다");
  });

  /** 순환이 아니어도 길면 멈춘다 — 문서 하나에 수십 개를 읽지 않는다. */
  it("깊이 상한을 넘으면 멈춘다", async () => {
    const vault: Record<string, string> = {};
    const n = EMBED_MAX_DEPTH + 2;
    for (let i = 0; i < n; i++) {
      vault[`/v/n${i}.md`] = `${i}번 본문\n\n![[n${i + 1}]]`;
    }
    vault[`/v/n${n}.md`] = "끝";
    const r = await render("![[n0]]", vault);
    expect(r.textContent).toContain("0번 본문");
    expect(r.querySelector(".embed-failed")?.textContent).toContain("겹을 넘었다");
    // 상한 밖은 안 읽었다
    expect(r.textContent).not.toContain("끝");
  });
});

describe("⚠️ 어디서 당겨왔는지 보인다", () => {
  /**
   * 테두리는 "남의 글"만 말한다. 읽다가 **"이거 어디 거지"** 에 답이 없으면 임베드는
   * 출처 없는 인용이 된다.
   */
  it("원본 표시가 조각보다 **먼저** 온다", async () => {
    const r = await render("![[대상]]", { "/v/대상.md": "본문" });
    const src = slot(r).querySelector(".embed-source");
    expect(src?.textContent).toContain("대상");
    // 다 읽고 나서 출처를 아는 것은 늦다.
    expect(slot(r).firstElementChild).toBe(src);
  });

  it("앵커까지 보여준다", async () => {
    const r = await render("![[대상#둘째]]", {
      "/v/대상.md": "# 제목\n\n## 둘째\n둘째 본문",
    });
    expect(slot(r).querySelector(".embed-source")?.textContent).toBe("대상#둘째");
  });

  /** 위키링크와 **같은 클래스**를 쓴다 — 클릭 경로를 하나 더 만들지 않는다. */
  it("위키링크로 만들어 기존 클릭 처리를 탄다", async () => {
    const r = await render("![[대상]]", { "/v/대상.md": "본문" });
    const link = slot(r).querySelector(".embed-source .wikilink");
    expect(link?.getAttribute("data-target")).toBe("대상");
    expect(link?.getAttribute("role")).toBe("link");
  });

  /** 실패한 자리에는 안 붙인다 — 갈 곳이 없는데 링크를 주면 안 된다. */
  it("실패한 임베드에는 원본 표시가 없다", async () => {
    const r = await render("![[없는것]]", {});
    expect(slot(r).querySelector(".embed-source")).toBeNull();
  });
});
