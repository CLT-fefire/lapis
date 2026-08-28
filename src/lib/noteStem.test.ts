import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { noteStem, noteDisplayName } from "./notePath";

/**
 * 노트 이름에서 **확장자를 벗기는 규칙**.
 *
 * ## ⚠️ 앱이 다루는 확장자는 둘이다
 *
 * `vault.rs` 가 `.md` 와 **`.mmd`** 를 지원 확장자로 강제한다(`ensure_supported_extension`).
 * 이름 변경도 `.mmd` 를 보존한다 — `diagram.mmd` → `flowchart` 는 `flowchart.mmd` 가 된다.
 *
 * 그런데 확장자를 벗기는 코드가 **세 가지 규칙으로 갈려** 있었다:
 *
 * | 자리 | 패턴 |
 * |---|---|
 * | `previewExportDoc.ts` | `.md` · `.mmd` · `.markdown` |
 * | `relations.ts` | `.md` · `.mmd` |
 * | `notePath.ts` · `stores/vault.ts` · `VaultHygieneModal` · `NewNoteModal` | **`.md` 만** |
 *
 * ## 🔴 그래서 생긴 것 — `.mmd` 이름을 바꾸면 링크가 조용히 끊긴다
 *
 * `stores/vault.ts` 의 `renamePath` 가 `stemOfPath` 로 옛/새 stem 을 뽑아
 * `rewriteAllLinksWithPreview(vault, oldStem, newStem)` 을 부른다. `.mmd` 가 안 벗겨지면
 * `oldStem` 이 `"diagram.mmd"` 인데, 본문의 위키링크는 `[[diagram]]` 이다.
 *
 * → 매칭 **0건** → `preview.items.length === 0` → 모달도 안 뜨고 **조용히 종료**.
 * 이름은 바뀌고 링크는 옛 이름을 가리킨 채 남는다. 에러가 없다.
 */

describe("noteStem", () => {
  it("`.md` 를 벗긴다", () => {
    expect(noteStem("/v/journal/daily.md")).toBe("daily");
  });

  /** 🔴 이게 이 테스트의 이유다. */
  it("`.mmd` 도 벗긴다 — 앱이 지원하는 확장자다", () => {
    expect(noteStem("/v/diagrams/flow.mmd")).toBe("flow");
  });

  it("대소문자를 안 가린다", () => {
    expect(noteStem("/v/A.MD")).toBe("A");
    expect(noteStem("/v/B.MMD")).toBe("B");
  });

  /**
   * ⚠️ `.md` 규칙이 `.mmd` 를 **부분적으로** 먹지 않아야 한다. `/\.md$/` 는
   * `flow.mmd` 에 안 맞지만, 규칙을 `/\.m?md$/` 처럼 느슨하게 쓰면 `.amd` 같은 것까지
   * 벗긴다. 지원 확장자 둘만 정확히 본다.
   */
  it("지원하지 않는 확장자는 안 벗긴다", () => {
    expect(noteStem("/v/data.json")).toBe("data.json");
    expect(noteStem("/v/notes.markdown")).toBe("notes.markdown");
  });

  it("확장자가 없으면 그대로", () => {
    expect(noteStem("/v/README")).toBe("README");
  });

  it("이름에 점이 여럿이어도 마지막 확장자만", () => {
    expect(noteStem("/v/2026.08.28.md")).toBe("2026.08.28");
  });
});

describe("noteDisplayName", () => {
  it("마지막 두 조각을 잇는다", () => {
    expect(noteDisplayName("/v/journal/daily.md")).toBe("journal / daily.md");
  });

  it("조각이 하나뿐이면 그것만", () => {
    expect(noteDisplayName("daily.md")).toBe("daily.md");
  });

  it("빈 조각을 안 센다", () => {
    expect(noteDisplayName("/v//journal//daily.md")).toBe("journal / daily.md");
  });
});

/**
 * ⚠️ **규칙이 다시 갈리지 않게.** 확장자를 벗기는 자리가 여섯이었고 규칙이 셋이었다.
 * 새로 벗기는 코드를 쓰면 여기가 운다 — `notePath.ts` 의 `noteStem` 을 쓰라는 뜻이다.
 */
describe("확장자 벗기기가 한 곳에서만 정의된다", () => {
  const SRC = fileURLToPath(new URL("./", import.meta.url));

  function tsAndSvelte(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "paraglide") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) tsAndSvelte(p, out);
      else if (/\.(ts|svelte)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
    }
    return out;
  }

  it("`.md` 만 벗기는 정규식이 남아 있지 않다", () => {
    const offenders: string[] = [];
    for (const f of tsAndSvelte(SRC)) {
      const body = readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "");
      // `.md` 만 보는 패턴 — `.mmd` 를 같이 보면 통과한다.
      if (/\/\\\.md\$\/i?/.test(body) && !/mmd/.test(body)) {
        offenders.push(f.replace(SRC, ""));
      }
    }
    expect(
      offenders,
      `\`.md\` 만 벗긴다 — \`.mmd\` 노트에서 확장자가 남는다:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
