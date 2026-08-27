/**
 * Lapis 캐시 어댑터 — 앱이 만든 `search-cache`를 읽는다.
 *
 * **경계에서 즉시 정규화한다**: 모든 경로는 vault 상대 POSIX + **NFC**. macOS 파일명은
 * NFD라서 눈으로는 구별이 안 되는데 문자열 비교는 실패한다(2026-08-12 실물 사고 —
 * `MEMORY.md`의 한글 링크를 맞게 썼는데도 참조 검사가 계속 깨졌다).
 *
 * MCP는 **인덱스를 만들지 않는다.** 생산자는 앱이다 → stale이면 실패시키고 앱을 켜라고 한다.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { homedir } from "node:os";
import path from "node:path";
import type { LinkInfo } from "./entry.ts";

/**
 * 앱의 `search_cache.rs` `CACHE_VERSION`과 **일치해야 한다.** 어긋나면 모든 질의가
 * `version_skew`로 실패한다 — 캐시가 멀쩡해도 도구가 통째로 죽는다.
 *
 * ⚠️ **앱에서 bump할 때 여기도 같이 올린다.** 실제로 v8(fingerprint 해시 명세화)에서
 * 한쪽만 올라간 채 릴리스됐다. 테스트는 못 잡는다 — 픽스처가 *이 상수*로 캐시를 쓰고
 * MCP도 *이 상수*로 읽으니 양쪽이 늘 일치한다. 그래서 Rust 파일을 직접 읽어 대조하는
 * 가드를 따로 뒀다(`mcp/cacheVersion.test.ts`).
 */
export const CACHE_VERSION = 9;

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
/**
 * Tauri `app_data_dir`의 **부모** — 앱이 `paths.rs`에서 쓰는 것과 같은 자리를 짚어야 한다.
 * 어긋나면 MCP가 캐시를 영영 못 찾고 `cache_absent`만 낸다.
 *
 * | OS      | Tauri app_data_dir 부모                  |
 * |---------|------------------------------------------|
 * | macOS   | `~/Library/Application Support`          |
 * | Windows | `%APPDATA%` (Roaming)                    |
 * | Linux   | `$XDG_DATA_HOME` 또는 `~/.local/share`   |
 */
function appDataBase(): string {
  if (process.platform === "win32") {
    return process.env.APPDATA ?? path.join(homedir(), "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(homedir(), "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME ?? path.join(homedir(), ".local", "share");
}

function cacheDirs(): string[] {
  const override = process.env.LAPIS_CACHE_DIR;
  if (override) return [override];
  return [
    path.join(appDataBase(), "com.lapis.dev", "search-cache"), // 릴리즈
    path.join(appDataBase(), "com.lapis.dev-dev", "search-cache"), // dev 빌드
  ];
}

/** 앱의 `settings.rs` `SETTINGS_FILENAME`과 같아야 한다. */
const SETTINGS_FILENAME = "lapis-settings.json";

export type GateState =
  | { enabled: true }
  | { enabled: false; reason: "disabled" | "settings_absent" };

/**
 * 앱 설정의 `mcp_enabled`를 읽는다. **기본은 꺼짐** — 파일이 없으면 켜지 않는다.
 *
 * ⚠️ 경로를 직접 조립하지 말 것. `cacheDirs()`에서 파생시켜야 "릴리즈 캐시를 읽으면서
 * dev 설정을 보는" 어긋남이 안 생긴다(`paths.rs`가 dev만 `-dev` 형제 디렉터리를 쓴다).
 * 설정 파일은 앱 데이터 루트에 있고 `search-cache/`는 그 하위라 **부모**가 답이다.
 * 둘 다 있으면 앞선 후보(릴리즈)가 이긴다.
 *
 * ⚠️ 이 값은 서버 **프로세스 기동**과 무관하다. stdio 서버는 MCP 클라이언트가 띄운다 —
 * 앱이 정할 수 있는 건 질의를 받아줄지뿐이다.
 */
export function readMcpGate(): GateState {
  for (const dir of cacheDirs()) {
    const file = path.join(path.dirname(dir), SETTINGS_FILENAME);
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue; // 이 후보엔 설정이 없다 — 다음 후보로
    }
    try {
      const parsed = JSON.parse(raw) as { mcp_enabled?: unknown };
      // 명시적 true만 켬으로 본다. 구버전 JSON엔 필드 자체가 없다.
      return parsed.mcp_enabled === true
        ? { enabled: true }
        : { enabled: false, reason: "disabled" };
    } catch {
      // 손상된 설정을 "켜짐"으로 읽으면 안 된다 — 닫힌 쪽으로 실패한다.
      return { enabled: false, reason: "disabled" };
    }
  }
  return { enabled: false, reason: "settings_absent" };
}

/**
 * 설정 파일 경로 후보. `readMcpGate`와 **같은 규칙**으로 찾는다.
 *
 * ⚠️ 경로를 직접 조립하지 말 것 — `cacheDirs()`에서 파생시켜야 릴리즈/dev가 안 어긋난다.
 */
export function settingsFileCandidates(): string[] {
  return cacheDirs().map((d) => path.join(path.dirname(d), SETTINGS_FILENAME));
}

/**
 * 사용자 정의 CSS를 끈다 — **앱이 아예 안 뜰 때의 탈출구**.
 *
 * `[data-lapis="app"] { display: none }` 한 줄이면 앱 안에서는 되돌릴 수 없다.
 * 패닉 단축키가 1차 방어선이고, 이건 그것도 못 누를 때(앱이 안 뜰 때)를 위한 것이다.
 *
 * ⚠️ **CSS 내용은 지우지 않는다.** 끄기만 한다 — 사용자가 쓴 것을 도구가 말없이
 * 날리면 안 된다. 고쳐서 다시 켜는 것이 정상 흐름이다.
 *
 * @returns 실제로 고친 파일들. 빈 배열이면 설정 파일이 없다는 뜻이다.
 */
export function disableCustomCss(): string[] {
  const touched: string[] = [];
  for (const file of settingsFileCandidates()) {
    let raw: string;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // 손상된 설정을 덮어쓰면 다른 설정까지 날린다. 건너뛰고 사실대로 보고한다.
      continue;
    }
    if (parsed.custom_css_enabled === false) continue; // 이미 꺼져 있다
    parsed.custom_css_enabled = false;
    writeFileSync(file, JSON.stringify(parsed, null, 2) + "\n", "utf8");
    touched.push(file);
  }
  return touched;
}

/** 게이트가 닫혔을 때의 실패. 조치가 둘로 갈려서 remedy를 나눈다. */
export function mcpDisabledError(state: Extract<GateState, { enabled: false }>): LapisError {
  const fullyDisable =
    "프로세스까지 막으려면 ~/.claude.json의 mcpServers.lapis를 제거해야 한다 " +
    "— stdio 서버는 MCP 클라이언트가 띄우므로 앱 설정으로는 기동을 막지 못한다.";
  return state.reason === "settings_absent"
    ? new LapisError(
        "mcp_disabled",
        "Lapis 설정 파일을 찾지 못했다 — MCP 질의는 기본 꺼짐이다.",
        `Lapis 앱을 한 번 실행한 뒤 설정 → "MCP 질의"를 켜라. ${fullyDisable}`,
      )
    : new LapisError(
        "mcp_disabled",
        "MCP 질의가 꺼져 있다.",
        `Lapis 앱 → 설정 → "MCP 질의"를 켜라. ${fullyDisable}`,
      );
}

export const norm = (s: string): string => s.normalize("NFC");

/**
 * **경로 전용** 정규형 — NFC에 더해 구분자를 `/`로 통일한다.
 *
 * `norm()`을 그대로 쓰지 않는 이유 — `norm()`은 태그에도 쓰인다(`tech/svelte5`).
 * 거기서 `\`를 `/`로 바꾸면 데이터를 변조하게 된다. 경로만 이 함수를 쓴다.
 *
 * ⚠️ Windows에서 `path.resolve`·`path.join`·`readdir` 결과는 `\` 구분자다.
 * 캐시 meta의 root와 vault 인자를 한쪽만 정규화하면 **같은 vault가 서로 다른 것으로
 * 보여** `vault_not_found`가 난다. 경로가 드나드는 모든 경계에서 이 함수를 통과시킨다.
 */
export const normPath = (s: string): string => norm(s).replace(/\\/g, "/");

/**
 * `vault` 인자의 정규형. **`resolveVault`와 캐시 재사용 판정이 같은 함수를 써야 한다** —
 * 한쪽만 `norm()`을 하면 후행 슬래시 하나로 매 호출 전체 재로드가 일어난다(실측).
 */
export const normalizeVaultArg = (v: string): string =>
  normPath(path.resolve(v)).replace(/\/+$/, "");

export type ErrorKind =
  | "cache_absent"
  | "version_skew"
  | "corrupt"
  | "stale"
  | "vault_ambiguous"
  | "vault_not_found"
  | "path_not_indexed"
  | "name_ambiguous"
  | "shard_incomplete"
  | "no_criteria"
  | "mcp_disabled";

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
          hintRoot = deriveRoot(infos.map((i) => normPath(i.source_path)));
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
      for (const i of parsed.link_infos) i.source_path = normPath(i.source_path);
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
 * staleness — **보고하되 막지 않는다.**
 *
 * ⚠️ 계획서는 `stale`을 fail-closed로 규정했지만 **실측이 그 전제를 뒤집었다.**
 * 전제는 "앱이 2초 안에 갱신하니 stale 창이 좁다"였는데:
 *
 * - 커밋까지 **10~20초** 걸린다(shard 8개 → meta 마지막, `search_cache.rs` v7).
 * - 살아 있는 vault는 그 사이에도 계속 쓰인다. 2026-08-13 실측에서 **19,202개 중 3개
 *   (0.016%)** 가 캐시보다 새로웠고, 그 상태로 모든 질의가 실패했다.
 *
 * 0.016% 때문에 도구 전체를 세우는 건 비례하지 않고, 무엇보다 **하드 실패 자체가 판단**이다
 * — 이 서버의 원칙은 "판단하지 않는다"이다. 그래서 몇 개가 얼마나 새로운지 **응답에 실어
 * 보내고** 판단은 Claude Code에 맡긴다. 조용히 낡은 답을 주는 것과는 다르다.
 *
 * ⚠️ mtime **프록시**다. meta의 `fingerprint`가 Rust `std::DefaultHasher`(std가 값 안정성을
 * 부정)라 JS로 재현할 수 없다. **삭제만 있고 수정이 없는 변경은 놓친다.**
 */
export interface Staleness {
  /**
   * **정확 판정** — 지금 vault의 fingerprint가 캐시의 것과 다른가.
   *
   * v8부터 앱의 fingerprint 해시가 명세돼(`vault.rs::fingerprint_of`) 여기서 그대로
   * 재현할 수 있다. 그 전에는 `DefaultHasher`라 재현이 불가능했고, 그래서 아래
   * `newer_count`(mtime 프록시)로 **추정**할 수밖에 없었다.
   *
   * ⚠️ 프록시가 놓치던 것: **수정만 있고 새 파일은 없는 변경**. 파일을 고쳐도 mtime이
   * 캐시 커밋보다 앞서지 않으면(외부 도구가 mtime을 보존하며 in-place로 쓰는 경우)
   * `newer_count`가 0이라 "최신"이라고 답했다. 이제 size 변화까지 fingerprint가 잡는다.
   */
  changed: boolean;
  /** 캐시 커밋보다 새로운 노트 수. 0이어도 `changed`일 수 있다(위 주석). */
  newer_count: number;
  /** 스캔한 전체 노트 수. */
  total: number;
  /** 가장 새로운 노트가 캐시보다 몇 초 앞서는가. 0이면 mtime 기준으로는 최신. */
  behind_s: number;
  /** 새로운 파일 몇 개(최대 5) — 무엇이 빠졌는지 바로 보이게. */
  sample: string[];
  /** 지금 vault에서 계산한 fingerprint. 캐시의 것과 다르면 `changed`. */
  fingerprint: string;
}

/**
 * 앱과 **같은 디렉터리 건너뛰기 목록**. `vault.rs`의 `SKIP_DIRS`와 일치해야 한다.
 *
 * ⚠️ 어긋나면 fingerprint가 절대 맞지 않는다 — 한쪽은 `node_modules`를 세고
 * 다른 쪽은 안 세니 매 질의가 `changed: true`가 된다.
 */
const SKIP_DIRS = new Set(["node_modules", "target", ".svelte-kit", "build", "dist", ".git"]);

/**
 * 앱이 인덱싱하는 확장자. `vault.rs`의 `is_supported_note_ext`와 일치해야 한다.
 *
 * ⚠️ 예전에 여기는 소문자 `.md`만 봤다. 앱은 `.mmd`도 세고 대소문자도 무시한다 —
 * 그 차이가 그대로 fingerprint 불일치가 된다.
 */
function isNoteFile(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  const ext = name.slice(i + 1).toLowerCase();
  return ext === "md" || ext === "mmd";
}

/** FNV-1a 32비트 한 줄기. `Math.imul`이라 32비트 산술로 끝난다. */
function fnv1a32(seed: number, bytes: Uint8Array): number {
  let h = seed;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const FNV32_OFFSET = 0x811c9dc5;
const UTF8 = new TextEncoder();

/**
 * vault 스냅샷 fingerprint — **`vault.rs::fingerprint_of`와 같은 값을 내야 한다.**
 *
 * 입력 정규형(계약):
 *
 * ```text
 * A: {rel}\0{mtime_ms}\0{size}\n
 * B: {size}\0{mtime_ms}\0{rel}\n
 * ```
 *
 * 항목은 `rel` 오름차순. 숫자는 십진 ASCII. `rel`은 항상 `/` 구분자.
 *
 * ⚠️ **두 구현을 따로 고치지 말 것.** `src-tauri/src/vault.rs`의 테스트와 여기 테스트가
 * **같은 벡터**를 고정한다. 한쪽만 바뀌면 매 질의가 `changed`로 답하기 시작한다.
 */
export function fingerprintOf(
  entries: readonly { rel: string; mtimeMs: number; size: number }[],
): string {
  let a = FNV32_OFFSET;
  let b = FNV32_OFFSET;
  for (const e of entries) {
    a = fnv1a32(a, UTF8.encode(`${e.rel}\0${e.mtimeMs}\0${e.size}\n`));
    b = fnv1a32(b, UTF8.encode(`${e.size}\0${e.mtimeMs}\0${e.rel}\n`));
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * vault를 한 번 훑어 노트별 `{rel, mtimeMs, size}`를 모은다.
 *
 * ⚠️ **`checkStale`이 이미 하던 일이다.** 예전엔 fingerprint를 계산하고 이 목록을
 * 버렸는데, 시간축 질의(`--since` · `--sort recent`)가 정확히 같은 값을 필요로 한다.
 * 따로 훑으면 매 질의에 walk가 둘이 되고, 더 나쁘게는 두 walk 사이에 vault가 바뀌어
 * **fingerprint와 시간 값이 어긋난 답**을 낸다.
 *
 * 정렬 기준은 앱(`walk_md_stats`)과 같아야 한다 — 다르면 fingerprint가 달라진다.
 */
export function walkVaultEntries(vc: VaultCache): {
  entries: { rel: string; mtimeMs: number; size: number }[];
  newer: { ms: number; rel: string }[];
  metaMs: number;
} {
  const metaMs = statSync(vc.metaFile).mtimeMs;
  const entries: { rel: string; mtimeMs: number; size: number }[] = [];
  const newer: { ms: number; rel: string }[] = [];
  const cut = vc.root.endsWith("/") ? vc.root.length : vc.root.length + 1;

  const walk = (dir: string): void => {
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      // 앱의 `walk_md_stats`와 같은 순서로 거른다 — 점 파일, SKIP_DIRS, 확장자.
      if (e.name.startsWith(".")) continue;
      if (SKIP_DIRS.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!isNoteFile(e.name)) continue;

      const st = statSync(p);
      // ⚠️ `Math.floor` — Rust는 `Duration::as_millis()`로 **버림**한다. Node의
      // `mtimeMs`는 부동소수라 그대로 쓰면 소수부가 남아 절대 일치하지 않는다.
      const mtimeMs = Math.floor(st.mtimeMs);
      const rel = normPath(p).slice(cut);
      entries.push({ rel, mtimeMs, size: st.size });
      if (st.mtimeMs > metaMs) newer.push({ ms: st.mtimeMs, rel });
    }
  };
  walk(vc.root);

  // 앱과 같은 정렬 기준(`rel` 문자열 오름차순). 다르면 fingerprint가 달라진다.
  entries.sort((x, y) => (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0));
  newer.sort((a, b) => b.ms - a.ms);
  return { entries, newer, metaMs };
}

export function checkStale(vc: VaultCache): Staleness {
  const { entries, newer, metaMs } = walkVaultEntries(vc);
  const fingerprint = fingerprintOf(entries);
  return {
    changed: fingerprint !== vc.fingerprint,
    newer_count: newer.length,
    total: entries.length,
    behind_s: newer.length === 0 ? 0 : Math.round((newer[0].ms - metaMs) / 1000),
    sample: newer.slice(0, 5).map((n) => n.rel),
    fingerprint,
  };
}

