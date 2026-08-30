import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { normPath } from "../core/cache.ts";
import { BACKUP_ROOT, relativeToVault, type SafeWriteIo } from "$lib/safeWrite";

/**
 * CLI의 파일 IO — `$lib/safeWrite`가 요구하는 인터페이스를 Node `fs`로 구현한다.
 *
 * ## ⚠️ 앱과 **같은 보장**을 해야 한다
 *
 * 앱은 Rust `write_note`를 거친다. 그게 주는 것:
 *
 * 1. **원자적 쓰기** — 같은 디렉터리에 임시 파일을 쓰고 rename으로 교체. 부분 쓰기가
 *    없다. 중간에 죽어도 파일은 옛 내용이거나 새 내용이지 그 사이가 아니다.
 * 2. **vault 이탈 차단** — 경로를 실경로로 풀고 vault 아래인지 확인. 심링크로 밖을
 *    가리키는 경로를 막는다.
 * 3. **확장자 화이트리스트** — `.md` · `.mmd`만.
 *
 * CLI가 이보다 느슨하면 **같은 트랜잭션을 쓰는데 안전성이 갈린다.** 그건 `safeWrite`를
 * 공용으로 만든 이유 자체를 무너뜨린다. 그래서 셋 다 여기서 다시 보장한다.
 */

const SUPPORTED_EXT = new Set(["md", "mmd"]);

function assertSupportedExt(p: string): void {
  const ext = path.extname(p).slice(1).toLowerCase();
  if (!SUPPORTED_EXT.has(ext)) {
    throw new Error(`지원하지 않는 확장자: ${p}`);
  }
}

/**
 * 실경로로 풀어 vault 안인지 확인한다.
 *
 * ⚠️ 문자열 비교만으로는 부족하다. `vault/link` → `/etc` 같은 심링크가 있으면 문자열은
 * vault 안인데 실제로는 밖이다. Rust 쪽이 `canonicalize` 후 `starts_with`를 하는 이유와 같다.
 */
function assertInVault(vaultReal: string, target: string): string {
  const real = normPath(realpathSync(target));
  if (relativeToVault(vaultReal, real) === null && real !== vaultReal) {
    throw new Error(`vault 밖 경로: ${real} (vault: ${vaultReal})`);
  }
  return real;
}

/**
 * 원자적 쓰기 — 같은 디렉터리에 임시 파일 → rename.
 *
 * ⚠️ 같은 디렉터리여야 한다. `/tmp`에 쓰고 옮기면 파일시스템 경계를 넘어 rename이
 * 복사로 떨어지고, 그러면 원자성이 사라진다.
 */
function atomicWrite(target: string, content: string): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.tmp.lapis-cli-${process.pid}`);
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, target);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* 임시 파일이 없으면 그만 */
    }
    throw e;
  }
}

/** 앱 설정에서 백업 보존 개수를 읽는다. 못 읽으면 앱의 기본값과 같은 20. */
function backupKeep(settingsFile: string | null): number {
  if (!settingsFile) return 20;
  try {
    const raw = JSON.parse(readFileSync(settingsFile, "utf8")) as {
      link_rewrite_backup_keep?: unknown;
    };
    const n = raw.link_rewrite_backup_keep;
    return typeof n === "number" && Number.isFinite(n) ? Math.min(Math.max(n, 1), 100) : 20;
  } catch {
    return 20;
  }
}

export interface CliIoOptions {
  /** 앱 설정 파일(`lapis-settings.json`) 경로. 없으면 기본값을 쓴다. */
  settingsFile?: string | null;
  log?: (level: "info" | "error", message: string) => void;
}

export function makeCliIo(opts: CliIoOptions = {}): SafeWriteIo {
  const log =
    opts.log ??
    ((level: "info" | "error", message: string) => {
      if (level === "error") process.stderr.write(`[lapis] ${message}\n`);
      else process.stderr.write(`[lapis] ${message}\n`);
    });

  return {
    async backupNotes(vault, sources, destRel) {
      const vaultReal = normPath(realpathSync(vault));
      const root = path.join(vault, destRel);
      mkdirSync(root, { recursive: true });
      for (const src of sources) {
        const real = assertInVault(vaultReal, src);
        const rel = relativeToVault(vaultReal, real);
        if (rel === null) throw new Error(`backup: vault 밖 — ${real}`);
        const dest = path.join(root, rel);
        mkdirSync(path.dirname(dest), { recursive: true });
        copyFileSync(real, dest);
      }
      return normPath(realpathSync(root));
    },

    async readNote(p) {
      return readFileSync(p, "utf8");
    },

    async writeNote(vault, target, content) {
      const vaultReal = normPath(realpathSync(vault));
      const real = assertInVault(vaultReal, target);
      assertSupportedExt(real);
      atomicWrite(real, content);
    },

    /**
     * 오래된 백업 정리. 디렉터리 이름이 ISO 타임스탬프라 **사전순 = 시간순**이다.
     *
     * 실패해도 삼킨다 — 호출부(`safeWrite`)도 그렇게 다룬다. 정리가 안 된 것 때문에
     * 방금 성공한 쓰기를 실패로 돌릴 이유가 없다.
     */
    async pruneBackups(vault) {
      const root = path.join(vault, BACKUP_ROOT);
      let dirs: string[];
      try {
        dirs = readdirSync(root, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
      } catch {
        return;
      }
      const keep = backupKeep(opts.settingsFile ?? null);
      const excess = dirs.length - keep;
      if (excess <= 0) return;
      for (const name of dirs.slice(0, excess)) {
        try {
          rmSync(path.join(root, name), { recursive: true, force: true });
        } catch (e) {
          log("error", `backup prune 실패 ${name}: ${String(e)}`);
        }
      }
      log("info", `backup prune: ${excess}개 정리 (max_keep=${keep})`);
    },

    log,
    timestamp: () => new Date().toISOString().replace(/[:.]/g, "-"),
  };
}
