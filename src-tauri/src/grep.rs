//! vault **전체** 정규식·리터럴 검색 — BM25가 못 닿는 팔.
//!
//! ## 왜 있나
//!
//! `mcp/README.md`의 grep 비교가 이미 결론을 냈다:
//!
//! > `_memories`에서 grep은 4문항 전부 0건(어휘 불일치 — 기록은 "창", 질의는 "윈도우")인데
//! > BM25는 거기에 상위를 익사당한다. 같은 코퍼스가 한 팔은 못 닿고 한 팔은 압도당하니,
//! > **둘 다 쓰는 게 맞다.**
//!
//! 그런데 앱에는 한 팔만 있었다. 문서 **내부** 검색(⌘F)에는 regex·case·whole word가 있는데
//! vault **전체**(⌘⇧F)는 BM25 토큰 매칭뿐이었다. 이건 개선이 아니라 결손이다.
//!
//! ## 왜 Rust인가
//!
//! 본문 합이 52 MB다(작성자 vault 실측). 프런트로 넘겨 JS에서 훑을 양이 아니고,
//! `read_vault_bundle`이 이미 쓰는 rayon 병렬 read를 그대로 재사용할 수 있다.
//!
//! ## ⚠️ 매치 오프셋을 Rust가 돌려주는 이유
//!
//! 1. **문법이 다르다.** Rust `regex`에는 역참조·lookaround가 없다. 프런트가 같은 패턴을
//!    JS `RegExp`로 다시 돌리면 **다른 곳이 매치될 수 있다.**
//! 2. **JS 문자열은 UTF-16이다.** 바이트 오프셋을 그대로 주면 한글이 든 줄에서 하이라이트가
//!    어긋난다. 그래서 `col`·`len`은 **UTF-16 코드 단위**로 계산해 보낸다.
//!
//! ## 백트래킹 폭발은 없다
//!
//! `regex` 크레이트는 입력 길이에 선형이다(백트래커가 아니다). 사용자가 `(a+)+b` 같은
//! 패턴을 넣어도 지수 시간이 되지 않는다. 컴파일 쪽만 `size_limit`으로 막는다.

use rayon::prelude::*;
use regex::{Regex, RegexBuilder};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::uipath::to_ui;
use crate::vault::{canonicalize_vault, walk_md_files};

/// 한 줄에서 잘라 보낼 최대 **문자** 수. 한 줄짜리 거대 파일이 응답을 통째로 먹는 것을 막는다.
const MAX_LINE_CHARS: usize = 300;

/// 잘린 줄에서 매치 **앞**에 남길 여유 문자 수 — 매치가 맨 앞에 붙으면 맥락이 사라진다.
const LEAD_CHARS: usize = 60;

/// 컴파일된 정규식의 메모리 상한. 사용자 입력이라 무한정 크게 두지 않는다.
const REGEX_SIZE_LIMIT: usize = 1 << 20;

const DEFAULT_LIMIT: usize = 200;
const MAX_LIMIT: usize = 2000;

#[derive(Serialize)]
pub struct GrepHit {
    /// 노트 절대 경로(UI 정규형 — `/` 구분자).
    pub path: String,
    /// 1-based 줄 번호.
    pub line: u32,
    /// 매치가 있는 줄. 길면 매치 주변만 잘라 보낸다(`clipped`).
    pub text: String,
    /// `text` 안에서의 매치 시작 — **UTF-16 코드 단위**.
    pub col: u32,
    /// 매치 길이 — **UTF-16 코드 단위**. 창 밖으로 넘어가면 잘린다.
    pub len: u32,
    /// 원본 줄이 잘렸나. UI가 생략 표시를 붙일 근거.
    pub clipped: bool,
}

#[derive(Serialize)]
pub struct GrepResult {
    pub hits: Vec<GrepHit>,
    /// 매치가 나온 **파일 수**(반환된 hit 기준).
    pub files: u32,
    /// 훑기 대상이던 파일 수. `truncated`면 전부 읽지는 않았다.
    pub scanned: u32,
    /// 상한에 걸려 조기 종료했나. **조용히 자르지 않는다.**
    pub truncated: bool,
}

/// UTF-16 코드 단위 길이.
fn utf16_len(s: &str) -> u32 {
    s.encode_utf16().count() as u32
}

/// 문자 인덱스 → 바이트 인덱스. 끝을 넘으면 문자열 길이를 준다.
///
/// ⚠️ 바이트로 직접 자르지 않는다. UTF-8 경계를 깨면 패닉이다 — `strip_md_extension`에서
/// 실제로 겪었고 릴리즈 직후 즉시 크래시였다(CHANGELOG 1.2.1).
fn char_to_byte(s: &str, ci: usize) -> usize {
    s.char_indices().nth(ci).map(|(b, _)| b).unwrap_or(s.len())
}

fn build_regex(
    pattern: &str,
    regex_mode: bool,
    case_sensitive: bool,
    whole_word: bool,
) -> Result<Regex, String> {
    let base = if regex_mode {
        pattern.to_string()
    } else {
        regex::escape(pattern)
    };
    // whole word는 패턴을 통째로 감싼다. `a|b`에 그냥 붙이면
    // `\ba|b\b`가 되어 뜻이 달라진다.
    let src = if whole_word {
        format!(r"\b(?:{base})\b")
    } else {
        base
    };
    RegexBuilder::new(&src)
        .case_insensitive(!case_sensitive)
        .size_limit(REGEX_SIZE_LIMIT)
        .build()
        .map_err(|e| format!("정규식이 올바르지 않다: {e}"))
}

/// 한 줄에서 매치 하나를 `GrepHit`으로. `mstart`·`mend`는 **바이트** 오프셋이다.
fn make_hit(path: &str, line_no: u32, line: &str, mstart: usize, mend: usize) -> GrepHit {
    let total_chars = line.chars().count();
    if total_chars <= MAX_LINE_CHARS {
        return GrepHit {
            path: path.to_string(),
            line: line_no,
            text: line.to_string(),
            col: utf16_len(&line[..mstart]),
            len: utf16_len(&line[mstart..mend]),
            clipped: false,
        };
    }

    let m_start_ci = line[..mstart].chars().count();
    let start_ci = m_start_ci.saturating_sub(LEAD_CHARS);
    let end_ci = (start_ci + MAX_LINE_CHARS).min(total_chars);
    let start_b = char_to_byte(line, start_ci);
    let end_b = char_to_byte(line, end_ci);

    // 아주 긴 매치는 창 밖으로 넘어간다. 보이는 만큼만 표시한다.
    let vis_start = mstart.max(start_b).min(end_b);
    let vis_end = mend.min(end_b).max(vis_start);

    GrepHit {
        path: path.to_string(),
        line: line_no,
        text: line[start_b..end_b].to_string(),
        col: utf16_len(&line[start_b..vis_start]),
        len: utf16_len(&line[vis_start..vis_end]),
        clipped: true,
    }
}

/// 파일 하나를 훑는다. **줄당 첫 매치만** 낸다 — grep 기본과 같고, 한 줄에 열 번
/// 나오는 단어가 결과를 열 줄로 부풀리지 않는다.
fn scan_file(path: &PathBuf, re: &Regex, per_file_cap: usize) -> Vec<GrepHit> {
    // 비-UTF8 파일은 조용히 건너뛴다. 검색 하나 때문에 전체를 실패시킬 이유가 없다.
    let Ok(content) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let ui = to_ui(path);
    let mut out = Vec::new();
    for (i, line) in content.lines().enumerate() {
        if out.len() >= per_file_cap {
            break;
        }
        if let Some(m) = re.find(line) {
            out.push(make_hit(&ui, i as u32 + 1, line, m.start(), m.end()));
        }
    }
    out
}

/// vault 전체 검색.
///
/// `regex`가 false면 패턴을 리터럴로 이스케이프해 **같은 엔진**에 태운다. 두 모드가 다른
/// 코드 경로를 타면 대소문자·whole-word 처리가 미묘하게 갈린다.
#[tauri::command]
pub fn grep_vault(
    vault_path: String,
    pattern: String,
    regex: bool,
    case_sensitive: bool,
    whole_word: bool,
    limit: Option<usize>,
) -> Result<GrepResult, String> {
    if pattern.is_empty() {
        return Err("빈 패턴".to_string());
    }
    let root = canonicalize_vault(&vault_path)?;
    let re = build_regex(&pattern, regex, case_sensitive, whole_word)?;
    let cap = limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    let mut files: Vec<PathBuf> = Vec::new();
    walk_md_files(&root, &mut files).map_err(|e| e.to_string())?;
    let scanned_total = files.len() as u32;

    // 상한에 닿으면 남은 파일은 읽지 않는다. 카운터가 정확할 필요는 없고(병렬이라
    // 약간 넘칠 수 있다) **더 읽지 않는다**는 게 요점이다.
    let found = AtomicUsize::new(0);
    let mut hits: Vec<GrepHit> = files
        .par_iter()
        .map(|p| {
            if found.load(Ordering::Relaxed) >= cap {
                return Vec::new();
            }
            let h = scan_file(p, &re, cap);
            if !h.is_empty() {
                found.fetch_add(h.len(), Ordering::Relaxed);
            }
            h
        })
        .flatten()
        .collect();

    // 병렬 수집이라 순서가 흔들린다. 같은 질의가 매번 같은 결과를 내도록 고정한다.
    hits.sort_by(|a, b| a.path.cmp(&b.path).then(a.line.cmp(&b.line)));
    let truncated = hits.len() > cap;
    hits.truncate(cap);

    let mut seen: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
    seen.dedup();
    let files_with_hits = seen.len() as u32;

    Ok(GrepResult {
        hits,
        files: files_with_hits,
        scanned: scanned_total,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 매치 위치를 바이트가 아니라 UTF-16으로 주는지 — 프런트 하이라이트의 전제다.
    #[test]
    fn 한글_줄의_오프셋은_utf16이다() {
        let line = "한글 노트에서 윈도우를 찾는다";
        let m = line.find("윈도우").unwrap();
        let hit = make_hit("/v/a.md", 1, line, m, m + "윈도우".len());
        // 바이트로 주면 8*3=24 같은 값이 나온다. UTF-16이면 "한글 노트에서 " = 8.
        assert_eq!(hit.col, 8);
        assert_eq!(hit.len, 3);
        assert!(!hit.clipped);
        // 프런트가 하는 것과 같은 slice가 매치를 집어내야 한다.
        let u: Vec<u16> = hit.text.encode_utf16().collect();
        let picked =
            String::from_utf16(&u[hit.col as usize..(hit.col + hit.len) as usize]).unwrap();
        assert_eq!(picked, "윈도우");
    }

    #[test]
    fn ascii_줄도_같은_규칙() {
        let line = "hello world";
        let hit = make_hit("/v/a.md", 3, line, 6, 11);
        assert_eq!(hit.line, 3);
        assert_eq!(hit.col, 6);
        assert_eq!(hit.len, 5);
    }

    /// 긴 줄은 매치 주변만 잘라 보낸다. 잘라도 오프셋이 `text` 기준으로 맞아야 한다.
    #[test]
    fn 긴_줄은_매치_주변만_자른다() {
        let mut line = "가".repeat(500);
        let at = line.len();
        line.push_str("표적");
        line.push_str(&"나".repeat(500));
        let hit = make_hit("/v/a.md", 1, &line, at, at + "표적".len());
        assert!(hit.clipped);
        let n = hit.text.chars().count();
        assert!(n <= MAX_LINE_CHARS, "잘린 길이 {n}");
        let u: Vec<u16> = hit.text.encode_utf16().collect();
        let picked =
            String::from_utf16(&u[hit.col as usize..(hit.col + hit.len) as usize]).unwrap();
        assert_eq!(picked, "표적");
    }

    /// 매치가 줄 맨 앞이면 앞쪽 여유를 못 준다 — 그때도 오프셋이 0이어야 한다.
    #[test]
    fn 매치가_맨_앞인_긴_줄() {
        let line = format!("표적{}", "가".repeat(1000));
        let hit = make_hit("/v/a.md", 1, &line, 0, "표적".len());
        assert_eq!(hit.col, 0);
        assert_eq!(hit.len, 2);
    }

    #[test]
    fn 리터럴_모드는_정규식_문자를_이스케이프한다() {
        let re = build_regex("a.c", false, true, false).unwrap();
        assert!(re.is_match("a.c"));
        // 이스케이프가 안 되면 `.`이 아무 글자나 먹어 abc가 매치된다.
        assert!(!re.is_match("abc"));
    }

    #[test]
    fn 정규식_모드는_그대로_쓴다() {
        let re = build_regex("a.c", true, true, false).unwrap();
        assert!(re.is_match("abc"));
    }

    #[test]
    fn 대소문자_기본은_무시() {
        assert!(build_regex("Hello", false, false, false)
            .unwrap()
            .is_match("hello"));
        assert!(!build_regex("Hello", false, true, false)
            .unwrap()
            .is_match("hello"));
    }

    /// whole word는 패턴을 통째로 감싸야 한다. `a|b`에 그냥 붙이면 뜻이 갈린다.
    #[test]
    fn whole_word는_교대를_통째로_감싼다() {
        let re = build_regex("cat|dog", true, true, true).unwrap();
        assert!(re.is_match("a dog here"));
        assert!(re.is_match("the cat"));
        // 감싸지 않았다면 `\bcat|dog\b`가 되어 "dogma"의 뒤쪽이 걸린다.
        assert!(!re.is_match("dogma"));
        assert!(!re.is_match("category"));
    }

    #[test]
    fn 잘못된_정규식은_에러다() {
        let err = build_regex("a(", true, true, false).unwrap_err();
        assert!(err.contains("정규식"));
    }

    /// 리터럴 모드에서는 `a(` 같은 것도 그냥 찾을 수 있어야 한다.
    #[test]
    fn 리터럴_모드는_깨진_정규식도_찾는다() {
        let re = build_regex("a(", false, true, false).unwrap();
        assert!(re.is_match("foo a( bar"));
    }
}
