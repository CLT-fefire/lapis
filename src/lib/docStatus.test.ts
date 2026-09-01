import { describe, it, expect } from "vitest";
import {
  normStatus,
  statusLifecycle,
  STATUS_GROUPS,
  isStatusGroup,
  expandStatusGroup,
  KNOWN_STATUS_VALUES,
} from "./docStatus";

/**
 * 상태 낱말 규약 — **사람이 선언한 것**을 코드가 한 곳에서만 읽는가.
 *
 * ## 왜 이 테스트가 있나 (2026-08-30 실측)
 *
 * vault 의 `status` 53건이 아홉 갈래였고 그중 **다섯이 "끝났다"** 였다:
 *
 * ```
 * 반영됨 21 · 완료 15 · 진행 중 10 · 미착수 2 · 해결됨 1 · 닫힘 1 · 이전됨 1
 * ```
 *
 * "닫혔다는데 미체크가 남은 노트"를 세려는데 **무엇이 닫힘인지 코드가 정할 수 없었다.**
 * 손으로 적은 첫 목록이 `반영됨` 21건을 통째로 빠뜨렸다 — 분모가 틀렸다.
 *
 * ⚠️ `vaultAudit` 의 *"동의어라고 말하지 않는다 — 기계가 정할 수 없다"* 는 그대로 산다.
 * 여기서 하는 것은 **추론이 아니라 선언**이다. 그래서 표가 코드 안에 있다.
 */

describe("normStatus", () => {
  it("NFC · trim · 소문자로 맞춘다", () => {
    expect(normStatus("  완료  ")).toBe("완료");
    expect(normStatus("DONE")).toBe("done");
  });

  it("공백 런을 하나로 접는다 — 붙여넣기 자국", () => {
    expect(normStatus("진행  중")).toBe("진행 중");
  });

  it("공백을 없애지는 않는다 — `진행중` 은 다른 문자열이다", () => {
    expect(normStatus("진행중")).toBe("진행중");
  });
});

describe("statusLifecycle", () => {
  it("끝났다는 다섯 낱말이 모두 done 으로 접힌다", () => {
    for (const v of ["완료", "반영됨", "해결됨", "닫힘", "이전됨"]) {
      expect(statusLifecycle(v), v).toBe("done");
    }
  });

  it("진행 · 미착수", () => {
    expect(statusLifecycle("진행 중")).toBe("active");
    expect(statusLifecycle("미착수")).toBe("todo");
    expect(statusLifecycle("열림")).toBe("todo");
  });

  it("앞뒤 공백과 대소문자를 견딘다", () => {
    expect(statusLifecycle(" 완료 ")).toBe("done");
  });

  // 🔴 이 셋이 이 파일의 핵심이다 — 추측하기 시작하면 분모가 또 틀린다.
  it("모르는 값은 null 이다 — 추측하지 않는다", () => {
    expect(statusLifecycle("draft")).toBeNull();
    expect(statusLifecycle("보류")).toBeNull();
  });

  it("문장은 값이 아니다 — 접두사로 삼키지 않는다", () => {
    expect(statusLifecycle("완료 — #232")).toBeNull();
    expect(statusLifecycle("8건 전부 완료 (v0.21.0 · PR #3)")).toBeNull();
    expect(statusLifecycle("끝 (PR #2) — 속 계층은 만들었다 걷어냈다")).toBeNull();
  });

  it("붙여 쓴 변종은 모르는 값이다 — 관대하면 감사가 조용해진다", () => {
    expect(statusLifecycle("진행중")).toBeNull();
    expect(statusLifecycle("구현 완료")).toBeNull();
  });

  it("없거나 빈 값도 null", () => {
    expect(statusLifecycle(undefined)).toBeNull();
    expect(statusLifecycle("")).toBeNull();
    expect(statusLifecycle("   ")).toBeNull();
  });
});

describe("그룹 이름", () => {
  it("세 갈래뿐이다", () => {
    expect([...STATUS_GROUPS]).toEqual(["@done", "@active", "@todo"]);
  });

  it("`@` 로 시작하는 것만 그룹이다", () => {
    expect(isStatusGroup("@done")).toBe(true);
    expect(isStatusGroup("완료")).toBe(false);
    expect(isStatusGroup("@nope")).toBe(false);
  });

  it("@done 은 다섯 낱말 전부로 펼쳐진다 — 손으로 적던 그 목록이다", () => {
    expect(expandStatusGroup("@done")!.sort()).toEqual(
      ["닫힘", "반영됨", "완료", "이전됨", "해결됨"].sort(),
    );
  });

  it("@active · @todo", () => {
    expect(expandStatusGroup("@active")).toEqual(["진행 중"]);
    expect(expandStatusGroup("@todo")!.sort()).toEqual(["미착수", "열림"].sort());
  });

  it("모르는 그룹은 빈 배열이 아니라 null — 호출부가 울 수 있게", () => {
    expect(expandStatusGroup("@nope")).toBeNull();
    expect(expandStatusGroup("완료")).toBeNull();
  });
});

describe("KNOWN_STATUS_VALUES", () => {
  it("표에 있는 값이 전부 들어 있고 중복이 없다", () => {
    const v = [...KNOWN_STATUS_VALUES];
    expect(new Set(v).size).toBe(v.length);
    for (const one of v) expect(statusLifecycle(one)).not.toBeNull();
  });

  it("세 그룹의 합집합과 같다", () => {
    const union = STATUS_GROUPS.flatMap((g) => expandStatusGroup(g) ?? []);
    expect(union.sort()).toEqual([...KNOWN_STATUS_VALUES].sort());
  });
});
