/**
 * 테이블 뷰 store — 순수 모듈(`$lib/tableView`)이 못 잡는 **상태 전이**만 본다.
 *
 * 정렬 규칙·저장뷰 파싱은 `tableView.test.ts`가 담당한다. 여기서 고정하는 건
 * "무엇을 하면 렌더 상한이 되돌아가는가"와 "같은 이름으로 저장하면 어떻게 되는가"다.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { get } from "svelte/store";
import {
  RENDER_STEP,
  activeColumns,
  activeDocKinds,
  activeSort,
  activeTopics,
  applySavedView,
  clearTableFilters,
  deleteSavedView,
  moveColumn,
  renderLimit,
  saveCurrentView,
  savedViews,
  showMore,
  toggleColumn,
  toggleSort,
  toggleTableDocKind,
} from "./tableView";

beforeEach(() => {
  activeColumns.set(["title", "doc_kind"]);
  activeSort.set(null);
  activeDocKinds.set(new Set());
  activeTopics.set(new Set());
  renderLimit.set(RENDER_STEP);
  savedViews.set([]);
});

describe("toggleSort", () => {
  it("다른 컬럼이면 오름차순부터", () => {
    toggleSort("created");
    expect(get(activeSort)).toEqual({ key: "created", dir: "asc" });
  });

  it("같은 컬럼이면 방향만 뒤집는다", () => {
    toggleSort("created");
    toggleSort("created");
    expect(get(activeSort)).toEqual({ key: "created", dir: "desc" });
  });

  it("⭐ 정렬이 바뀌면 렌더 상한이 되돌아간다", () => {
    // 안 그러면 "2,000행까지 펼쳐 둔 상태"가 새 정렬에 그대로 남아, 헤더 한 번
    // 눌렀을 뿐인데 2,000행을 다시 그린다.
    showMore();
    showMore();
    expect(get(renderLimit)).toBe(RENDER_STEP * 3);
    toggleSort("topic");
    expect(get(renderLimit)).toBe(RENDER_STEP);
  });
});

describe("필터", () => {
  it("facet을 토글해도 렌더 상한이 되돌아간다", () => {
    showMore();
    toggleTableDocKind("plan");
    expect(get(activeDocKinds).has("plan")).toBe(true);
    expect(get(renderLimit)).toBe(RENDER_STEP);
  });

  it("clearTableFilters는 facet과 상한을 함께 되돌린다", () => {
    toggleTableDocKind("plan");
    showMore();
    clearTableFilters();
    expect(get(activeDocKinds).size).toBe(0);
    expect(get(renderLimit)).toBe(RENDER_STEP);
  });
});

describe("컬럼", () => {
  it("토글은 추가/제거", () => {
    toggleColumn("created");
    expect(get(activeColumns)).toEqual(["title", "doc_kind", "created"]);
    toggleColumn("doc_kind");
    expect(get(activeColumns)).toEqual(["title", "created"]);
  });

  it("좌우 이동", () => {
    moveColumn("doc_kind", -1);
    expect(get(activeColumns)).toEqual(["doc_kind", "title"]);
  });

  it("가장자리 밖으로는 안 나간다", () => {
    moveColumn("title", -1);
    expect(get(activeColumns)).toEqual(["title", "doc_kind"]);
    moveColumn("doc_kind", 1);
    expect(get(activeColumns)).toEqual(["title", "doc_kind"]);
  });

  it("없는 컬럼을 옮겨도 조용히 그대로", () => {
    moveColumn("nope", 1);
    expect(get(activeColumns)).toEqual(["title", "doc_kind"]);
  });
});

describe("저장뷰", () => {
  it("현재 상태를 이름으로 저장한다", () => {
    toggleTableDocKind("plan");
    toggleSort("created");
    saveCurrentView(" 계획 목록 ");
    const [v] = get(savedViews);
    expect(v.name).toBe("계획 목록"); // 이름은 trim
    expect(v.docKinds).toEqual(["plan"]);
    expect(v.sort).toEqual({ key: "created", dir: "asc" });
  });

  it("빈 이름은 저장하지 않는다", () => {
    saveCurrentView("   ");
    expect(get(savedViews)).toHaveLength(0);
  });

  it("⭐ 같은 이름은 덮어쓴다 — 뷰가 무한히 늘지 않게", () => {
    saveCurrentView("A");
    const firstId = get(savedViews)[0].id;
    toggleTableDocKind("plan");
    saveCurrentView("A");
    expect(get(savedViews)).toHaveLength(1);
    expect(get(savedViews)[0].docKinds).toEqual(["plan"]);
    expect(get(savedViews)[0].id).toBe(firstId); // id는 유지 — 삭제 버튼이 흔들리지 않게
  });

  it("불러오면 컬럼·정렬·필터가 그대로 복원된다", () => {
    toggleTableDocKind("plan");
    toggleColumn("created");
    toggleSort("created");
    saveCurrentView("A");

    clearTableFilters();
    activeColumns.set(["title"]);
    activeSort.set(null);

    applySavedView(get(savedViews)[0]);
    expect(get(activeColumns)).toEqual(["title", "doc_kind", "created"]);
    expect(get(activeSort)).toEqual({ key: "created", dir: "asc" });
    expect([...get(activeDocKinds)]).toEqual(["plan"]);
  });

  it("불러온 뷰는 배열을 **복사해** 넣는다 — 저장뷰와 활성 상태가 같은 객체면 안 된다", () => {
    // ⚠️ 이 단언은 **동일성**을 본다. 처음엔 "고쳐도 저장뷰가 안 바뀐다"로 썼는데,
    // 지금 mutator가 전부 불변 갱신(`[...cols, key]`)이라 복사를 빼도 그냥 통과했다
    // (카나리아로 확인). 값 비교로는 이 불변식을 못 잡는다 — 언젠가 in-place `push`를
    // 쓰는 mutator가 하나 생기는 순간 저장뷰가 조용히 따라 바뀐다.
    saveCurrentView("A");
    const saved = get(savedViews)[0];
    applySavedView(saved);
    expect(get(activeColumns)).not.toBe(saved.columns);
    expect(get(activeColumns)).toEqual(saved.columns);
  });

  it("삭제", () => {
    saveCurrentView("A");
    deleteSavedView(get(savedViews)[0].id);
    expect(get(savedViews)).toHaveLength(0);
  });
});
