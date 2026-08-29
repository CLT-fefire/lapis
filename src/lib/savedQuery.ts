/**
 * 노트 안에 적어 두는 **저장된 질의** — 그 자리에서 결과가 그려진다.
 *
 * ````
 * ```lapis-query
 * doc_kind: plan, adr
 * topic: overview
 * text: 초성
 * limit: 20
 * ```
 * ````
 *
 * ## 🔴 새 질의 엔진을 만들지 않는다
 *
 * 고르는 일은 `tableView.ts` 의 `filterRows` 가 한다 — 표 화면이 쓰는 **바로 그 함수**다.
 * 여기서 따로 골랐다면 같은 질의가 표와 노트에서 다른 답을 냈을 것이고, 그건 이 저장소가
 * 가장 자주 겪은 결함이다(인덱스 생산자를 Rust 하나로 두는 것과 같은 이유).
 *
 * 그래서 이 파일이 하는 일은 **글자를 축으로 옮기는 것**뿐이다.
 *
 * ## ⚠️ 모르는 키를 조용히 넘기지 않는다
 *
 * `doc-kind:` 나 `tags:` 를 적어 두고 결과가 안 나오면, 사용자는 vault 에 그런 노트가
 * 없다고 읽는다. **틀린 결론이 조용히 나온다.** 그래서 모르는 키는 오류로 되돌리고
 * 화면이 그걸 그린다.
 *
 * ## ⚠️ 태그 축은 **아직 없다**
 *
 * `filterRows` 가 안 받기 때문이다. 여기에만 넣으면 표와 갈리므로 넣지 않았다 —
 * 넣으려면 그 매처를 먼저 넓혀야 한다. 값을 한다고 적지 않는다.
 */

/** 파싱 결과 — 축으로 옮겨진 질의. */
export interface SavedQuery {
  docKinds: string[];
  topics: string[];
  text: string;
  /** 그릴 최대 줄 수. */
  limit: number;
}

export type SavedQueryParse =
  | { ok: true; query: SavedQuery }
  | { ok: false; errors: string[] };

/** 화면이 감당할 수 있는 기본 줄 수. 노트 한 칸에 수백 줄을 쏟지 않는다. */
export const SAVED_QUERY_DEFAULT_LIMIT = 20;
export const SAVED_QUERY_MAX_LIMIT = 200;

/** 이 fence 의 info string. `markdown.ts` 와 플러그인이 같이 쓴다. */
export const SAVED_QUERY_FENCE = "lapis-query";

const KEYS = ["doc_kind", "topic", "text", "limit"] as const;

/** `a, b , c` → `["a","b","c"]`. 빈 조각은 버린다. */
function csv(v: string): string[] {
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * fence 본문을 질의로 옮긴다.
 *
 * ⚠️ 값이 하나도 없으면 **오류다.** 빈 질의를 전량으로 해석하면 노트 한 칸에 vault 가
 * 통째로 쏟아진다 — 그건 사용자가 원한 것일 리 없고, 오타와 구별도 안 된다.
 */
export function parseSavedQuery(source: string): SavedQueryParse {
  const errors: string[] = [];
  const q: SavedQuery = { docKinds: [], topics: [], text: "", limit: SAVED_QUERY_DEFAULT_LIMIT };
  let sawValue = false;

  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // 빈 줄과 `#` 주석은 넘긴다.
    if (!trimmed || trimmed.startsWith("#")) continue;

    const at = trimmed.indexOf(":");
    if (at < 0) {
      errors.push(`${i + 1}번째 줄: \`키: 값\` 꼴이 아니다 — ${trimmed}`);
      continue;
    }
    const key = trimmed.slice(0, at).trim().toLowerCase();
    const value = trimmed.slice(at + 1).trim();

    if (!(KEYS as readonly string[]).includes(key)) {
      errors.push(`모르는 키 \`${key}\` — 쓸 수 있는 것: ${KEYS.join(" · ")}`);
      continue;
    }
    if (!value) {
      errors.push(`\`${key}\` 의 값이 비어 있다`);
      continue;
    }

    switch (key) {
      case "doc_kind":
        q.docKinds.push(...csv(value));
        sawValue = true;
        break;
      case "topic":
        q.topics.push(...csv(value));
        sawValue = true;
        break;
      case "text":
        q.text = value;
        sawValue = true;
        break;
      case "limit": {
        const n = Number(value);
        if (!Number.isInteger(n) || n <= 0) {
          errors.push(`\`limit\` 은 1 이상의 정수여야 한다 — ${value}`);
          break;
        }
        // ⚠️ 상한을 넘으면 **자르되 말한다.** 조용히 자르면 "결과가 이게 전부"로 읽힌다.
        if (n > SAVED_QUERY_MAX_LIMIT) {
          errors.push(`\`limit\` 상한은 ${SAVED_QUERY_MAX_LIMIT} 이다 — ${value}`);
          break;
        }
        q.limit = n;
        break;
      }
    }
  }

  if (!sawValue && errors.length === 0) {
    errors.push("고르는 값이 하나도 없다 — vault 전체를 쏟지 않는다");
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, query: q };
}
