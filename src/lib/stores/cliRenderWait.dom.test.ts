import { describe, it, expect, beforeEach } from "vitest";
import { waitForMermaidIn, mermaidRenderState } from "./cliRender";

/**
 * 🔴 **`data-rendered` 는 "끝났다"가 아니다.**
 *
 * ## 실측한 실패
 *
 * `mermaid-runtime.ts` 의 `renderHost` 는 세 값을 쓴다:
 *
 * | 값 | 뜻 |
 * |---|---|
 * | `pending` | 그리기 **시작**. mermaid 모듈을 불러오는 중 |
 * | `1` | 성공. 안에 `<svg>` 가 있다 |
 * | `error` | 문법 오류. 안에 `.mermaid-error` 가 있다 |
 *
 * 기다리는 쪽이 `:not([data-rendered])` 로 셌다 — 그러면 **`pending` 도 통과한다.**
 * 시작하자마자 "다 그려졌다"가 되고, 그 다음 줄이 `<svg>` 를 찾다 못 찾아 `null` 을 낸다.
 *
 * 그 결과가 `lapis_render --format png` 의 실패 메시지였다:
 * `다이어그램이 아직 안 그려졌거나 문법이 틀렸다` — **둘 다 아니었다.** 그냥 덜 기다린 것이다.
 * 원인에서 한참 떨어진 신호이고, 이 저장소가 가장 싫어하는 부류다.
 *
 * ## 그래서 상태를 셋으로 읽는다
 *
 * "안 끝났다"와 "문법이 틀렸다"와 "됐다"는 부른 쪽의 조치가 다르다. 하나로 뭉치면
 * 타임아웃을 늘려야 할 사람이 다이어그램 문법을 들여다본다.
 */

function host(attrs: string, inner = ""): HTMLElement {
  const el = document.createElement("div");
  el.className = "mermaid-host";
  el.innerHTML = inner;
  for (const pair of attrs.split(" ").filter(Boolean)) {
    const [k, v] = pair.split("=");
    el.setAttribute(k, v ?? "");
  }
  return el;
}

let root: HTMLElement;
beforeEach(() => {
  root = document.createElement("div");
  document.body.replaceChildren(root);
});

describe("mermaidRenderState", () => {
  it("속성이 없으면 아직 시작도 안 했다", () => {
    root.append(host(""));
    expect(mermaidRenderState(root)).toBe("pending");
  });

  /** 🔴 여기가 무너졌던 자리다. */
  it("pending 은 끝난 게 아니다", () => {
    root.append(host("data-rendered=pending"));
    expect(mermaidRenderState(root)).toBe("pending");
  });

  it("svg 가 있으면 됐다", () => {
    root.append(host("data-rendered=1", "<svg></svg>"));
    expect(mermaidRenderState(root)).toBe("done");
  });

  /**
   * ⚠️ `data-rendered="1"` 인데 `<svg>` 가 없을 수 있다 — 테마 전환이 가드를 풀었다가
   * 다시 붙이는 사이. 속성만 믿으면 그 틈에 빈 것을 내보낸다.
   */
  it("1 이어도 svg 가 없으면 아직이다", () => {
    root.append(host("data-rendered=1"));
    expect(mermaidRenderState(root)).toBe("pending");
  });

  it("error 는 기다려도 안 바뀐다", () => {
    root.append(host("data-rendered=error", '<pre class="mermaid-error">틀렸다</pre>'));
    expect(mermaidRenderState(root)).toBe("error");
  });

  /** ⚠️ 하나라도 안 끝났으면 안 끝난 것이다. */
  it("여럿이면 가장 덜 된 것을 따른다", () => {
    root.append(host("data-rendered=1", "<svg></svg>"), host("data-rendered=pending"));
    expect(mermaidRenderState(root)).toBe("pending");
  });

  /** 다이어그램이 없으면 기다릴 것도 없다 — HTML 렌더는 이 경우가 정상이다. */
  it("없으면 done", () => {
    expect(mermaidRenderState(root)).toBe("done");
  });
});

describe("waitForMermaidIn", () => {
  it("이미 다 됐으면 바로 done", async () => {
    root.append(host("data-rendered=1", "<svg></svg>"));
    expect(await waitForMermaidIn(() => root, 200)).toBe("done");
  });

  /** 🔴 **문법 오류를 기다리지 않는다.** 영영 안 바뀌므로 즉시 알려야 한다. */
  it("error 면 기다리지 않는다", async () => {
    root.append(host("data-rendered=error", '<pre class="mermaid-error">x</pre>'));
    const t0 = performance.now();
    expect(await waitForMermaidIn(() => root, 2_000)).toBe("error");
    expect(performance.now() - t0, "문법 오류인데 끝까지 기다렸다").toBeLessThan(500);
  });

  /** ⚠️ 상한이 있어야 한다 — 없으면 부른 쪽이 타임아웃으로만 안다. */
  it("상한을 넘기면 pending 으로 끝낸다", async () => {
    root.append(host("data-rendered=pending"));
    expect(await waitForMermaidIn(() => root, 150)).toBe("pending");
  });

  /** 늦게 끝나도 잡는다. */
  it("도중에 끝나면 done", async () => {
    const h = host("data-rendered=pending");
    root.append(h);
    setTimeout(() => {
      h.innerHTML = "<svg></svg>";
      h.setAttribute("data-rendered", "1");
    }, 120);
    expect(await waitForMermaidIn(() => root, 3_000)).toBe("done");
  });

  /** ⚠️ 본문이 아직 없으면(`null`) 기다린다 — 없는 것을 done 으로 읽으면 빈 파일이 나간다. */
  it("본문이 없으면 done 이 아니다", async () => {
    expect(await waitForMermaidIn(() => null, 150)).toBe("pending");
  });
});
