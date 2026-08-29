import { invoke } from "$lib/tauri/invoke";
import { writeBinaryFile } from "$lib/tauri/notes";
import { logWarn } from "$lib/stores/usage";

/**
 * 밖에서 시킨 렌더를 받아 해낸다 — `lapis_render` 의 프런트 절반.
 *
 * ## ⚠️ 왜 앱이 해야 하나
 *
 * 헤드리스에는 창이 없어 **캔버스가 없다.** mermaid 는 마운트 후 런타임에 `<svg>` 가
 * 되고 PNG 는 그 SVG 를 캔버스에 그려 만든다 — 둘 다 살아 있는 WebView 가 필요하다.
 *
 * ## ⚠️ 결과는 파일로 돌려준다
 *
 * 요청을 보낸 프로세스는 argv 를 넘긴 뒤 즉시 죽는다. 값을 돌려줄 통로가 없으므로 앱이
 * `out` 경로에 쓰고, 부른 쪽이 그 파일을 기다린다. 헤드리스와 같은 모양이다.
 *
 * ## 🔴 실패해도 반드시 무언가를 쓴다
 *
 * 아무것도 안 쓰면 부른 쪽은 **타임아웃으로만** 안다 — "앱이 느린가"와 "렌더가 깨졌나"가
 * 구별이 안 된다. 그래서 실패도 같은 경로에 JSON 한 줄로 쓴다.
 */

export interface PendingRender {
  path: string;
  vault: string;
  out: string;
  format: string;
}

/** 밖에서 온 요청이 있으면 꺼내 온다. 내 vault 것이 아니면 `null`. */
export function takePendingRender(vault: string | null): Promise<PendingRender | null> {
  return invoke<PendingRender | null>("take_pending_render", { vault });
}

/** 실패를 부른 쪽에 알린다. ⚠️ 이것도 실패하면 더는 할 수 있는 게 없다. */
export async function reportRenderFailure(out: string, message: string): Promise<void> {
  try {
    await invoke("write_render_failure", { out, message });
  } catch (e) {
    logWarn("stores/cliRender", "실패 보고조차 못 썼다", e);
  }
}

/**
 * 렌더 결과를 쓴다.
 *
 * ⚠️ 원자적 교체는 Rust 의 `write_binary_file` 이 한다 — 부른 쪽이 **반쯤 쓰인 파일을
 * 보고 성공으로 읽는** 것을 막는다. 기다리는 쪽이 크기만 보고 판단하기 때문이다.
 */
export async function writeRenderResult(out: string, bytes: Uint8Array): Promise<void> {
  await writeBinaryFile(out, bytes);
}

/**
 * 본문에서 PNG 로 만들 mermaid 호스트를 고른다.
 *
 * ⚠️ **첫 번째를 쓴다.** 여럿이면 어느 것인지 물을 방법이 없고(요청은 파일 하나를
 * 지정한다), 조용히 마지막 것을 쓰면 왜 다른 그림이 나오는지 모른다. 몇 개였는지는
 * 부르는 쪽이 알 수 있게 세어 돌려준다.
 */
export function pickMermaidHost(root: ParentNode): { host: HTMLElement | null; total: number } {
  const hosts = [...root.querySelectorAll<HTMLElement>(".mermaid-host")];
  return { host: hosts[0] ?? null, total: hosts.length };
}

/** 다이어그램이 다 그려졌는지 — 셋 중 하나. */
export type MermaidState = "pending" | "done" | "error";

/**
 * 🔴 **`data-rendered` 가 붙었다고 끝난 게 아니다.**
 *
 * `mermaid-runtime.ts` 는 세 값을 쓴다 — `pending`(시작) · `1`(성공) · `error`(문법 오류).
 * `:not([data-rendered])` 로 세면 **`pending` 이 통과한다.** 시작하자마자 "다 됐다"가
 * 되고, 다음 줄이 `<svg>` 를 못 찾아 실패한다. 실측으로 걸렸다: `lapis_render --format png`
 * 가 "다이어그램이 아직 안 그려졌거나 문법이 틀렸다"를 냈는데 **둘 다 아니었다.**
 *
 * ⚠️ `1` 인데 `<svg>` 가 없을 수도 있다 — 테마 전환이 가드를 풀었다 다시 붙이는 사이.
 * 속성이 아니라 **결과물**을 본다.
 *
 * ⚠️ 다이어그램이 없으면 `done` 이다. HTML 렌더는 그게 정상이므로 기다리면 안 된다.
 */
export function mermaidRenderState(root: ParentNode): MermaidState {
  const hosts = [...root.querySelectorAll<HTMLElement>(".mermaid-host")];
  if (hosts.length === 0) return "done";
  let sawError = false;
  for (const h of hosts) {
    if (h.getAttribute("data-rendered") === "error") {
      sawError = true;
      continue;
    }
    // 하나라도 아직이면 아직이다.
    if (!h.querySelector("svg")) return "pending";
  }
  return sawError ? "error" : "done";
}

/**
 * 다 그려질 때까지 기다린다.
 *
 * ⚠️ **문법 오류는 기다리지 않는다.** 영영 안 바뀌므로 끝까지 기다리면 부른 쪽이
 * "느린 건지 틀린 건지"를 못 가른다 — 조치가 다른데.
 *
 * ⚠️ **상한을 둔다.** 없으면 이 함수가 안 끝나 부른 쪽이 타임아웃으로만 안다.
 *
 * ⚠️ 본문을 매번 다시 읽는다(`getRoot`). 노트를 여는 도중이면 그 노드가 통째로 바뀐다 —
 * 한 번 잡아 두면 화면에서 떨어져 나간 옛 노드를 보며 영영 기다린다.
 */
export async function waitForMermaidIn(
  getRoot: () => ParentNode | null,
  timeoutMs = 15_000,
  stepMs = 80,
): Promise<MermaidState> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const root = getRoot();
    if (root) {
      const state = mermaidRenderState(root);
      if (state !== "pending") return state;
    }
    if (Date.now() >= until) return "pending";
    await new Promise((r) => setTimeout(r, stepMs));
  }
}
