/**
 * Lapis 캐시 어댑터 — 앱이 만든 `search-cache`를 읽는다.
 *
 * **경계에서 즉시 정규화한다**: 모든 경로는 vault 상대 POSIX + **NFC**. macOS 파일명은
 * NFD라서 눈으로는 구별이 안 되는데 문자열 비교는 실패한다(2026-08-12 실물 사고 —
 * `MEMORY.md`의 한글 링크를 맞게 썼는데도 참조 검사가 계속 깨졌다).
 *
 * MCP는 **인덱스를 만들지 않는다.** 생산자는 앱이다 → stale이면 실패시키고 앱을 켜라고 한다.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import path from "node:path";
import type { LinkInfo } from "./entry.ts";

/** 앱의 `search_cache.rs` `CACHE_VERSION`과 일치해야 한다. 어긋나면 `version_skew`. */
export const CACHE_VERSION = 7;

/**
 * 캐시 위치 — **두 곳을 본다.**
 *
 * 릴리즈는 `com.lapis.dev/`, dev 빌드는 `com.lapis.dev-dev/`를 쓴다(`src-tauri/src/paths.rs`).
 * 예전엔 하나였고 두 빌드가 서로의 캐시를 번갈아 덮어써 19,000노트를 반복 재인덱싱했다.
 * 분리한 뒤로는 **어느 빌드를 띄웠든 최신 인덱스를 찾아 쓰려면 둘 다 봐야 한다** —
 * 릴리즈 경로만 보면 dev만 띄운 상태에서 영구 `stale`이 된다.
 *
 * `LAPIS_CACHE_DIR`로 덮어쓸 수 있다 — 테스트 픽스처가 쓴다.
 *
 * ⚠️ **모듈 상수로 굳히지 말 것.** 상수로 뒀더니 import 시점에 env를 읽어서 테스트의
 * `LAPIS_CACHE_DIR`이 전혀 안 먹었다(라이브 캐시를 읽어 24건이 한꺼번에 깨졌다).
 * 앱에서도 같은 함정을 겪었다 — 창 라벨을 모듈 로드 시점에 굳혀 보조 창이 남의 vault를
 * 열었다(`stores/vault.ts`의 `vaultStorageKey` 주석). **호출 시점에 계산한다.**
 */
function cacheDirs(): string[] {
  const override = process.env.LAPIS_CACHE_DIR;
  if (override) return [override];
  const base = path.join(homedir(), "Library/Application Support");
  return [
    path.join(base, "com.lapis.dev", "search-cache"), // 릴리즈
    path.join(base, "com.lapis.dev-dev", "search-cache"), // dev 빌드
  ];
}

export const norm = (s: string): string => s.normalize("NFC");

/**
 * `vault` 인자의 정규형. **`resolveVault`와 캐시 재사용 판정이 같은 함수를 써야 한다** —
 * 한쪽만 `norm()`을 하면 후행 슬래시 하나로 매 호출 전체 재로드가 일어난다(실측).
 */
export const normalizeVaultArg = (v: string): string =>
  norm(path.resolve(v)).replace(/\/+$/, "");

export type ErrorKind =
  | "cache_absent"
  | "version_skew"
  | "corrupt"
  | "stale"
  | "vault_ambiguous"
  | "vault_not_found"
  | "path_not_indexed"
  | "shard_incomplete"
  | "no_criteria";

export class LapisError extends Error {
  constructor(
    readonly kind: ErrorKind,
    message: string,
    readonly remedy: string,
  ) {
    super(message);
  }
  toJSON() {
    return { error: { kind: this.kind, message: this.message, remedy: this.remedy } };
  }
}

interface RawMeta {
  version: number;
  fingerprint: string;
  link_infos: LinkInfo[];
  shard_count: number;
}

export interface VaultCache {
  /** 캐시 파일 접두 (앱의 `vault_key`). */
  key: string;
  dir: string;
  metaFile: string;
  /** vault 루트 절대 경로 (NFC). `source_path` 공통 접두로 역산. */
  root: string;
  fingerprint: string;
  shardCount: number;
  infos: LinkInfo[];
}

interface Candidate {
  key: string;
  dir: string;
  file: string;
  /** null = 이 후보를 쓸 수 없다. 이유는 `bad`가 구분한다. */
  meta: RawMeta | null;
  /** 왜 못 쓰는가. `null`이면 정상 후보다. */
  bad: "corrupt" | "version_skew" | null;
  version: number;
  root: string | null;
  size: number;
  /** meta 파일 mtime. 같은 vault가 두 디렉터리에 있을 때 최신을 고르는 기준. */
  mtimeMs: number;
}

function listCandidates(): Candidate[] {
  const out: Candidate[] = [];
  let sawDir = false;
  const dirs = cacheDirs();
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    sawDir = true;
    for (const n of names) {
      if (!n.endsWith(".meta.json.gz")) continue;
      const file = path.join(dir, n);
      const key = n.slice(0, -".meta.json.gz".length);
      let parsed: RawMeta;
      try {
        parsed = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
      } catch {
        // ⚠️ 손상을 `version_skew`와 섞지 말 것. 예전엔 둘을 같은 통에 넣고 `size: -1`로
        // 표시했는데, 크기 비교가 `size < 0`을 "더 클 수도 있음"으로 읽어 **손상 파일
        // 하나가 정상 vault 질의를 전부 막았다.** 게다가 메시지가
        // "구버전 캐시가 지금 고른 것보다 크다 … v-1 -1건"으로 나가 원인을 못 짚었다.
        out.push({
          key,
          dir,
          file,
          meta: null,
          bad: "corrupt",
          version: -1,
          root: null,
          size: -1,
          mtimeMs: 0,
        });
        continue;
      }
      if (parsed.version !== CACHE_VERSION) {
        // 아래 힌트 추출은 meta 스키마가 v6↔v7 동일하다는 사실에 기댄다.
        // ⚠️ 버려도 되는 정보가 아니다. **크기와 root는 힌트로 살린다** — 이걸 버리면
        // "다른 vault의 잔재 캐시 1건이 구버전"이라는 이유로 정상 vault 질의가 전부
        // 막힌다(실제로 그랬다: 35노트·1노트짜리 v6 잔재가 19,222노트 vault를 세웠다).
        // meta 스키마는 v6↔v7이 동일하다(바뀐 건 shard다). 다만 **힌트로만** 쓴다 —
        // 읽히지 않으면 크기를 모르는 것으로 두고 보수적으로 실패시킨다.
        let hintRoot: string | null = null;
        let hintSize = -1;
        try {
          const infos = parsed.link_infos ?? [];
          hintSize = infos.length;
          hintRoot = deriveRoot(infos.map((i) => norm(i.source_path)));
        } catch {
          /* 힌트 없음 — size -1로 남긴다 */
        }
        out.push({
          key,
          dir,
          file,
          meta: null,
          bad: "version_skew",
          version: parsed.version,
          root: hintRoot,
          size: hintSize,
          mtimeMs: 0,
        });
        continue;
      }
      for (const i of parsed.link_infos) i.source_path = norm(i.source_path);
      out.push({
        key,
        dir,
        file,
        meta: parsed,
        bad: null,
        version: parsed.version,
        root: deriveRoot(parsed.link_infos.map((i) => i.source_path)),
        size: parsed.link_infos.length,
        mtimeMs: statSync(file).mtimeMs,
      });
    }
  }
  if (!sawDir) {
    throw new LapisError(
      "cache_absent",
      `캐시 디렉터리가 없다: ${dirs.join(" · ")}`,
      "Lapis 앱을 실행해 vault를 한 번 열어라. 인덱스 생산자는 앱이다.",
    );
  }
  return out;
}

/**
 * vault 루트 = `source_path`들의 공통 **디렉터리** 접두.
 *
 * ⚠️ `LinkInfo.source_path`는 **절대 경로**다. 그래서 meta에 `vault_path` 필드를 추가하지
 * 않아도 루트를 알 수 있다 — 계획서 §5-3이 불필요해진 근거.
 * ⚠️ 최상위 폴더가 하나뿐인 vault에선 접두가 한 단계 깊게 잡힌다(알려진 한계).
 */
function deriveRoot(paths: string[]): string | null {
  if (paths.length === 0) return null;
  let parts = paths[0].split("/");
  for (const p of paths) {
    const q = p.split("/");
    let k = 0;
    while (k < parts.length && k < q.length && parts[k] === q[k]) k++;
    parts = parts.slice(0, k);
    if (parts.length <= 1) break;
  }
  // 경로가 2개 이상이면 세그먼트 비교가 파일명에서 갈리므로 남은 조각은 전부 디렉터리다.
  if (paths.length === 1) parts = parts.slice(0, -1);
  return parts.join("/") || "/";
}

/**
 * vault 해소 — **경로로 대조한다.**
 *
 * ⚠️ 스파이크는 "`link_infos` 최대"를 폴백으로 썼는데, `CACHE_VERSION`이 오르면 **최대
 * 후보가 skew로 탈락하고 차선이 조용히 승격**됐다. 실제로 v7 bump 직후 에러 없이
 * `returned=0`이 나왔다 — 다른 vault의 작은 캐시를 검색한 것이다. 그래서:
 *
 * - `vaultArg`가 오면 **root 일치**로만 고른다. skew면 폴백하지 말고 `version_skew`.
 * - 없으면 최대 후보를 쓰되, **최대 후보가 skew면 실패**시킨다(조용한 승격 금지).
 * - 최대가 동률이면 `vault_ambiguous`.
 */
export function resolveVault(vaultArg?: string): VaultCache {
  const cands = listCandidates();
  if (cands.length === 0) {
    throw new LapisError(
      "cache_absent",
      "meta 캐시가 하나도 없다.",
      "Lapis 앱에서 vault를 한 번 열어라.",
    );
  }

  const usable = cands.filter((c): c is Candidate & { meta: RawMeta } => c.meta !== null);
  const skewed = cands.filter((c) => c.bad === "version_skew");
  const corrupt = cands.filter((c) => c.bad === "corrupt");

  if (vaultArg) {
    const want = normalizeVaultArg(vaultArg);
    // 같은 vault가 릴리즈·dev 양쪽에 있을 수 있다 → **최신 meta**를 고른다.
    const hits = usable.filter((c) => c.root === want).sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (hits[0]) return toCache(hits[0], hits[0].meta);
    // 요청한 vault가 **바로 그** skew 후보인지 정확히 말해준다.
    const skewedHit = skewed.find((c) => c.root === want);
    if (skewedHit) {
      throw new LapisError(
        "version_skew",
        `요청한 vault의 캐시가 v${skewedHit.version}, 기대 v${CACHE_VERSION}: ${want}`,
        "Lapis 앱을 최신으로 올리고 그 vault를 열어 인덱스를 재빌드하라.",
      );
    }
    throw new LapisError(
      "vault_not_found",
      `캐시에 없는 vault: ${want}\n있는 것: ${cands
        .map((c) => `${c.root ?? "(root 불명)"}${c.meta ? "" : ` [v${c.version} skew]`}`)
        .join(" · ")}`,
      "Lapis 앱에서 그 vault를 한 번 열어라.",
    );
  }

  // 손상 파일은 **어느 vault인지 알 수 없다**(파싱 자체가 안 된다). 그래서 정상 후보를
  // 막지 않고 경고만 남긴다 — 막으면 남의 쓰레기 파일 하나로 도구가 죽는다.
  // 쓸 수 있는 후보가 아예 없을 때만 `corrupt`로 실패한다.
  if (usable.length === 0 && corrupt.length > 0 && skewed.length === 0) {
    throw new LapisError(
      "corrupt",
      `읽을 수 없는 캐시 ${corrupt.length}개: ${corrupt.map((c) => c.file).join(" · ")}`,
      "해당 파일을 지우고 Lapis 앱에서 vault를 열어 인덱스를 재빌드하라.",
    );
  }
  if (corrupt.length > 0) {
    console.error(
      `[lapis-mcp] 읽을 수 없는 캐시 ${corrupt.length}개를 건너뛴다: ` +
        corrupt.map((c) => c.file).join(" · "),
    );
  }

  if (usable.length === 0) {
    throw new LapisError(
      "version_skew",
      `유효한 v${CACHE_VERSION} 캐시가 없다. 발견: ${skewed.map((c) => `v${c.version}`).join(", ") || "없음"}`,
      "Lapis 앱을 최신으로 올리고 vault를 열어 인덱스를 재빌드하라.",
    );
  }

  const maxUsable = Math.max(...usable.map((c) => c.size));
  // **skew 후보가 고른 것보다 클 수 있을 때만** 막는다. 작은 잔재 하나 때문에 정상
  // vault를 세우면 안 되고, 반대로 더 큰 vault가 빠진 걸 모르고 검색해도 안 된다.
  // 크기를 못 읽은 후보(size < 0)는 "클 수도 있다"로 보아 보수적으로 막는다.
  const blocking = skewed.filter((c) => c.size < 0 || c.size > maxUsable);
  if (blocking.length > 0) {
    throw new LapisError(
      "version_skew",
      `구버전 캐시가 지금 고른 것보다 크다 — 조용히 작은 vault를 검색하지 않는다. ` +
        blocking.map((c) => `${c.root ?? "(불명)"} v${c.version} ${c.size}건`).join(" · "),
      `vault 인자로 대상을 지정하거나, 앱에서 해당 vault를 열어 재빌드하라. ` +
        `지금 쓸 수 있는 것: ${usable.map((c) => `${c.root}(${c.size}건)`).join(" · ")}`,
    );
  }

  const top = usable.filter((c) => c.size === maxUsable);
  // ⚠️ **같은 vault가 두 디렉터리에 있는 건 동률이 아니다.** dev와 릴리즈가 같은 vault를
  //    색인하면 크기가 당연히 같다 — 이걸 ambiguous로 막으면 정상 상황에서 도구가 죽는다.
  //    root가 같으면 **최신 meta**를 고른다.
  const distinctRoots = new Set(top.map((c) => c.root));
  if (distinctRoots.size > 1) {
    throw new LapisError(
      "vault_ambiguous",
      `서로 다른 vault ${distinctRoots.size}개가 동률이다(각 ${maxUsable}건).`,
      `vault 인자를 명시하라. 후보: ${[...distinctRoots].join(" · ")}`,
    );
  }
  const freshest = [...top].sort((a, b) => b.mtimeMs - a.mtimeMs)[0];
  return toCache(freshest, freshest.meta);
}

function toCache(c: Candidate, meta: RawMeta): VaultCache {
  if (!c.root) {
    throw new LapisError("corrupt", `vault 루트를 산출할 수 없다: ${c.file}`, "앱에서 재빌드하라.");
  }
  return {
    key: c.key,
    dir: c.dir,
    metaFile: c.file,
    root: c.root,
    fingerprint: meta.fingerprint,
    shardCount: meta.shard_count,
    infos: meta.link_infos,
  };
}

/**
 * shard 전량 로드 — 하나라도 결손·skew면 **fail-closed**.
 *
 * 부분 인덱스로 검색하면 "검색했는데 안 나온다"가 되고, 소비자는 그걸 "없다"로 읽는다.
 * 앱도 v7에서 같은 결정을 했다(`stores/vault.ts`).
 */
export function loadShards(vc: VaultCache): string[] {
  if (vc.shardCount === 0) {
    throw new LapisError(
      "shard_incomplete",
      "meta의 shard_count가 0 — 앱이 풀텍스트 인덱스를 저장하지 못한 스냅샷이다.",
      "Lapis 앱을 실행하면 재빌드로 복구된다. 구조 질의(doc_kind·topic·tag·backlinks_of)는 지금도 된다.",
    );
  }
  const out: string[] = [];
  for (let i = 0; i < vc.shardCount; i++) {
    const f = path.join(vc.dir, `${vc.key}.shard${i}.json.gz`);
    let shard: { version: number; shard_id: number; fingerprint: string; minisearch_json: string };
    try {
      shard = JSON.parse(gunzipSync(readFileSync(f)).toString("utf8"));
    } catch (e) {
      throw new LapisError(
        "shard_incomplete",
        `shard ${i}/${vc.shardCount} 로드 실패 — ${(e as Error).message}`,
        "앱에서 인덱스를 재빌드하라. 부분 인덱스로는 검색하지 않는다.",
      );
    }
    // 앱의 `shard_reject_reason`과 같은 판정 — 순서까지 맞춘다(version 먼저).
    if (shard.version !== CACHE_VERSION) {
      throw new LapisError(
        "version_skew",
        `shard ${i} v${shard.version} ≠ v${CACHE_VERSION}`,
        "앱을 최신으로 올리고 재빌드하라.",
      );
    }
    if (shard.shard_id !== i) {
      throw new LapisError(
        "shard_incomplete",
        `shard ${i} 내용의 shard_id=${shard.shard_id} — 남의 shard다.`,
        "앱에서 인덱스를 재빌드하라.",
      );
    }
    if (shard.fingerprint !== vc.fingerprint) {
      throw new LapisError(
        "shard_incomplete",
        `shard ${i} fingerprint=${shard.fingerprint} ≠ meta=${vc.fingerprint} — 다른 스냅샷이다.`,
        "Lapis 앱을 실행하면 자동 복구된다(v7 자기복구 경로).",
      );
    }
    out.push(shard.minisearch_json);
  }
  return out;
}

/**
 * staleness 판정 — **mtime 프록시**다.
 *
 * ⚠️ meta의 `fingerprint`는 Rust `std::DefaultHasher`(SipHash-1-3)로 만든다. std가 릴리즈 간
 * 값 안정성을 **부정**하므로 JS로 재현할 수 없다 → `disk_fingerprint`를 계산할 방법이 없다.
 * 대신 "vault 안 가장 최근 `.md` mtime > meta 파일 mtime"이면 stale로 본다.
 *
 * **놓치는 것**: 삭제만 있고 수정이 없는 변경. 그 경우 지워진 노트가 결과에 남는다.
 * 근본 해결은 앱이 fingerprint도 FNV-1a로 바꾸는 것(계획서 §5-7).
 */
export function checkStale(vc: VaultCache): { stale: boolean; newestMs: number; metaMs: number } {
  const metaMs = statSync(vc.metaFile).mtimeMs;
  let newestMs = 0;
  const walk = (dir: string): void => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const m = statSync(p).mtimeMs;
        if (m > newestMs) newestMs = m;
      }
    }
  };
  walk(vc.root);
  return { stale: newestMs > metaMs, newestMs, metaMs };
}
