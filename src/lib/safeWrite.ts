/**
 * 되돌릴 수 없는 **여러 파일 쓰기**의 안전장치 — 백업 → 순차 쓰기 → 실패 시 롤백.
 *
 * ## 왜 store 밖에 있나
 *
 * 원래 `stores/vault.ts`(Svelte store) 안에 있었다. 소비자가 하나(노트 rename)일 때는
 * 괜찮았는데, 태그 이름 바꾸기(#202)가 두 번째가 되면서 `export`로 꺼내 쓰기 시작했고,
 * CLI가 세 번째가 되려 했다.
 *
 * **프론트매터를 건드리는 경로가 갈리면 백업·롤백 규칙도 갈린다.** 그러면 한쪽에서만
 * 사고가 재발한다 — #184에서 YAML 파싱 실패로 노트의 frontmatter가 통째로 날아간 적이
 * 있는 경로다. 규칙은 하나여야 한다.
 *
 * IO를 주입받아 순수하게 유지한다. 앱은 Tauri 커맨드를, 다른 소비자는 자기 IO를 넣는다.
 *
 * ## ⚠️ 결과를 **반환**한다 — 조용히 실패하지 않는다
 *
 * 예전 구현은 백업이 실패하면 `return`으로 빠져나갔다. 호출부는 성공과 실패를 구분할
 * 방법이 없었고, 실제로 태그 이름 바꾸기 모달이 **아무것도 안 쓰고도 성공한 듯 닫혔다.**
 * 되돌릴 수 없는 쓰기에서 그건 가장 나쁜 실패다 — 사용자는 됐다고 믿는다.
 */

/** 쓸 파일 하나. `linkRewrite`·`tagRewrite`의 미리보기 항목이 이 모양이다. */
export interface SafeWriteItem {
  path: string;
  newContent: string;
}

/**
 * 백업 디렉터리 접두.
 *
 * ⚠️ 이름이 `link-rewrite`인 건 역사적 이유다. **바꾸지 않는다** — prune
 * (`prune_link_rewrite_backups`)이 이 한 곳만 보므로, 다른 이름을 쓰면 영원히 정리되지
 * 않는 백업이 쌓인다. 태그 이름 바꾸기도 여기를 쓴다.
 */
export const BACKUP_ROOT = ".lapis/link-rewrite-backup";

export interface SafeWriteIo {
  /** 원본을 `destRel`에 복사하고 백업 디렉터리의 절대 경로를 돌려준다. */
  backupNotes(vault: string, sources: string[], destRel: string): Promise<string>;
  readNote(path: string): Promise<string>;
  writeNote(vault: string, path: string, content: string): Promise<void>;
  /** 오래된 백업 정리. **실패해도 메인 흐름에 영향이 없어야 한다**(안에서 삼킨다). */
  pruneBackups(vault: string): Promise<void>;
  log(level: "info" | "error", message: string): void;
  /** 백업 디렉터리 이름에 쓸 타임스탬프. 테스트가 고정할 수 있게 주입한다. */
  timestamp(): string;
}

export type SafeWriteOutcome =
  | { ok: true; written: string[]; backupDir: string }
  /** 백업 단계에서 실패 — **아무것도 쓰지 않았다.** */
  | { ok: false; stage: "backup"; reason: string }
  /** 쓰기 도중 실패 — 롤백을 시도했다. `rolledBack < written`이면 수동 복구가 필요하다. */
  | {
      ok: false;
      stage: "write";
      reason: string;
      failedPath: string;
      backupDir: string;
      written: number;
      rolledBack: number;
    };

/** vault 기준 상대 경로. `abs`가 vault 안이 아니면 null. */
export function relativeToVault(vault: string, abs: string): string | null {
  const prefix = vault.endsWith("/") ? vault : vault + "/";
  if (!abs.startsWith(prefix)) return null;
  return abs.slice(prefix.length);
}

/**
 * 쓰기 실패 시 이미 갱신된 파일을 백업 원본으로 되돌린다.
 *
 * 복원 자체가 실패해도 다음으로 넘어간다 — **부분 복원이라도 시도한다.** 하나가 막혔다고
 * 나머지를 옛 상태로 남겨두면 vault가 더 뒤섞인다.
 */
async function rollback(
  vault: string,
  backupDir: string,
  writtenPaths: readonly string[],
  io: SafeWriteIo,
): Promise<number> {
  if (writtenPaths.length === 0) return 0;
  io.log("info", `자동 롤백 시작: ${writtenPaths.length}건 복원`);
  let restored = 0;
  for (const target of writtenPaths) {
    try {
      const rel = relativeToVault(vault, target);
      if (rel === null) {
        io.log("error", `rollback: ${target}이 vault(${vault}) 밖 — skip`);
        continue;
      }
      const original = await io.readNote(`${backupDir}/${rel}`);
      await io.writeNote(vault, target, original);
      restored++;
    } catch (e) {
      io.log("error", `rollback failed for ${target}: ${String(e)}`);
    }
  }
  io.log("info", `자동 롤백 완료: ${restored}/${writtenPaths.length}건 복원`);
  return restored;
}

/**
 * 백업 → 순차 쓰기 → 실패 시 롤백.
 *
 * 병렬로 쓰지 않는다. 어디까지 썼는지 알아야 정확히 그만큼만 되돌릴 수 있다.
 */
export async function backupAndWrite(
  vault: string,
  items: readonly SafeWriteItem[],
  io: SafeWriteIo,
): Promise<SafeWriteOutcome> {
  if (items.length === 0) {
    // 쓸 게 없으면 백업도 만들지 않는다 — 빈 디렉터리가 prune 대상만 늘린다.
    return { ok: true, written: [], backupDir: "" };
  }

  const backupDirRel = `${BACKUP_ROOT}/${io.timestamp()}`;
  let backupDir: string;
  try {
    backupDir = await io.backupNotes(
      vault,
      items.map((i) => i.path),
      backupDirRel,
    );
    io.log("info", `backup → ${backupDir}`);
  } catch (e) {
    // ⚠️ 백업 없이 쓰지 않는다. 되돌릴 수단이 없는 쓰기는 하지 않는다.
    io.log("error", `backup failed — write aborted: ${String(e)}`);
    return { ok: false, stage: "backup", reason: String(e) };
  }

  const written: string[] = [];
  for (const item of items) {
    try {
      await io.writeNote(vault, item.path, item.newContent);
      written.push(item.path);
    } catch (e) {
      io.log("error", `write failed for ${item.path}: ${String(e)}`);
      const rolledBack = await rollback(vault, backupDir, written, io);
      io.log("info", `추가 수동 복구가 필요하면 ${backupDir} 에서 회수할 수 있다`);
      return {
        ok: false,
        stage: "write",
        reason: String(e),
        failedPath: item.path,
        backupDir,
        written: written.length,
        rolledBack,
      };
    }
  }

  // 전부 성공한 뒤에만 prune 한다. 실패 경로에서 정리하면 방금 만든 백업이 지워질 수 있다.
  try {
    await io.pruneBackups(vault);
  } catch (e) {
    io.log("error", `backup prune failed (무시): ${String(e)}`);
  }

  return { ok: true, written, backupDir };
}

/** 사람에게 보여줄 실패 설명. UI와 CLI가 같은 문장을 쓴다. */
export function describeFailure(outcome: SafeWriteOutcome): string | null {
  if (outcome.ok) return null;
  if (outcome.stage === "backup") {
    return `백업에 실패해 아무것도 쓰지 않았다: ${outcome.reason}`;
  }
  const tail =
    outcome.rolledBack === outcome.written
      ? "이미 쓴 것은 모두 되돌렸다"
      : `되돌리기 ${outcome.rolledBack}/${outcome.written}건 — ${outcome.backupDir} 에서 수동 복구가 필요하다`;
  return `${outcome.failedPath} 쓰기에 실패했다: ${outcome.reason}. ${tail}`;
}
