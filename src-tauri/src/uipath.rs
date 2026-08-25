//! 프런트엔드로 나가는 경로의 **단일 정규형**.
//!
//! ## 규칙 — Rust가 프런트로 넘기는 경로는 항상 `/` 구분자다
//!
//! 프런트는 경로를 `split("/")`로 다룬다(`notePath.ts`·`assetPath.ts`·`tags.ts` 등
//! 20여 곳). 한 곳이라도 `\`가 새면 파일명·부모 디렉터리 표시가 통째로 어긋나고,
//! 증상이 "탭 라벨이 전체 경로로 보인다" 같은 엉뚱한 모습으로 나타나 추적이 어렵다.
//! 그래서 **경계에서 한 번** 정규화한다. macOS에선 원래 `/`라 무해한 통과다.
//!
//! ## `\\?\` 접두사를 벗기는 이유
//!
//! Windows `canonicalize()`는 확장 길이 경로(`\\?\C:\Users\...`)를 돌려준다.
//! 그대로 내보내면 프런트가 드라이브 지정자(`C:`)를 첫 세그먼트로 보지 못하고,
//! `convertFileSrc()`도 존재하지 않는 경로를 만든다. UNC(`\\?\UNC\srv\share`)는
//! `\\srv\share`로 되돌린다.
//!
//! ## ⚠️ 경로 **비교**에는 쓰지 말 것
//!
//! vault 이탈 검사(`starts_with`)는 canonicalize한 `Path`끼리 해야 한다. 문자열로
//! 내린 뒤 비교하면 접두사 형태(`\\?\C:` vs `C:`)가 달라 검사가 헛돈다.
//! 이 함수는 **마지막에 한 번, 내보낼 때만** 쓴다.

use std::path::Path;

/// 프런트엔드로 내보낼 경로 문자열.
#[cfg(windows)]
pub fn to_ui<P: AsRef<Path>>(p: P) -> String {
    strip_verbatim(&p.as_ref().to_string_lossy()).replace('\\', "/")
}

/// 프런트엔드로 내보낼 경로 문자열.
///
/// Unix에서 `\`는 **파일명에 쓸 수 있는 문자**다. 구분자로 오인해 바꾸면 이름을
/// 변조하게 되므로 여기서는 그대로 둔다.
#[cfg(not(windows))]
pub fn to_ui<P: AsRef<Path>>(p: P) -> String {
    p.as_ref().to_string_lossy().into_owned()
}

#[cfg(windows)]
fn strip_verbatim(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 상대경로는_그대로() {
        assert_eq!(to_ui(Path::new("proj/adr/001.md")), "proj/adr/001.md");
    }

    #[cfg(windows)]
    #[test]
    fn 역슬래시를_슬래시로() {
        assert_eq!(to_ui(Path::new(r"C:\vault\note.md")), "C:/vault/note.md");
        assert_eq!(to_ui(Path::new(r"proj\adr\001.md")), "proj/adr/001.md");
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_접두사를_벗긴다() {
        let p = Path::new(r"\\?\C:\vault\note.md");
        assert_eq!(to_ui(p), "C:/vault/note.md");
    }

    #[cfg(windows)]
    #[test]
    fn verbatim_unc를_되돌린다() {
        let p = Path::new(r"\\?\UNC\srv\share\a.md");
        assert_eq!(to_ui(p), "//srv/share/a.md");
    }

    #[cfg(not(windows))]
    #[test]
    fn unix에서_역슬래시는_파일명의_일부다() {
        // Unix에서 `a\b.md`는 **한 개**의 파일 이름이다. 구분자로 바꾸면 변조다.
        let p = Path::new(r"/vault/a\b.md");
        assert_eq!(to_ui(p), r"/vault/a\b.md");
    }
}
