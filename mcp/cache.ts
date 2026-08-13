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
 * 캐시 위치. `tauri.conf.json`의 `identifier`가 **dev·릴리즈 공통**(`com.lapis.dev`)이라
 * 디렉터리는 하나다.
 *
 * ⚠️ 그래서 **설치된 앱과 `npm run tauri dev`가 같은 캐시를 공유한다.** 두 빌드의
 * `CACHE_VERSION`이 다르면 서로의 캐시를 번갈아 덮어쓰며 19,000노트를 반복 재빌드한다
 * (v7 작업 중 실제로 겪었다). 이 MCP의 결함은 아니지만 알고 있어야 한다.
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
  return override
    ? [override]
    : [path.join(homedir(), "Library/Application Support/com.lapis.dev/search-cache")];
}

export const norm = (s: string): string => s.normalize("NFC");

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
  /** null = 이 후보는 version_skew로 못 읽었다. */
  meta: RawMeta | null;
  version: number;
  root: string | null;
  size: number;
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
      } catch (e) {
        // 손상은 조용히 넘기지 않는다 — 이 vault를 물으면 실패해야 한다.
        out.push({ key, dir, file, meta: null, version: -1, root: null, size: -1 });
        continue;
      }
      if (parsed.version !== CACHE_VERSION) {
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
        out.push({ key, dir, file, meta: null, version: parsed.version, root: hintRoot, size: hintSize });
        continue;
      }
      for (const i of parsed.link_infos) i.source_path = norm(i.source_path);
      out.push({
        key,
        dir,
        file,
        meta: parsed,
        version: parsed.version,
        root: deriveRoot(parsed.link_infos.map((i) => i.source_path)),
        size: parsed.link_infos.length,
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
  const skewed = cands.filter((c) => !c.meta);

  if (vaultArg) {
    const want = norm(path.resolve(vaultArg)).replace(/\/+$/, "");
    const hit = usable.find((c) => c.root === want);
    if (hit) return toCache(hit, hit.meta);
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
  if (top.length > 1) {
    throw new LapisError(
      "vault_ambiguous",
      `동률 캐시 ${top.length}개(각 ${maxUsable}건) — vault를 특정할 수 없다.`,
      `vault 인자를 명시하라. 후보: ${top.map((c) => c.root).join(" · ")}`,
    );
  }
  return toCache(top[0], top[0].meta);
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
