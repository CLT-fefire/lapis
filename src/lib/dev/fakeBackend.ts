import { DEV_VAULT, FIXTURE_NOTES, FIXTURE_READONLY, FIXTURE_COMMITS } from "./fixtureVault";

/**
 * dev 전용 **가짜 Tauri 백엔드**.
 *
 * ## ⚠️ 이것으로 검증했다고 말하면 안 된다
 *
 * 실제 Rust 가 하는 것 — 원자적 쓰기, 경로 이탈 검사, 감시자, 디스크 캐시, git — 을
 * **흉내내지 않는다.** 여기서 되는 것이 실물에서 된다는 보장은 없다.
 *
 * 이 가짜가 답하는 질문은 하나다: **"화면이 제대로 그려지나."**
 *
 * 그 질문이 중요한 이유는 실측이 말한다 — 필터 칩의 활성 표시가 빠진 채로 두 릴리스가
 * 나갔다(폴더 축 v3.1.0 · 임의 축 v3.3.0). 순수 함수 테스트도 배선 가드도 못 잡았다.
 * `class:active` 는 제대로 걸려 있었고 **CSS 규칙만 없었다.**
 *
 * ## ⚠️ 링크 추출을 여기서 다시 만든다
 *
 * "인덱스 생산자는 Rust 하나"라는 규칙을 브라우저에서는 지킬 수가 없다 — Rust 가 없다.
 * 그래서 여기 있는 추출은 **근사**이고, 파싱 규칙의 정확성이 걸린 것은 이 가짜로
 * 판단하면 안 된다. 그건 `vault.rs` 의 테스트가 답한다.
 *
 * ## ⚠️ 프로덕션에 안 들어간다
 *
 * `import.meta.env.DEV` 가 아니면 아예 로드되지 않는다(`invoke.ts` 참조).
 * 번들러가 그 분기를 걷어낸다.
 */

interface LinkInfoLike {
  source_path: string;
  source_name: string;
  title: string | null;
  aliases: string[];
  targets: string[];
  tags: string[];
  doc_kind: string | null;
  topic: string | null;
  related: string[];
  props: Record<string, string[]>;
}

const now = Date.parse("2026-08-28T09:00:00Z");

function splitFrontmatter(raw: string): { fm: string; body: string } {
  if (!raw.startsWith("---\n")) return { fm: "", body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end < 0) return { fm: "", body: raw };
  return { fm: raw.slice(4, end), body: raw.slice(end + 4) };
}

/** ⚠️ 근사다. 배열 한 줄 · 스칼라만 본다 — 픽스처가 그 형태로만 쓰였기 때문이다. */
function parseProps(fm: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of fm.split("\n")) {
    const m = /^([a-zA-Z_][\w-]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, rawVal] = m;
    const v = rawVal.trim();
    if (v.startsWith("[") && v.endsWith("]")) {
      out[key] = v
        .slice(1, -1)
        .split(",")
        .map((x) => x.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else if (v !== "") {
      out[key] = [v.replace(/^["']|["']$/g, "")];
    }
  }
  return out;
}

function stemOf(rel: string): string {
  return (rel.split("/").pop() ?? rel).replace(/\.(md|mmd)$/i, "");
}

function linkInfoOf(rel: string, raw: string): LinkInfoLike {
  const { fm, body } = splitFrontmatter(raw);
  const props = parseProps(fm);
  const targets = [...body.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  return {
    source_path: `${DEV_VAULT}/${rel}`,
    source_name: stemOf(rel),
    title: props.title?.[0] ?? null,
    aliases: props.aliases ?? [],
    targets,
    tags: props.tags ?? [],
    doc_kind: props.doc_kind?.[0] ?? null,
    topic: props.topic?.[0] ?? null,
    related: props.related ?? [],
    props,
  };
}

/** 파일시스템 대신 — 쓰기도 여기 남는다(디스크에 안 간다). */
const files = new Map<string, string>(
  FIXTURE_NOTES.map((n) => [`${DEV_VAULT}/${n.rel}`, n.body]),
);

function tree(): unknown[] {
  // 경로에서 디렉터리 트리를 만든다.
  interface Node {
    name: string;
    path: string;
    is_dir: boolean;
    children?: Node[];
  }
  const root: Node[] = [];
  for (const path of [...files.keys()].sort()) {
    const rel = path.slice(DEV_VAULT.length + 1);
    const segs = rel.split("/");
    let level = root;
    let acc = DEV_VAULT;
    for (let i = 0; i < segs.length; i++) {
      acc += `/${segs[i]}`;
      const isFile = i === segs.length - 1;
      let node = level.find((n) => n.name === segs[i]);
      if (!node) {
        node = isFile
          ? { name: stemOf(segs[i]), path: acc, is_dir: false }
          : { name: segs[i], path: acc, is_dir: true, children: [] };
        level.push(node);
      }
      if (!isFile) level = node.children!;
    }
  }
  return root;
}

/**
 * 명령 → 응답.
 *
 * ⚠️ **모르는 명령은 던진다.** 조용히 `undefined` 를 주면 호출부가 그것을 정상으로
 * 취급하고, 무엇이 빠졌는지 알 수 없게 된다.
 */
export async function fakeInvoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const path = String(args.path ?? "");
  switch (cmd) {
    case "read_vault_bundle": {
      const links = [...files.entries()].map(([p, body]) =>
        linkInfoOf(p.slice(DEV_VAULT.length + 1), body),
      );
      return {
        links,
        // ⚠️ `NoteContent` 는 `name` 도 갖는다 — 풀텍스트 인덱스가 그걸로 파일명 검색을 한다.
        //    빠뜨리면 검색이 **에러 없이** 파일명을 못 찾는다.
        contents: [...files.entries()].map(([p, body]) => ({
          path: p,
          name: stemOf(p),
          body,
        })),
        stats: { walk_ms: 0, read_ms: 0, file_count: files.size },
      };
    }
    case "list_notes":
      return tree();
    case "read_note":
      return files.get(path) ?? "";
    case "write_note":
      // ⚠️ **한 경로는 거부한다.** 항상 성공하면 실패 배너를 한 번도 못 본다 — 그 화면은
      //    되돌릴 수 없는 쓰기가 깨졌을 때만 뜨고, 그때가 가장 잘 보여야 하는 순간이다.
      if (path === FIXTURE_READONLY) {
        throw new Error("[dev] 이 픽스처 경로는 저장이 실패하도록 돼 있다");
      }
      files.set(path, String(args.content ?? ""));
      return null;
    case "rename_note": {
      const oldPath = String(args.oldPath ?? "");
      const dir = oldPath.slice(0, oldPath.lastIndexOf("/"));
      const next = `${dir}/${String(args.newName ?? "")}`;
      const body = files.get(oldPath) ?? "";
      files.delete(oldPath);
      files.set(next, body);
      return next;
    }
    case "move_note": {
      const from = String(args.path ?? args.oldPath ?? "");
      const to = String(args.newPath ?? args.destPath ?? "");
      const body = files.get(from) ?? "";
      files.delete(from);
      files.set(to, body);
      return to;
    }
    case "delete_note":
      files.delete(path);
      return null;
    case "backup_notes":
      // 백업은 성공한 것으로 둔다 — 실패시키고 싶은 것은 **쓰기**다(`FIXTURE_READONLY`).
      return `${DEV_VAULT}/${String(args.backupDirRel ?? ".lapis/backup")}`;

    case "scan_link_single":
      return linkInfoOf(path.slice(DEV_VAULT.length + 1), files.get(path) ?? "");
    case "notes_mtimes":
      return (args.paths as string[] | undefined)?.map((p, i) => [p, now - i * 3_600_000]) ?? [];
    case "vault_file_stats":
      // ⚠️ 실제 타입은 `{ fingerprint, files: FileStat[], walk_ms }` 다. 모양을 틀리면
      //    호출부가 `stats.files` 를 순회하다 죽는다 — 실제로 그렇게 걸렸다.
      return {
        fingerprint: "dev",
        files: [...files.keys()].map((path, i) => ({
          path,
          mtime_ms: now - i * 3_600_000,
          size: (files.get(path) ?? "").length,
        })),
        walk_ms: 0,
      };
    case "vault_fingerprint":
      return { fingerprint: "dev", file_count: files.size, walk_ms: 0 };
    case "find_assets_for_note":
      return [];
    case "grep_vault":
      return [];

    // 감시자 — 이벤트를 안 낸다. 픽스처는 밖에서 안 바뀐다.
    case "watch_vault":
    case "unwatch_vault":
      return null;

    // git — 이력이 **있는** 것처럼 답한다. 되돌아보기·커밋 시점 내용이 그려지는지 본다.
    case "git_is_repo":
      return true;
    case "git_has_changes":
      return true;
    case "git_init":
    case "git_commit_all":
    case "git_commit_paths":
      return true;
    case "git_log":
    case "git_recent": {
      const limit = Number(args.limit ?? FIXTURE_COMMITS.length);
      return FIXTURE_COMMITS.slice(0, limit);
    }
    case "git_show_diff":
      return [
        "--- a/표-예시.md",
        "+++ b/표-예시.md",
        "@@ -1,3 +1,4 @@",
        " | 이름 | 수 | 비고 |",
        "+| 라 |  | 빈 칸은 뒤로 |",
      ].join("\n");
    case "git_show_file":
      // 그 시점의 본문 — 지금 것과 **달라야** 비교 화면이 뜻을 갖는다.
      return (files.get(String(args.path ?? "")) ?? "").replace("| 라 |  | 빈 칸은 뒤로 |\n", "");

    case "settings_read":
      return {};
    case "settings_write":
      return null;
    case "settings_paths":
      return { writes: `${DEV_VAULT}/settings.json`, mcp_reads: `${DEV_VAULT}/settings.json`, same: true };

    // 검색 캐시 — 없다. 워커가 새로 만든다.
    case "read_search_cache_meta":
    case "read_search_cache_shard":
    case "read_search_cache_stats":
      return null;
    case "write_search_cache_meta":
    case "write_search_cache_shard":
    case "write_search_cache_stats":
      return null;

    case "usage_months":
      return { months: [], dir: `${DEV_VAULT}/.usage`, total_bytes: 0 };
    case "usage_read":
      return [];
    case "usage_append":
      return { written: 0, dropped: 0, bytes: 0 };
    case "usage_clear":
      return 0;

    case "is_debug_build":
      return true;
    case "take_pending_open":
      return null;
    case "prune_link_rewrite_backups":
      return 0;

    default:
      // ⚠️ 던진다. 조용히 undefined 를 주면 무엇이 빠졌는지 모른다.
      throw new Error(`[dev] 가짜 백엔드가 모르는 명령: ${cmd}`);
  }
}
