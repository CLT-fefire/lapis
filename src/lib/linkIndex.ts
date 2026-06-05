import type { LinkInfo } from "$lib/tauri/notes";
import { buildRelationIndex, type RelationIndex } from "$lib/relations";

export interface LinkIndex {
  byPath: Map<string, LinkInfo>;
  // 키: 소문자 문자열 (alias / title / file stem) → 노트 path
  resolver: Map<string, string>;
  // 키: 노트 path → 그 노트를 **본문** wikilink/md-link로 가리키는 소스 path 집합.
  // (frontmatter cross-ref는 backlinks가 아니라 relations가 타입별로 담당 — Phase A-2)
  backlinks: Map<string, Set<string>>;
  // frontmatter 기반 타입 있는 관계(parent_plan/depends_on/related/…) 양방향 인덱스.
  relations: RelationIndex;
}

/**
 * wikilink target에서 alias 분리. `[[file|alias]]` → "file"
 */
export function targetName(rawTarget: string): string {
  const idx = rawTarget.indexOf("|");
  return (idx === -1 ? rawTarget : rawTarget.slice(0, idx)).trim();
}

/**
 * resolver lookup. 우선순위는 buildIndex에서 삽입 순서로 처리됨 (alias > title > stem).
 */
export function resolveTarget(target: string, index: LinkIndex): string | null {
  return index.resolver.get(target.toLowerCase()) ?? null;
}

export function buildIndex(infos: LinkInfo[]): LinkIndex {
  const byPath = new Map<string, LinkInfo>();
  const resolver = new Map<string, string>();

  // 1단계: alias 우선 등록 (가장 높은 권위)
  for (const info of infos) {
    byPath.set(info.source_path, info);
    for (const alias of info.aliases) {
      const key = alias.toLowerCase();
      if (!resolver.has(key)) resolver.set(key, info.source_path);
    }
  }
  // 2단계: title
  for (const info of infos) {
    if (info.title) {
      const key = info.title.toLowerCase();
      if (!resolver.has(key)) resolver.set(key, info.source_path);
    }
  }
  // 3단계: file stem
  for (const info of infos) {
    const key = info.source_name.toLowerCase();
    if (!resolver.has(key)) resolver.set(key, info.source_path);
  }

  // backlinks 계산 — **본문** wikilink/md-link만. frontmatter cross-ref(related 등)는
  // buildRelationIndex가 관계 타입을 보존해 별도로 인덱싱(중복 표시 방지).
  const backlinks = new Map<string, Set<string>>();
  function addBacklink(targetPath: string, sourcePath: string) {
    if (targetPath === sourcePath) return;
    let set = backlinks.get(targetPath);
    if (!set) {
      set = new Set();
      backlinks.set(targetPath, set);
    }
    set.add(sourcePath);
  }
  for (const info of infos) {
    for (const raw of info.targets) {
      const name = targetName(raw);
      const resolvedPath = resolver.get(name.toLowerCase());
      if (!resolvedPath) continue;
      addBacklink(resolvedPath, info.source_path);
    }
  }

  const relations = buildRelationIndex(infos, resolver);

  return { byPath, resolver, backlinks, relations };
}

export function getBacklinks(targetPath: string, index: LinkIndex): LinkInfo[] {
  const sources = index.backlinks.get(targetPath);
  if (!sources) return [];
  const out: LinkInfo[] = [];
  for (const path of sources) {
    const info = index.byPath.get(path);
    if (info) out.push(info);
  }
  out.sort((a, b) => {
    const an = (a.title ?? a.source_name).toLowerCase();
    const bn = (b.title ?? b.source_name).toLowerCase();
    return an.localeCompare(bn);
  });
  return out;
}
