import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * 🔴 **차가운 기동에서 렌더 요청이 조용히 사라졌다.**
 *
 * ## 무슨 일이 있었나
 *
 * `lapis_render` 는 앱이 **꺼져 있을 때도** 되어야 한다 — 그때 앱이 새로 뜨고, Rust 가
 * argv 를 읽어 요청을 담고(`clirender::stage`), 프런트가 그걸 꺼내 그린다.
 *
 * 그런데 `take_pending_render(vault)` 는 **vault 가 맞을 때만** 내준다(창이 여럿일 때
 * 엉뚱한 창이 가져가지 않도록). 기동 직후 한 번만 묻고 마는 구조였는데, 그 시점엔
 * `$vaultPath` 가 아직 `null` 이다. 그래서:
 *
 * 1. Rust 는 담는다 — 로그에 `담음:` 이 찍힌다
 * 2. 프런트가 `null` 로 묻는다 → vault 불일치 → `None`
 * 3. `cli:render` 이벤트는 **구독보다 먼저** 나갔다 → 다시 물을 계기가 없다
 * 4. 요청은 슬롯에 남은 채 영원히 기다린다
 *
 * 부른 쪽은 **타임아웃으로만** 안다. 실패 파일조차 안 생긴다 — 실패한 적이 없으니까.
 * 실측: `--render` 로 앱을 직접 띄웠을 때 Rust 로그에 `담음:` 은 찍히고 `가져감:` 은
 * 안 찍혔다. 결과 파일도 실패 파일도 없었다.
 *
 * ## 고침
 *
 * vault 가 열린 **뒤에** 다시 묻는다. 슬롯은 불일치일 때 비워지지 않으므로(`take` 는
 * 일치할 때만 부른다) 늦게 물어도 요청은 살아 있다.
 */

const page = readFileSync(
  fileURLToPath(new URL("../../routes/+page.svelte", import.meta.url)),
  "utf-8",
);

describe("차가운 기동", () => {
  /**
   * 🔴 vault 가 열린 뒤 다시 물어야 한다.
   *
   * ⚠️ `$vaultPath` 를 **읽는** 자리여야 한다. `onMount` 안의 한 번짜리 호출은 그때의
   * `null` 을 그대로 쓰고 끝난다.
   */
  it("vault 가 열리면 다시 묻는다", () => {
    const at = page.indexOf("cli-render] 차가운 기동");
    expect(at, "차가운 기동 재확인이 없다").toBeGreaterThan(-1);
    // 그 자리가 `$vaultPath` 에 반응해야 한다.
    const around = page.slice(Math.max(0, at - 600), at + 600);
    expect(around).toMatch(/\$effect\(/);
    expect(around).toMatch(/\$vaultPath/);
  });

  /**
   * ⚠️ **같은 요청을 두 번 그리지 않는다.** 효과는 관계없는 상태가 바뀌어도 다시 돈다.
   * Rust 슬롯이 원자적이라 두 번째는 `null` 을 받지만, 그 사이에 새 요청이 담기면
   * 사람이 안 시킨 렌더가 한 번 더 돈다.
   */
  it("이미 확인한 vault 는 다시 안 묻는다", () => {
    expect(page).toMatch(/coldRenderChecked/);
  });

  /** ⚠️ 이벤트 구독은 그대로 있어야 한다 — 앱이 떠 있을 때는 그쪽이 유일한 계기다. */
  it("이벤트 구독을 없애지 않았다", () => {
    expect(page).toMatch(/onCliRender\(\(\) => handleRenderRequest\(\)\)/);
  });
});

/**
 * ⚠️ Rust 쪽 계약 — 불일치면 **비우지 않는다.**
 *
 * 이게 깨지면 위 고침이 무의미해진다: 첫 물음이 슬롯을 비워버려 나중에 물어도 없다.
 */
describe("슬롯은 불일치에 안 비워진다", () => {
  const rs = readFileSync(
    fileURLToPath(new URL("../../../src-tauri/src/clirender.rs", import.meta.url)),
    "utf-8",
  );

  it("일치할 때만 take 한다", () => {
    const at = rs.indexOf("if !matches {");
    expect(at).toBeGreaterThan(-1);
    // 불일치 분기 **안**만 본다 — 뒤의 정상 경로까지 보면 늘 빨개진다.
    const branch = rs.slice(at, rs.indexOf("}", at));
    expect(branch).toMatch(/return None;/);
    expect(branch, "불일치인데 슬롯을 비운다").not.toMatch(/\.take\(\)/);
  });
});
