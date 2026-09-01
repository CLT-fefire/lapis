import { describe, it, expect } from "vitest";
import { checkCacheVersion } from "./indexRun.ts";
import { IndexError } from "./indexRun.ts";
import { CACHE_VERSION } from "../core/cache.ts";

/**
 * `lapis index`는 **설치된 앱 실행파일**을 시켜 캐시를 쓴다. 그 앱이 이 CLI와 다른
 * `CACHE_VERSION`을 쓰면 무슨 일이 벌어지나.
 *
 * ## ⚠️ 실측으로 걸린 자리
 *
 * 설치돼 있던 앱이 v1.19.0(CACHE_VERSION 8)이었다. `lapis index`는 **v8 캐시를 커밋**하고
 * 이렇게 출력했다:
 *
 * ```
 * 커밋했다. 앱을 켜면 이 인덱스를 그대로 읽는다(재색인 없음).
 * ```
 *
 * 그런데 같은 CLI의 `doctor`·`backlinks`는 그 캐시를 `version_skew`로 **거부한다.**
 * 즉 방금 만든 것을 방금 만든 도구가 못 읽는다. 그러고도 성공이라고 말했다.
 *
 * 구버전 앱이 **인자를 무시하는** 경우는 이미 막혀 있었다(`cache-info` 능력 확인).
 * 막히지 않은 것은 **인자는 받는데 다른 버전을 쓰는** 경우다.
 */

describe("캐시 버전 확인", () => {
  it("같으면 아무 말도 없다", () => {
    expect(checkCacheVersion(CACHE_VERSION, "/x/lapis.exe")).toBeNull();
  });

  /**
   * ⚠️ 커밋 **전에** 멈춰야 한다. 이 명령의 약속이 "앱을 켜면 재색인 없음"인데
   * 그게 성립 못 하면 줄 게 없다 — 쓰고 나서 경고하면 낡은 캐시만 남는다.
   */
  it("앱이 낡았으면 거절한다", () => {
    expect(() => checkCacheVersion(CACHE_VERSION - 1, "/x/lapis.exe")).toThrow(IndexError);
  });

  /** 반대 방향도 막는다 — 오래된 체크아웃에서 CLI를 돌리는 경우다. */
  it("앱이 더 새로워도 거절한다", () => {
    expect(() => checkCacheVersion(CACHE_VERSION + 1, "/x/lapis.exe")).toThrow(IndexError);
  });

  it("메시지가 두 버전과 실행파일을 다 말한다", () => {
    try {
      checkCacheVersion(8, "/x/lapis.exe");
      expect.unreachable("throw 했어야 한다");
    } catch (e) {
      const err = e as IndexError;
      expect(err.message).toContain("8");
      expect(err.message).toContain(String(CACHE_VERSION));
      expect(err.message).toContain("/x/lapis.exe");
      expect(err.remedy).toBeTruthy();
    }
  });

  /** 숫자가 아니면(옛 앱이 필드를 안 줌) 판단할 수 없다 — 조용히 통과시키지 않는다. */
  it("버전을 모르면 거절한다", () => {
    expect(() => checkCacheVersion(Number.NaN, "/x/lapis.exe")).toThrow(IndexError);
  });

  /**
   * ⚠️ **막되 막다른 길로 만들지 않는다** — `--allow-stale`과 같은 태도다. 그 캐시가
   * 쓸모없는 것은 아니다: 그걸 쓴 구버전 앱은 잘 읽는다. 못 읽는 것은 CLI와 MCP다.
   */
  it("--allow-version-skew 면 경고만 하고 통과한다", () => {
    const warn = checkCacheVersion(CACHE_VERSION - 1, "/x/lapis.exe", true);
    expect(warn).toBeTruthy();
    expect(warn).toContain("못 읽는다");
  });

  it("버전이 같으면 --allow-version-skew 여도 조용하다", () => {
    expect(checkCacheVersion(CACHE_VERSION, "/x/lapis.exe", true)).toBeNull();
  });
});
