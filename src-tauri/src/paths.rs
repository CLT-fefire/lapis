//! 앱 데이터 디렉터리의 **단일 진실**.
//!
//! ## 왜 있나 — dev와 릴리즈가 같은 디렉터리를 쓰고 있었다
//!
//! `tauri.conf.json`의 `identifier`가 하나(`com.lapis.dev`)라서 `npm run tauri dev`로 띄운
//! 빌드와 `/Applications/Lapis.app`이 **같은 `app_data_dir`을 공유**했다. 특히
//! `search-cache/`를 공유하는 게 문제였다:
//!
//! - 두 빌드의 `CACHE_VERSION`이 다르면 서로를 version mismatch로 판정 → 전체 재빌드 →
//!   자기 버전으로 덮어쓴다. 앱을 번갈아 열 때마다 **19,000노트 풀 인덱싱**(약 1분)이 반복된다.
//! - 2026-08-13 `CACHE_VERSION` 6→7 작업에서 실제로 겪었다. 검증 중 fingerprint가 계속
//!   바뀌어 원인 추적에 시간을 썼고, 지식 질의 MCP가 릴리즈 앱을 켤 때마다 `version_skew`로
//!   막혔다.
//!
//! ## 규칙 — **릴리즈 경로는 절대 바꾸지 않는다**
//!
//! 바꾸는 쪽은 **dev**다. 릴리즈 경로를 옮기면 기존 사용자의 설정·캐시가 전부 고아가 된다.
//! 그래서 dev만 `-dev` 접미사를 붙인 형제 디렉터리를 쓴다.
//!
//! 판정은 `cfg!(debug_assertions)` — 앱의 디버그 표식(`lib.rs`)이 이미 쓰는 것과 같은
//! 기준이다. ⚠️ 프론트의 `import.meta.env.DEV`는 **번들 모드**라 따로 논다(CLAUDE.md §3).
//!
//! ## webview localStorage는 이미 갈려 있다
//!
//! 탭·`last-vault-path`·페인 상태는 localStorage에 있고 오리진으로 격리된다 —
//! dev는 `http://localhost:1430`(vite 포트 = 오리진), 릴리즈는 `tauri://localhost`.
//! ⚠️ **vite 포트를 바꾸면 오리진이 바뀌어 dev 앱의 localStorage가 통째로 갈린다.**
//! 그래서 이 모듈이 다루는
//! 것은 **Rust가 쓰는 디스크 경로뿐**이다.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// dev 빌드가 쓰는 접미사. 릴리즈는 접미사 없는 원래 경로 그대로.
const DEV_SUFFIX: &str = "-dev";

/// 이 빌드가 쓸 앱 데이터 루트. 없으면 만든다.
///
/// 릴리즈: `~/Library/Application Support/com.lapis.dev/`
/// dev:    `~/Library/Application Support/com.lapis.dev-dev/`
///
/// (릴리즈 identifier 자체가 `com.lapis.dev`라 이름이 헷갈리지만, 그건 별개 문제다 —
/// 여기서 바꾸면 기존 사용자 경로가 깨진다.)
pub fn app_data_root(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir 조회 실패: {e}"))?;

    let dir = if cfg!(debug_assertions) {
        let name = base
            .file_name()
            .map(|n| format!("{}{}", n.to_string_lossy(), DEV_SUFFIX))
            .ok_or_else(|| "app_data_dir에 파일명이 없다".to_string())?;
        base.with_file_name(name)
    } else {
        base
    };

    fs::create_dir_all(&dir).map_err(|e| format!("app_data_dir 생성 실패: {e}"))?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::DEV_SUFFIX;
    use std::path::PathBuf;

    /// `app_data_root`의 경로 변환만 떼어낸 것 — `AppHandle` 없이 검증하려고 분리.
    fn apply(base: &str, debug: bool) -> PathBuf {
        let base = PathBuf::from(base);
        if !debug {
            return base;
        }
        let name = format!(
            "{}{}",
            base.file_name().unwrap().to_string_lossy(),
            DEV_SUFFIX
        );
        base.with_file_name(name)
    }

    #[test]
    fn release_path_is_untouched() {
        // 이게 깨지면 기존 사용자의 설정·캐시가 전부 고아가 된다.
        let base = "/Users/x/Library/Application Support/com.lapis.dev";
        assert_eq!(apply(base, false), PathBuf::from(base));
    }

    #[test]
    fn dev_gets_sibling_directory() {
        let got = apply("/Users/x/Library/Application Support/com.lapis.dev", true);
        assert_eq!(
            got,
            PathBuf::from("/Users/x/Library/Application Support/com.lapis.dev-dev")
        );
    }

    #[test]
    fn dev_and_release_never_collide() {
        let base = "/Users/x/Library/Application Support/com.lapis.dev";
        assert_ne!(apply(base, true), apply(base, false));
    }

    #[test]
    fn suffix_applies_to_last_component_only() {
        // `with_file_name`이라 상위 경로는 그대로여야 한다 — 부모까지 바꾸면
        // Application Support 밖으로 나가 sandbox·백업 정책이 달라진다.
        let got = apply("/a/b/c/com.lapis.dev", true);
        assert_eq!(got.parent(), Some(PathBuf::from("/a/b/c").as_path()));
    }
}
