import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { buildShards, type NoteContentIn } from "./indexBuild.ts";
import { locateApp, locateRemedy } from "./appLocate.ts";

/**
 * `lapis index` 오케스트레이션 — 앱 실행파일을 **두 번** 부른다.
 *
 * ```
 *   ① lapis.exe --headless export-index   →  원자료 JSON (Rust가 vault를 훑는다)
 *   ② Node에서 MiniSearch shard 빌드          (여기, 프로세스 안)
 *   ③ lapis.exe --headless import-index   →  캐시 커밋 (Rust가 순서를 지켜 쓴다)
 * ```
 *
 * ## ⚠️ 왜 ③을 Node가 직접 쓰지 않나
 *
 * 쓰는 **순서가 계약**이기 때문이다 — shard → stats → meta 맨 마지막. meta가 커밋
 * 지점이라 순서를 뒤집으면 fingerprint가 맞아떨어지는 채로 내용만 낡은 캐시가 생기고,
 * 그건 **조용히 틀린 검색 결과**가 된다(캐시 미스보다 나쁘다).
 *
 * 그 순서를 Node가 다시 구현하면 규칙이 두 벌이 된다. 한 벌만 남긴다.
 *
 * ## ⚠️ 왜 stdout이 아니라 임시 파일인가
 *
 * Windows 릴리즈 빌드는 GUI 서브시스템이라 부모 터미널의 stdout에 쓸 수 없다
 * (`headless.rs` 참고). 덤으로 큰 vault의 export는 수십 MB라 파일이 파이프보다 낫다.
 */

export interface IndexProgress {
  (message: string): void;
}

export interface IndexOutcome {
  ok: true;
  vaultRoot: string;
  cacheDir: string;
  cacheKey: string;
  cacheVersion: number;
  fingerprint: string;
  noteCount: number;
  shardCount: number;
  perShard: number[];
  exportMs: number;
  buildMs: number;
  commitMs: number;
  /** `--dry-run`이면 커밋하지 않았다는 뜻. */
  committed: boolean;
  appExe: string;
}

export class IndexError extends Error {
  constructor(
    message: string,
    readonly remedy?: string,
  ) {
    super(message);
    this.name = "IndexError";
  }
}

interface HeadlessFailure {
  ok: false;
  error: string;
}

/**
 * 능력 탐지에 주는 시간. `cache-info`는 vault를 훑지 않으므로 1초 안에 끝난다 —
 * 넉넉히 잡아도 이 정도면 충분하고, **구버전 앱을 오래 띄워두지 않는** 값이다.
 */
const PROBE_TIMEOUT_MS = 15_000;

/** 실제 작업에 주는 시간. 19,000노트 스캔이 1분쯤이라 여유를 뒀다. */
const WORK_TIMEOUT_MS = 10 * 60 * 1000;

/** 시간 초과. 호출부가 "구버전이라 GUI가 떴다"와 "진짜 오래 걸린다"를 구분하려고 쓴다. */
class HeadlessTimeout extends Error {}

/** 헤드리스 한 번 호출. 결과 JSON을 돌려준다. */
function runHeadless(
  exe: string,
  args: string[],
  outFile: string,
  timeoutMs: number,
): Record<string, unknown> {
  const r = spawnSync(exe, args, {
    // stdout/stderr는 Windows GUI 빌드에서 어차피 비어 있다. 진단은 결과 파일이 준다.
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: timeoutMs,
  });

  if (r.error) {
    // Node는 시간 초과를 `error.code === "ETIMEDOUT"`으로 알린다. 이건 다르게 다뤄야 한다.
    if ((r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
      throw new HeadlessTimeout(`${timeoutMs}ms 안에 끝나지 않았다`);
    }
    throw new IndexError(`앱 실행 실패: ${r.error.message}`, `실행파일: ${exe}`);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(outFile, "utf8")) as Record<string, unknown>;
  } catch {
    // 결과 파일조차 없으면 앱이 시작조차 못 한 것이다 — stderr가 있으면 그게 유일한 단서다.
    const stderr = (r.stderr ?? "").toString().trim();
    throw new IndexError(
      `헤드리스 결과를 읽지 못했다 (exit ${r.status ?? "?"})`,
      stderr ? `앱 stderr: ${stderr}` : `실행파일이 맞는지 확인: ${exe}`,
    );
  }

  if (parsed.ok !== true) {
    throw new IndexError(String((parsed as unknown as HeadlessFailure).error ?? "알 수 없는 실패"));
  }
  return parsed;
}

/**
 * 이 실행파일이 `--headless`를 아는지 확인한다.
 *
 * 아는 빌드는 즉시 JSON을 쓰고 끝난다. 모르는 빌드는 인자를 무시하고 **GUI를 띄운 채
 * 돌아오지 않는다** — 그래서 짧은 제한을 걸고, 걸리면 그 사실을 그대로 말한다.
 */
function probeHeadless(exe: string, outFile: string, vault: string): void {
  try {
    runHeadless(
      exe,
      ["--headless", "cache-info", "--vault", vault, "--out", outFile],
      outFile,
      PROBE_TIMEOUT_MS,
    );
  } catch (e) {
    if (e instanceof HeadlessTimeout) {
      throw new IndexError(
        "설치된 Lapis가 --headless 를 모른다 (구버전)",
        "앱을 최신 버전으로 업데이트하라. 옛 빌드는 모르는 인자를 무시하고 창을 띄운다",
      );
    }
    throw e;
  }
}

/** 실제 작업의 시간 초과를 사람이 읽을 오류로. 여기서는 구버전 가능성이 이미 배제됐다. */
function work<T>(fn: () => T, what: string): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HeadlessTimeout) {
      throw new IndexError(
        `${what}이(가) ${WORK_TIMEOUT_MS / 1000}초 안에 끝나지 않았다`,
        "vault가 매우 크거나 앱이 멈췄다. --dry-run 으로 규모를 먼저 재 보라",
      );
    }
    throw e;
  }
}

export interface RunIndexOptions {
  vault: string;
  /** 빌드까지만 하고 캐시에 커밋하지 않는다. */
  dryRun?: boolean;
  onProgress?: IndexProgress;
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export function runIndex(opts: RunIndexOptions): IndexOutcome {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const say = opts.onProgress ?? (() => {});

  const located = locateApp(platform, env);
  if (!located.ok) {
    throw new IndexError("Lapis 실행파일을 찾지 못했다", locateRemedy(located.tried));
  }
  const exe = located.exe;
  say(`앱: ${exe}${located.source === "env" ? " (LAPIS_APP)" : ""}`);

  const tmp = mkdtempSync(path.join(os.tmpdir(), "lapis-index-"));
  try {
    // ── ⓪ 능력 탐지 ──────────────────────────────────────────────────────────
    //
    // ⚠️ **이 단계를 빼면 구버전 앱에서 CLI가 영원히 매달린다.** 옛 빌드는 모르는 인자를
    // 그냥 무시하고 **평범하게 GUI를 띄운다.** 그러면 spawnSync는 사용자가 창을 닫을
    // 때까지 돌아오지 않는다 — 실제로 겪었다(창이 뜬 채 10분 뒤 타임아웃).
    //
    // `cache-info`는 vault를 훑지 않아 1초 안에 끝난다. 안 끝나면 그건 곧 "이 실행파일은
    // --headless를 모른다"는 뜻이고, 그걸 **비싼 스캔 전에** 알아야 한다.
    probeHeadless(exe, path.join(tmp, "probe.json"), opts.vault);

    // ── ① export ─────────────────────────────────────────────────────────────
    const exportFile = path.join(tmp, "export.json");
    say("vault를 훑는 중…");
    const t0 = Date.now();
    const exported = work(
      () =>
        runHeadless(
          exe,
          ["--headless", "export-index", "--vault", opts.vault, "--out", exportFile],
          exportFile,
          WORK_TIMEOUT_MS,
        ),
      "vault 스캔",
    );
    const exportMs = Date.now() - t0;

    const contents = exported.contents as NoteContentIn[];
    const linkInfos = exported.link_infos as unknown[];
    const files = exported.files as unknown[];
    const fingerprint = String(exported.fingerprint);
    say(
      `노트 ${contents.length}개 · ${(statSync(exportFile).size / 1024 / 1024).toFixed(1)} MB · ${exportMs} ms`,
    );

    // ── ② shard 빌드 ─────────────────────────────────────────────────────────
    say("풀텍스트 인덱스를 만드는 중…");
    const t1 = Date.now();
    const built = buildShards(contents);
    const buildMs = Date.now() - t1;
    say(`shard ${built.shardCount}개 [${built.perShard.join(", ")}] · ${buildMs} ms`);

    const maxShards = Number(exported.max_shards);
    // Rust가 알려준 상한을 Node가 다시 정하지 않는다. 넘으면 여기서 멈춘다 — 커밋을
    // 시도해봐야 Rust가 거부할 뿐이고, 그때는 이미 임시 파일을 다 쓴 뒤다.
    if (Number.isFinite(maxShards) && built.shardCount > maxShards) {
      throw new IndexError(
        `shard ${built.shardCount}개는 상한 ${maxShards}을 넘는다`,
        "vault가 지원 범위를 벗어났다. 저장소 이슈로 남겨라",
      );
    }

    const outcome: IndexOutcome = {
      ok: true,
      vaultRoot: String(exported.vault_root),
      cacheDir: String(exported.cache_dir),
      cacheKey: String(exported.cache_key),
      cacheVersion: Number(exported.cache_version),
      fingerprint,
      noteCount: contents.length,
      shardCount: built.shardCount,
      perShard: built.perShard,
      exportMs,
      buildMs,
      commitMs: 0,
      committed: false,
      appExe: exe,
    };

    if (opts.dryRun) {
      say("--dry-run — 캐시에 쓰지 않았다");
      return outcome;
    }

    // ── ③ commit ─────────────────────────────────────────────────────────────
    const importFile = path.join(tmp, "import.json");
    const resultFile = path.join(tmp, "result.json");
    writeFileSync(
      importFile,
      JSON.stringify({ fingerprint, link_infos: linkInfos, files, shards: built.shards }),
      "utf8",
    );
    say("캐시에 커밋하는 중…");
    const t2 = Date.now();
    work(
      () =>
        runHeadless(
          exe,
          [
            "--headless",
            "import-index",
            "--vault",
            opts.vault,
            "--in",
            importFile,
            "--out",
            resultFile,
          ],
          resultFile,
          WORK_TIMEOUT_MS,
        ),
      "캐시 커밋",
    );
    outcome.commitMs = Date.now() - t2;
    outcome.committed = true;
    return outcome;
  } finally {
    // 임시 파일은 수십 MB다. 실패해도 반드시 지운다.
    rmSync(tmp, { recursive: true, force: true });
  }
}
