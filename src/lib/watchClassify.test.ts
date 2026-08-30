import { describe, it, expect } from "vitest";
import { classifyChange } from "./watchClassify";

/**
 * 워처 이벤트가 **노트인가, 디렉터리인가.**
 *
 * ## 🔴 왜 (2026-08-30 실사용 로그 · 43회)
 *
 * `lapis usage` 에 `[reindex] scan/update 실패` 가 **43회** 쌓여 있었다. 경로가 전부
 * **디렉터리**였다:
 *
 * ```
 * 13  …/knowledge/blog/plans
 *  6  …/knowledge/vibecoding/reference
 *  5  …/knowledge/blog/verify
 *  … 12개 디렉터리에 흩어져 43회
 * ```
 *
 * Rust 쪽은 **일부러** 디렉터리 이벤트를 통과시킨다(`watcher.rs`: *"디렉토리 자체 이벤트는
 * 통과 (rename 등 인지 위해)"*). 그런데 프런트는 그걸 **노트로 취급**했다 —
 * `scanLinkSingle(디렉터리)` 가 실패하고, `touchMtime(디렉터리)` 가 시간축 지도를 더럽히고,
 * `markChangedFromWatcher(디렉터리)` 가 있지도 않은 노트를 "밖에서 바뀜"으로 표시했다.
 *
 * ⚠️ **경계에서 계약이 어긋났다.** 생산자는 "경로가 바뀌었다(디렉터리일 수 있다)"고 말하는데
 * 소비자는 "노트가 바뀌었다"로 들었다.
 *
 * ⚠️ 조용하다. 실패해도 루프가 계속 돌아 **다른 노트는 정상 반영된다.** 그래서 경고 43개가
 * 쌓이는 동안 아무도 몰랐고, 그 경고는 `lapis usage` 사람용 화면이 "경고 50" 이라는
 * 맨숫자로만 내고 있었다(같은 라운드의 다른 카드).
 */
describe("classifyChange", () => {
  it("노트 파일은 노트다", () => {
    expect(classifyChange({ kind: "created", path: "/v/a.md" })).toBe("note");
    expect(classifyChange({ kind: "modified", path: "/v/a.mmd", mtime_ms: 1 })).toBe("note");
    expect(classifyChange({ kind: "removed", path: "/v/a.md" })).toBe("note");
    expect(classifyChange({ kind: "renamed", from: "/v/a.md", to: "/v/b.md" })).toBe("note");
  });

  /**
   * 🔴 43회의 정체. 디렉터리 mtime 은 **안의 파일이 바뀔 때마다** 바뀐다 —
   * 그 파일 이벤트가 따로 오므로 디렉터리 쪽은 볼 것이 없다.
   *
   * ⚠️ 여기서 풀 리로드를 걸면 파일 하나 저장할 때마다 vault 전체를 다시 읽는다.
   */
  it("디렉터리가 바뀌거나 생긴 것은 무시한다 — 안의 파일 이벤트가 따로 온다", () => {
    expect(classifyChange({ kind: "modified", path: "/v/plans", mtime_ms: 1 })).toBe("ignore");
    expect(classifyChange({ kind: "created", path: "/v/plans" })).toBe("ignore");
  });

  /**
   * 🔴 **범위를 모른다.** 폴더가 사라지거나 이름이 바뀌면 그 아래 노트가 전부 움직인
   * 것인데, 개별 파일 이벤트는 안 온다. 증분으로는 못 따라가므로 통째로 다시 읽는다.
   *
   * ⚠️ 지금까지는 이 경우에 **인덱스가 옛 경로를 그대로 들고 있었다.**
   */
  it("디렉터리가 사라지거나 이름이 바뀌면 전체를 다시 읽는다", () => {
    expect(classifyChange({ kind: "removed", path: "/v/plans" })).toBe("reload");
    expect(classifyChange({ kind: "renamed", from: "/v/plans", to: "/v/designs" })).toBe("reload");
  });

  /** 한쪽만 디렉터리인 이름 바꾸기도 범위를 모르는 것은 같다. */
  it("이름 바꾸기는 한쪽만 디렉터리여도 다시 읽는다", () => {
    expect(classifyChange({ kind: "renamed", from: "/v/plans", to: "/v/b.md" })).toBe("reload");
    expect(classifyChange({ kind: "renamed", from: "/v/a.md", to: "/v/designs" })).toBe("reload");
  });

  /**
   * ⚠️ **확장자만 보고 판단한다.** 이벤트가 올 때 그 경로는 이미 없을 수도 있어서
   * (삭제·이름 바꾸기) 디스크에 물어볼 수가 없다.
   *
   * 그래서 "노트 확장자가 아니면 디렉터리"로 **읽는다.** 이게 성립하는 이유는 생산자 쪽
   * 계약이다 — `watcher.rs` 의 `is_relevant_path` 가 **파일은 `.md`/`.mmd` 만** 통과시키고
   * 디렉터리는 통과시킨다. 그러니 여기 도착하는 비노트 경로는 디렉터리뿐이다.
   *
   * 🔴 그 계약이 깨지면 이 판정이 조용히 틀린다. 아래는 그때의 동작을 고정해 둔 것이지
   * 실제로 오는 입력이 아니다 — 이름 없는 전제를 테스트에 적어 둔다.
   */
  it("노트 확장자가 아니면 디렉터리로 읽는다 (생산자 계약)", () => {
    expect(classifyChange({ kind: "modified", path: "/v/a.png", mtime_ms: 1 })).toBe("ignore");
    expect(classifyChange({ kind: "removed", path: "/v/a.png" })).toBe("reload");
  });
});
