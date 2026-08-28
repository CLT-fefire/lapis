import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { alerts, pushAlert, dismissAlert, clearAlerts, hasAlerts, ALERT_MAX } from "./alerts";

/**
 * 사용자가 알아야 하는 실패.
 *
 * ⚠️ v3.2.0 이 96곳을 구조화했지만 그건 **기록**이다. 릴리스에는 devtools 가 없어
 * 사용자는 여전히 아무것도 못 본다. **되돌릴 수 없는 쓰기의 실패**만 여기로 온다.
 */

beforeEach(() => clearAlerts());

describe("올리기", () => {
  it("메시지와 자세한 내용을 담는다", () => {
    pushAlert("k", "인용 갱신 실패", "EACCES /v/a.md");
    const [a] = get(alerts);
    expect(a.message).toBe("인용 갱신 실패");
    expect(a.detail).toContain("EACCES");
    expect(typeof a.at).toBe("number");
  });

  it("최신이 맨 앞", () => {
    pushAlert("a", "먼저");
    pushAlert("b", "나중");
    expect(get(alerts).map((x) => x.message)).toEqual(["나중", "먼저"]);
  });

  /**
   * 🔴 **같은 키는 하나만.** 자동 커밋이 계속 실패하면 같은 줄이 쌓이는데, 그건
   * 정보가 아니라 소음이고 소음이 된 경고는 아무도 안 읽는다.
   */
  it("같은 키를 여러 번 올려도 하나다", () => {
    pushAlert("commit", "커밋 실패");
    pushAlert("commit", "커밋 실패");
    pushAlert("commit", "커밋 실패");
    expect(get(alerts)).toHaveLength(1);
  });

  it("같은 키를 다시 올리면 시각이 갱신되고 앞으로 온다", () => {
    pushAlert("old", "옛것");
    pushAlert("new", "새것");
    pushAlert("old", "옛것 다시");
    expect(get(alerts)[0].message).toBe("옛것 다시");
  });

  /** ⚠️ 상한이 없으면 실패가 연달아 날 때 배너가 화면을 덮는다. */
  it("상한을 넘으면 오래된 것부터 나간다", () => {
    for (let i = 0; i < ALERT_MAX + 3; i++) pushAlert(`k${i}`, `m${i}`);
    expect(get(alerts)).toHaveLength(ALERT_MAX);
    expect(get(alerts)[0].message).toBe(`m${ALERT_MAX + 2}`);
  });
});

describe("내리기", () => {
  it("키로 하나만 지운다", () => {
    pushAlert("a", "A");
    pushAlert("b", "B");
    dismissAlert("a");
    expect(get(alerts).map((x) => x.key)).toEqual(["b"]);
  });

  it("없는 키를 지워도 안 죽는다", () => {
    pushAlert("a", "A");
    dismissAlert("없음");
    expect(get(alerts)).toHaveLength(1);
  });

  it("전부 지운다", () => {
    pushAlert("a", "A");
    clearAlerts();
    expect(get(alerts)).toEqual([]);
  });
});

describe("hasAlerts", () => {
  it("있을 때만 참", () => {
    expect(hasAlerts()).toBe(false);
    pushAlert("a", "A");
    expect(hasAlerts()).toBe(true);
  });
});
