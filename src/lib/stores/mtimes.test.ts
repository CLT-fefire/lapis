import { describe, it, expect, beforeEach } from "vitest";
import { get } from "svelte/store";
import { noteMtimes, touchMtime, dropMtime, resetMtimes, mtimeOf } from "./mtimes";

/**
 * mtime 지도 — 시간축 정렬의 앱 쪽 데이터원.
 *
 * ⚠️ 전량 로드(`primeMtimes`)는 Tauri 커맨드를 부르므로 여기서 다루지 않는다. 이 파일이
 * 고정하는 것은 **watcher가 고치는 규율**이다 — 거기가 조용히 틀리는 자리다.
 */
describe("mtime 지도", () => {
  beforeEach(() => resetMtimes());

  it("수정 이벤트로 값을 넣고 고친다", () => {
    touchMtime("/v/a.md", 100);
    expect(mtimeOf("/v/a.md")).toBe(100);
    touchMtime("/v/a.md", 200);
    expect(mtimeOf("/v/a.md")).toBe(200);
  });

  /** 남겨두면 없는 노트가 "최근 변경" 목록에 뜬다. */
  it("삭제 이벤트로 지운다", () => {
    touchMtime("/v/a.md", 100);
    dropMtime("/v/a.md");
    expect(mtimeOf("/v/a.md")).toBeNull();
  });

  it("없는 것을 지워도 아무 일 없다", () => {
    const before = get(noteMtimes);
    dropMtime("/v/nope.md");
    // 같은 참조여야 한다 — 불필요한 갱신을 흘리면 구독자가 헛돈다.
    expect(get(noteMtimes)).toBe(before);
  });

  /**
   * ⚠️ **새 Map을 만들어야 구독자가 갱신을 본다.** 제자리 수정은 Svelte 스토어에서
   * 조용히 안 보인다 — 값은 맞는데 화면이 안 바뀐다.
   */
  it("갱신마다 새 참조를 낸다", () => {
    touchMtime("/v/a.md", 1);
    const first = get(noteMtimes);
    touchMtime("/v/b.md", 2);
    expect(get(noteMtimes)).not.toBe(first);
    expect(first.has("/v/b.md")).toBe(false);
  });

  it("모르는 경로는 null — 0이 아니다", () => {
    // 0을 내면 "1970년에 바뀐 노트"가 되어 정렬 맨 뒤에 섞인다. 없는 것과 오래된 것은 다르다.
    expect(mtimeOf("/v/nope.md")).toBeNull();
  });

  it("vault 전환에서 통째로 비운다", () => {
    touchMtime("/v/a.md", 1);
    resetMtimes();
    expect(get(noteMtimes).size).toBe(0);
  });
});
