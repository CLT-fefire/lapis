import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * `onVaultChange`가 **자기 창 라벨을 target으로** 구독하는지 고정한다.
 *
 * ⚠️ 이 인자가 빠지면 리스너가 `EventTarget::Any`로 등록되고, Tauri의 매칭이
 * `*target == Any || filter(target)`라(`tauri/src/event/listener.rs`) **필터를
 * 건너뛴다** — Rust가 `emit_to(label)`로 좁혀 보내도 모든 창이 다 받는다.
 * 창마다 다른 vault를 여는 구조에선 남의 vault 변경으로 재인덱싱하게 되고,
 * **에러도 로그도 없이** 성능만 나빠진다. 타입 체크로는 안 잡힌다(선택 인자).
 */

type ListenTarget = { kind: string; label: string };
type ListenHandler = (event: { payload: unknown }) => void;

const listenMock = vi.fn(
  (_event: string, _handler: ListenHandler, _options?: { target?: ListenTarget }) =>
    Promise.resolve(() => {}),
);

vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "w2" }),
}));

beforeEach(() => listenMock.mockClear());

describe("onVaultChange", () => {
  it("자기 창 라벨을 target으로 구독한다 (Any로 등록하면 안 된다)", async () => {
    const { onVaultChange } = await import("./watcher");
    await onVaultChange(() => {});

    expect(listenMock).toHaveBeenCalledTimes(1);
    const [event, , options] = listenMock.mock.calls[0];
    expect(event).toBe("vault:change");
    expect(options?.target).toEqual({ kind: "AnyLabel", label: "w2" });
  });

  it("payload를 그대로 핸들러에 넘긴다", async () => {
    const { onVaultChange } = await import("./watcher");
    const handler = vi.fn();
    await onVaultChange(handler);

    const [, cb] = listenMock.mock.calls[0];
    const change = { kind: "modified", path: "/v/a.md", mtime_ms: 1 };
    cb({ payload: change });
    expect(handler).toHaveBeenCalledWith(change);
  });
});
