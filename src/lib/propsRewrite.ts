import { splitFrontmatter } from "$lib/frontmatter";

/**
 * frontmatter **스칼라 값** 바꾸기 — `props audit` 이 찾은 것을 고치는 짝.
 *
 * ## 🔴 진단만 있고 처방이 없었다
 *
 * `props audit` 은 실제 vault 에서 이런 것을 찾아낸다:
 *
 * ```
 * topic  (앞부분이 같음)   11 feature  ·  2 feature-selection
 * topic  (suffix)          5 platform ·  1 cross-platform
 * ```
 *
 * 태그에는 `tag rename` 이 있는데 frontmatter 값에는 그 짝이 없었다. 앱도
 * `audit-props` 탭으로 **보여주기만** 했다. 13개 파일을 손으로 고쳐야 했다.
 *
 * ## ⚠️ YAML 을 파싱하지 않는다
 *
 * `tagRewrite.ts` 와 같은 이유다 — #184 에서 파싱 후 재직렬화가 실패해 노트의
 * frontmatter 가 **통째로 날아갔다.** 줄 단위 텍스트 편집만 한다. 모르는 필드·주석·
 * 따옴표 스타일은 손대지 않는다.
 *
 * ## ⚠️ 태그와 달리 접두 계층이 없다
 *
 * `tag rename tech` 는 `tech/svelte5` 도 옮긴다. `topic` 에는 계층이 없으므로
 * **정확히 일치할 때만** 바꾼다. 감사가 "앞부분이 같음" · "suffix" 로 묶어 주는 것은
 * *후보를 보여주는* 것이지 같은 값이라는 뜻이 아니다 — `cross-platform` 은
 * `platform` 이 아니다. 무엇을 무엇으로 바꿀지는 사람이 정한다.
 */

/**
 * 이 도구가 다루는 키.
 *
 * ⚠️ **배열 축은 빠져 있다.** `tags` 는 `tag rename` 이 계층까지 다루므로 여기서
 * 손대면 규칙이 두 벌이 된다. `related` · `aliases` 도 배열이라 의미론이 다르다.
 */
export const SCALAR_PROP_KEYS = ["doc_kind", "topic", "status"] as const;

export type ScalarPropKey = (typeof SCALAR_PROP_KEYS)[number];

/** 앞뒤 따옴표를 벗긴다. 스타일은 호출부가 원본에서 되살린다. */
function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * frontmatter 텍스트에서 `<키>: <값>` 한 줄의 값을 바꾼다.
 *
 * ⚠️ **줄 끝 주석을 남긴다.** 사람이 "왜 이 값인지"를 적어 둔 자리다.
 * ⚠️ **배열(`[...]`)은 건드리지 않는다.** 이 함수는 스칼라 전용이다.
 */
export function rewritePropInFrontmatter(
  yaml: string,
  key: string,
  oldValue: string,
  newValue: string,
): { text: string; count: number } {
  const lines = yaml.split("\n");
  const out: string[] = [];
  let count = 0;

  for (const line of lines) {
    const head = new RegExp(`^(${escapeRe(key)}:\\s*)`).exec(line);
    if (!head) {
      out.push(line);
      continue;
    }
    const { value: rawValue, comment } = splitValueAndComment(line.slice(head[1].length));

    // 배열은 이 도구가 다루지 않는다 — `tags` 는 `tag rename` 몫이다.
    if (rawValue.trim().startsWith("[")) {
      out.push(line);
      continue;
    }
    if (unquote(rawValue) !== oldValue) {
      out.push(line);
      continue;
    }
    count++;
    // 따옴표 스타일 보존 — 값만 갈아끼운다.
    out.push(`${head[1]}${rawValue.replace(oldValue, newValue)}${comment}`);
  }

  return { text: out.join("\n"), count };
}

/**
 * 값과 줄 끝 주석을 가른다.
 *
 * ## 🔴 정규식 하나로는 못 가른다
 *
 * 처음엔 값과 주석을 한 정규식에서 `\s*#` 로 갈랐다. 두 가지가 조용히 틀렸다:
 *
 * 1. **공백 없는 `#`** — YAML 에서 `#` 은 **앞에 공백이 있어야** 주석이다.
 *    `C#` 은 스칼라 `C#` 하나다. 그래서 `topic: C#` 이 값 `C` 로 읽혀 안 건드려야 할
 *    것을 건드렸고(`props rename topic C D` → `topic: D#`), 반대로 진짜 값 `C#` 은
 *    영영 안 맞았다. 프로그래밍 노트에서 `C#` · `F#` 은 흔하다.
 * 2. **따옴표 안** — `topic: "a # b"` 는 `#` 앞에 공백이 있지만 그건 값의 일부다.
 *
 * ⚠️ 그래도 **YAML 을 파싱하지 않는다.** 따옴표 경계만 훑는 줄 단위 작업이다 —
 * 파싱 후 재직렬화는 #184 에서 frontmatter 를 통째로 날렸다.
 */
function splitValueAndComment(rest: string): { value: string; comment: string } {
  const trimmed = rest.trimStart();
  const lead = rest.length - trimmed.length;
  const q = trimmed[0];

  if (q === '"' || q === "'") {
    for (let i = 1; i < trimmed.length; i++) {
      // 큰따옴표는 백슬래시로, 작은따옴표는 겹쳐서(`''`) 이스케이프한다.
      if (q === '"' && trimmed[i] === "\\") {
        i++;
        continue;
      }
      if (trimmed[i] !== q) continue;
      if (q === "'" && trimmed[i + 1] === "'") {
        i++;
        continue;
      }
      const end = lead + i + 1;
      return { value: rest.slice(0, end), comment: rest.slice(end) };
    }
    // 닫는 따옴표가 없다 — 줄 전체를 값으로 본다. 잘라내는 것보다 안 건드리는 게 낫다.
    return { value: rest, comment: "" };
  }

  // ⚠️ 공백 **뒤의** `#` 만 주석이다.
  const at = rest.search(/\s#/);
  if (at < 0) return { value: rest, comment: "" };
  return { value: rest.slice(0, at), comment: rest.slice(at) };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 노트 하나에 적용.
 *
 * ⚠️ **본문은 건드리지 않는다.** 인덱싱 대상은 frontmatter 뿐이고, 본문에 적힌
 * `topic: old` 는 사람이 쓴 글이다.
 *
 * ⚠️ 바꿀 게 없으면 **원본 문자열을 그대로** 돌려준다 — 안 그러면 쓸 이유가 없는
 * 파일까지 다시 써서 감시자를 깨우고 재색인을 부른다.
 */
export function rewritePropInNote(
  raw: string,
  key: string,
  oldValue: string,
  newValue: string,
): { text: string; count: number } {
  if (!key || !oldValue || !newValue || oldValue === newValue) {
    return { text: raw, count: 0 };
  }
  const { frontmatter, body, hasFrontmatter } = splitFrontmatter(raw);
  if (!hasFrontmatter) return { text: raw, count: 0 };

  const { text, count } = rewritePropInFrontmatter(frontmatter, key, oldValue, newValue);
  if (count === 0) return { text: raw, count: 0 };

  return { text: `---\n${text}\n---\n${body}`, count };
}

/**
 * dry-run 미리보기.
 *
 * ⚠️ 반환 모양을 `tagRewrite` 와 **같게** 맞춘다 — 적용 트랜잭션(`backupAndWrite`)을
 * 그대로 재사용하기 위해서다. 쓰기 경로를 새로 만들지 않는다.
 *
 * ⚠️ 이 모듈은 IO 를 모른다. 호출자가 모든 노트의 raw 를 읽어 넘긴다.
 */
export interface PropRewritePreviewItem {
  path: string;
  occurrences: number;
  newContent: string;
}

export interface PropRewritePreview {
  key: string;
  oldValue: string;
  newValue: string;
  items: PropRewritePreviewItem[];
  totalOccurrences: number;
  /** 병합인가 — `newValue` 가 이미 그 키에 쓰이고 있는가. 사람이 알아야 할 근거다. */
  merge: boolean;
}

export function computePropRewritePreview(
  notes: Map<string, string>,
  key: string,
  oldValue: string,
  newValue: string,
  existingValues: Iterable<string> = [],
): PropRewritePreview {
  const items: PropRewritePreviewItem[] = [];
  let total = 0;

  for (const [path, raw] of notes) {
    const r = rewritePropInNote(raw, key, oldValue, newValue);
    if (r.count > 0) {
      items.push({ path, occurrences: r.count, newContent: r.text });
      total += r.count;
    }
  }
  items.sort((a, b) => a.path.localeCompare(b.path));

  let merge = false;
  for (const v of existingValues) {
    if (v === newValue) {
      merge = true;
      break;
    }
  }

  return { key, oldValue, newValue, items, totalOccurrences: total, merge };
}
