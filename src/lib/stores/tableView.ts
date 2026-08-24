import { writable, get } from "svelte/store";
import {
  DEFAULT_COLUMNS,
  parseSavedViews,
  type ColumnKey,
  type SavedView,
  type SortSpec,
} from "$lib/tableView";

/**
 * 테이블 뷰의 **상태 절반** — 열림 여부 · 활성 뷰 · 저장뷰 영속화.
 *
 * 판정·변환은 전부 `$lib/tableView`(순수)에 있다. 여기는 store와 localStorage만 만진다.
 */

const SAVED_VIEWS_KEY = "lapis.table-views";

export const tableViewOpen = writable<boolean>(false);

/** 화면에 한 번에 그릴 행 수. 19,000행을 DOM에 넣을 수 없어서 자른다. */
export const RENDER_STEP = 500;

/** 활성 뷰 — 저장뷰를 불러오거나 사용자가 조작하면 바뀐다. 저장 전까지는 이름이 없다. */
export const activeColumns = writable<ColumnKey[]>([...DEFAULT_COLUMNS]);
export const activeSort = writable<SortSpec | null>({ key: "created", dir: "desc" });
export const activeDocKinds = writable<Set<string>>(new Set());
export const activeTopics = writable<Set<string>>(new Set());
export const activeText = writable<string>("");
export const renderLimit = writable<number>(RENDER_STEP);

export const savedViews = writable<SavedView[]>(loadSavedViews());
savedViews.subscribe(persistSavedViews);

export function openTableView(): void {
  tableViewOpen.set(true);
}

export function closeTableView(): void {
  tableViewOpen.set(false);
}

/**
 * 헤더 클릭 — 같은 컬럼이면 방향만 뒤집고, 다른 컬럼이면 그 컬럼의 오름차순부터.
 *
 * 정렬이 바뀌면 `renderLimit`을 되돌린다. 안 그러면 "2,000행까지 펼쳐 둔 상태"가
 * 새 정렬에 그대로 남아, 컬럼 하나 눌렀을 뿐인데 2,000행을 다시 그린다.
 */
export function toggleSort(key: ColumnKey): void {
  activeSort.update((cur) =>
    cur && cur.key === key
      ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
      : { key, dir: "asc" },
  );
  renderLimit.set(RENDER_STEP);
}

export function showMore(): void {
  renderLimit.update((n) => n + RENDER_STEP);
}

export function toggleColumn(key: ColumnKey): void {
  activeColumns.update((cols) =>
    cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key],
  );
}

/** 컬럼 순서 바꾸기 — 좌우 한 칸. 드래그는 이 기능의 값에 비해 과하다. */
export function moveColumn(key: ColumnKey, delta: -1 | 1): void {
  activeColumns.update((cols) => {
    const i = cols.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= cols.length) return cols;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

function toggleIn(store: typeof activeDocKinds, value: string): void {
  store.update((set) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  });
  renderLimit.set(RENDER_STEP);
}

export function toggleTableDocKind(value: string): void {
  toggleIn(activeDocKinds, value);
}

export function toggleTableTopic(value: string): void {
  toggleIn(activeTopics, value);
}

export function clearTableFilters(): void {
  activeDocKinds.set(new Set());
  activeTopics.set(new Set());
  activeText.set("");
  renderLimit.set(RENDER_STEP);
}

/** 현재 상태를 이름 붙여 저장. 같은 이름이 있으면 덮어쓴다(뷰가 무한히 늘지 않게). */
export function saveCurrentView(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  const view: SavedView = {
    id: newId(),
    name: trimmed,
    columns: [...get(activeColumns)],
    sort: get(activeSort),
    docKinds: [...get(activeDocKinds)],
    topics: [...get(activeTopics)],
  };
  savedViews.update((views) => {
    const at = views.findIndex((v) => v.name === trimmed);
    if (at < 0) return [...views, view];
    const next = [...views];
    next[at] = { ...view, id: views[at].id };
    return next;
  });
}

export function applySavedView(view: SavedView): void {
  activeColumns.set([...view.columns]);
  activeSort.set(view.sort);
  activeDocKinds.set(new Set(view.docKinds));
  activeTopics.set(new Set(view.topics));
  activeText.set("");
  renderLimit.set(RENDER_STEP);
}

export function deleteSavedView(id: string): void {
  savedViews.update((views) => views.filter((v) => v.id !== id));
}

function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `v-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

// === localStorage — 미지원/비정상 환경(vitest stub 등)에서도 안전하게 ===

function loadSavedViews(): SavedView[] {
  try {
    return parseSavedViews(localStorage.getItem(SAVED_VIEWS_KEY));
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedView[]): void {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch (e) {
    console.warn("[table-view] 저장뷰 영속화 실패", e);
  }
}
