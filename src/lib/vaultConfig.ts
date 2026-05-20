import { readNote } from "$lib/tauri/notes";

/**
 * vault 루트의 `.lapis-vault.json` 설정.
 * - `mem_projects`: claude-mem `project` 컬럼 매칭 필터. `["*"]`이면 전체.
 *   prefix는 Rust 측에서 worktree variant(`Lysn_Epic/...`)를 자동 흡수.
 * - `mem_session_summaries` / `mem_observations`: 메모리 export 시 어느 테이블을 포함할지.
 *   Phase 5.1.a는 session_summaries만 (observations는 후속).
 */
export interface VaultConfig {
  mem_projects: string[];
  mem_session_summaries: boolean;
  mem_observations: boolean;
}

export const DEFAULT_VAULT_CONFIG: VaultConfig = {
  mem_projects: ["*"],
  mem_session_summaries: true,
  mem_observations: false,
};

const CONFIG_FILENAME = ".lapis-vault.json";

function configPath(vaultPath: string): string {
  return `${vaultPath}/${CONFIG_FILENAME}`;
}

/**
 * 메모리 캐시 — vault path → 마지막으로 읽은 VaultConfig.
 * MemorySearchModal이 검색마다 loadVaultConfig를 호출하는데 vault config는 세션 중
 * 거의 안 변하는 값이라 매번 disk read는 낭비. 첫 호출에서만 readNote, 이후 in-memory.
 *
 * **invalidate 트리거**: 현재 Lapis엔 vault config 쓰기 흐름이 없음. 향후 추가 시
 * `invalidateVaultConfig(path)` 호출 필수.
 */
const cache = new Map<string, VaultConfig>();

/**
 * vault config 읽기. 파일이 없거나 JSON 파싱 실패 시 default 반환.
 * default 반환 시 자동 생성 X — 사용자가 명시적으로 작성하기 전엔 file 없음 상태 유지.
 *
 * 같은 vaultPath 두 번째 호출부터는 in-memory cache hit.
 */
export async function loadVaultConfig(vaultPath: string): Promise<VaultConfig> {
  const cached = cache.get(vaultPath);
  if (cached) return cached;
  let result: VaultConfig;
  try {
    const raw = await readNote(configPath(vaultPath));
    const parsed = JSON.parse(raw) as Partial<VaultConfig>;
    result = {
      mem_projects:
        Array.isArray(parsed.mem_projects) && parsed.mem_projects.length > 0
          ? parsed.mem_projects.map(String)
          : DEFAULT_VAULT_CONFIG.mem_projects,
      mem_session_summaries:
        typeof parsed.mem_session_summaries === "boolean"
          ? parsed.mem_session_summaries
          : DEFAULT_VAULT_CONFIG.mem_session_summaries,
      mem_observations:
        typeof parsed.mem_observations === "boolean"
          ? parsed.mem_observations
          : DEFAULT_VAULT_CONFIG.mem_observations,
    };
  } catch {
    result = { ...DEFAULT_VAULT_CONFIG };
  }
  cache.set(vaultPath, result);
  return result;
}

/**
 * 캐시 무효화. `.lapis-vault.json`이 외부에서 변경되거나 향후 쓰기 흐름이 추가될 때 호출.
 * 인자 없이 호출하면 전체 클리어.
 */
export function invalidateVaultConfig(vaultPath?: string): void {
  if (vaultPath === undefined) {
    cache.clear();
  } else {
    cache.delete(vaultPath);
  }
}

// 쓰기(saveVaultConfig)는 후속 phase에서 추가. 본 phase는 read-only.
// 사용자가 `.lapis-vault.json`을 직접 편집하거나, 미존재 시 default(["*"])로 동작.
