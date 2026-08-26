import { splitFrontmatter } from "$lib/frontmatter";
import type { LinkRewritePreviewItem } from "$lib/linkRewrite";

/**
 * 태그 이름 바꾸기 · 병합 — vault 전체의 frontmatter `tags:`를 갱신.
 *
 * ## 왜 필요한가
 *
 * 태그는 `tech/svelte5`처럼 `/`로 계층을 이루고 사이드바가 접두 트리로 그린다. 그런데
 * 오타 하나를 고치려면 그 태그가 든 노트를 **전부 손으로 열어야 했다.** 링크는 rename이
 * 자동 갱신하는데 태그에는 그 짝이 없었다.
 *
 * ## 계층은 접두로 따라 움직인다
 *
 * `tech` → `stack`은 `tech/svelte5`도 `stack/svelte5`로 옮긴다. MCP의 `tag` 인자가
 * "`tech`를 주면 `tech/*` 전부"인 것과 같은 의미론이다. 경계는 **`/`에서만** 인정한다 —
 * `tech` 이름 바꾸기가 `technical`을 건드리면 안 된다.
 *
 * ## ⚠️ YAML을 파싱하지 않는다
 *
 * `linkRewrite`의 `rewriteRelatedInFrontmatter`와 같은 방식으로 **줄 단위 텍스트 편집**을
 * 한다. 파싱 후 재직렬화는 #184에서 이미 사고를 냈다 — YAML 파싱이 실패하자 노트의
 * frontmatter가 통째로 날아갔다. 여기서도 모르는 필드·주석·따옴표 스타일은 손대지 않는다.
 */

/** 태그 하나에 이름 바꾸기를 적용. 대상이 아니면 원본 그대로 돌려준다. */
export function renameTag(tag: string, oldTag: string, newTag: string): string {
  if (tag === oldTag) return newTag;
  // 계층 자식 — 경계는 `/`에서만. `tech`가 `technical`을 먹지 않게 한다.
  if (tag.startsWith(oldTag + "/")) return newTag + tag.slice(oldTag.length);
  return tag;
}

/** 이 태그가 이름 바꾸기의 대상인가. */
export function isTagAffected(tag: string, oldTag: string): boolean {
  return tag === oldTag || tag.startsWith(oldTag + "/");
}

/** 따옴표를 벗긴 값. 원본의 따옴표 스타일은 호출부가 보존한다. */
function unquote(s: string): string {
  return s.trim().replace(/^['"]|['"]$/g, "");
}

/**
 * frontmatter의 `tags:`에서 이름 바꾸기를 수행.
 *
 * 인라인(`tags: [a, b]`)과 블록(`tags:` + `  - a`) 둘 다 다룬다.
 *
 * ⚠️ **중복은 제거한다.** 병합(`a` → `b`인데 그 노트에 `b`도 있는 경우) 결과가 같은 태그
 * 두 개가 되면 안 된다. 블록 형식에서는 해당 줄을 통째로 뺀다.
 */
export function rewriteTagsInFrontmatter(
  yaml: string,
  oldTag: string,
  newTag: string,
): { text: string; count: number } {
  const lines = yaml.split("\n");
  const out: string[] = [];
  let count = 0;
  let inTagsBlock = false;
  /** 블록 형식에서 이미 나온 태그 — 병합으로 생기는 중복을 막는다. */
  let seenInBlock = new Set<string>();

  for (const line of lines) {
    // tags: [a, b]
    const inline = /^tags:\s*\[(.*)\]\s*$/.exec(line);
    if (inline) {
      const seen = new Set<string>();
      const kept: string[] = [];
      for (const raw of inline[1].split(",")) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const value = unquote(trimmed);
        const renamed = renameTag(value, oldTag, newTag);
        if (renamed !== value) count++;
        if (seen.has(renamed)) continue; // 병합으로 겹친 것
        seen.add(renamed);
        // 따옴표 스타일 보존 — 값만 갈아끼운다.
        kept.push(renamed === value ? trimmed : trimmed.replace(value, renamed));
      }
      out.push(`tags: [${kept.join(", ")}]`);
      continue;
    }

    if (/^tags:\s*$/.test(line)) {
      inTagsBlock = true;
      seenInBlock = new Set<string>();
      out.push(line);
      continue;
    }

    if (inTagsBlock) {
      const item = /^(\s+-\s+)(.*)$/.exec(line);
      if (item) {
        const [, prefix, rawValue] = item;
        const value = unquote(rawValue);
        const renamed = renameTag(value, oldTag, newTag);
        if (renamed !== value) count++;
        if (seenInBlock.has(renamed)) continue; // 중복 줄은 버린다
        seenInBlock.add(renamed);
        out.push(renamed === value ? line : `${prefix}${rawValue.replace(value, renamed)}`);
        continue;
      }
      // 들여쓰기 해제 — tags 블록 종료
      inTagsBlock = false;
    }
    out.push(line);
  }

  return { text: out.join("\n"), count };
}

/**
 * 노트 하나에 태그 이름 바꾸기를 적용.
 *
 * ⚠️ **본문은 건드리지 않는다.** README가 못박은 대로 인덱싱 대상은 frontmatter `tags:`
 * 뿐이다. 본문의 `#tag`는 `#define`이나 URL fragment(`#section`)와 구분할 방법이 없어
 * 의도적으로 무시하는데, 여기서 바꾸면 그 판단을 뒤집게 된다.
 */
export function rewriteTagsInNote(
  raw: string,
  oldTag: string,
  newTag: string,
): { changed: boolean; newContent: string; occurrences: number } {
  if (oldTag === newTag || !oldTag || !newTag) {
    return { changed: false, newContent: raw, occurrences: 0 };
  }
  const { frontmatter, body, hasFrontmatter } = splitFrontmatter(raw);
  if (!hasFrontmatter) return { changed: false, newContent: raw, occurrences: 0 };

  const { text, count } = rewriteTagsInFrontmatter(frontmatter, oldTag, newTag);
  if (count === 0) return { changed: false, newContent: raw, occurrences: 0 };

  return { changed: true, newContent: `---\n${text}\n---\n${body}`, occurrences: count };
}

export interface TagRewritePreview {
  oldTag: string;
  newTag: string;
  /** `linkRewrite`와 **같은 모양** — 적용 트랜잭션(`backupAndWrite`)을 그대로 재사용한다. */
  items: LinkRewritePreviewItem[];
  totalOccurrences: number;
  /** 병합인가 — `newTag`가 이미 vault에 쓰이고 있는가. UI가 경고를 띄울 근거. */
  merge: boolean;
}

/**
 * dry-run. 호출자가 모든 노트의 raw를 읽어 넘긴다 — 이 모듈은 IO를 모른다.
 *
 * `existingTags`는 병합 여부 판정용이다. 없으면 `merge`는 false로 둔다.
 */
export function computeTagRewritePreview(
  notes: Map<string, string>,
  oldTag: string,
  newTag: string,
  existingTags: Iterable<string> = [],
): TagRewritePreview {
  const items: LinkRewritePreviewItem[] = [];
  let total = 0;

  if (oldTag && newTag && oldTag !== newTag) {
    for (const [path, raw] of notes) {
      const r = rewriteTagsInNote(raw, oldTag, newTag);
      if (r.changed) {
        items.push({ path, occurrences: r.occurrences, newContent: r.newContent });
        total += r.occurrences;
      }
    }
    items.sort((a, b) => a.path.localeCompare(b.path));
  }

  let merge = false;
  for (const t of existingTags) {
    if (t === newTag || t.startsWith(newTag + "/")) {
      merge = true;
      break;
    }
  }

  return { oldTag, newTag, items, totalOccurrences: total, merge };
}
