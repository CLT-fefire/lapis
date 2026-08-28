//! 사용 로그 — **로컬 자기관찰**.
//!
//! ## ⚠️ 텔레메트리가 아니다
//!
//! `README`가 "네트워크 코드는 존재하지 않는다"고 못 박았고 이 모듈도 예외가 아니다.
//! 여기서 쓰는 것은 **디스크뿐**이고, 어디로도 보내지 않는다.
//!
//! ## ⚠️ vault 에 쓰지 않는다
//!
//! 로그를 vault 안에 두면 감시자가 돌아 **매 이벤트마다 재색인**하고, 로그 파일이 노트로
//! 색인된다. `paths::app_data_root` 아래에 두어 dev/release 분리도 그대로 따른다.
//!
//! ## 형식 — JSONL, 월별
//!
//! `usage/YYYY-MM.jsonl`. 한 줄이 한 이벤트다. 줄 단위라 손상이 그 줄에서 멈추고,
//! 이어 붙이기가 원자적으로 끝난다(append 한 번).
//!
//! ⚠️ **줄 내용을 여기서 해석하지 않는다.** 프런트가 만든 JSON 문자열을 그대로 받아
//! 붙인다. 스키마를 두 곳에 두면 반드시 갈린다 — 판정은 TypeScript 쪽 `usageLog.ts` 하나다.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use tauri::AppHandle;

use crate::paths::app_data_root;
use crate::uipath::to_ui;

/// 한 달치 파일의 상한. 넘으면 더 안 쓴다 — **지우지 않는다.**
///
/// ⚠️ 오래된 줄을 버리는 회전을 넣지 않은 이유: 이 로그의 용도가 "나중에 기능 개선에
/// 쓴다"이고, 그러면 **가장 오래된 것이 가장 값지다.** 조용히 앞부분을 버리면 그 분석이
/// 언제부터의 것인지 알 수 없게 된다. 상한에 닿으면 멈추고 그 사실을 남긴다.
const MONTH_FILE_MAX: u64 = 16 * 1024 * 1024;

/// 한 번에 받을 수 있는 줄 수. 프런트 버퍼가 폭주해도 여기서 끊는다.
const MAX_LINES_PER_CALL: usize = 2000;

fn usage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_data_root(app)?.join("usage");
    fs::create_dir_all(&dir).map_err(|e| format!("usage 디렉터리 생성 실패: {e}"))?;
    Ok(dir)
}

/// `YYYY-MM` 인가.
///
/// ⚠️ **경로를 조립하기 전에** 본다. 프런트가 준 문자열이 그대로 파일명이 되므로,
/// `../` 같은 것이 섞이면 usage 디렉터리 밖을 쓰게 된다.
fn valid_month(month: &str) -> bool {
    month.len() == 7
        && month.as_bytes()[4] == b'-'
        && month[..4].bytes().all(|b| b.is_ascii_digit())
        && month[5..].bytes().all(|b| b.is_ascii_digit())
}

/// `YYYY-MM` — 파일 이름의 달. 프런트가 준 값을 쓴다(시계는 한 곳에서만 읽는다).
fn month_file(app: &AppHandle, month: &str) -> Result<PathBuf, String> {
    if !valid_month(month) {
        return Err(format!("달 형식이 아니다: {month}"));
    }
    Ok(usage_dir(app)?.join(format!("{month}.jsonl")))
}

/// 결과 — 얼마나 썼고, 상한에 닿았는가.
#[derive(serde::Serialize)]
pub struct AppendResult {
    pub written: usize,
    /// 상한에 닿아 **버린** 줄 수. 0이 아니면 화면이 그 사실을 말해야 한다.
    pub dropped: usize,
    pub bytes: u64,
}

#[tauri::command]
pub fn usage_append(
    app: AppHandle,
    month: String,
    lines: Vec<String>,
) -> Result<AppendResult, String> {
    let path = month_file(&app, &month)?;
    let before = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);

    if before >= MONTH_FILE_MAX {
        return Ok(AppendResult {
            written: 0,
            dropped: lines.len(),
            bytes: before,
        });
    }

    let take = lines.len().min(MAX_LINES_PER_CALL);
    let mut buf = String::new();
    for line in lines.iter().take(take) {
        // ⚠️ 줄 안에 개행이 있으면 **한 줄 = 한 이벤트**가 깨진다. 프런트가 JSON 으로
        //    직렬화하므로 보통 없지만, 없다고 **가정하지 않는다**.
        if line.contains('\n') || line.contains('\r') {
            continue;
        }
        buf.push_str(line);
        buf.push('\n');
    }

    let mut f = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("usage 로그 열기 실패: {e}"))?;
    f.write_all(buf.as_bytes())
        .map_err(|e| format!("usage 로그 쓰기 실패: {e}"))?;

    Ok(AppendResult {
        written: take,
        dropped: lines.len() - take,
        bytes: before + buf.len() as u64,
    })
}

/// 한 달치를 통째로 읽는다. 통계 화면과 리포트가 쓴다.
///
/// ⚠️ 파싱하지 않고 **줄 배열**을 준다. 스키마 해석은 TypeScript 한 곳이다.
#[tauri::command]
pub fn usage_read(app: AppHandle, month: String) -> Result<Vec<String>, String> {
    let path = month_file(&app, &month)?;
    match fs::read_to_string(&path) {
        Ok(s) => Ok(s
            .lines()
            .map(|l| l.to_string())
            .filter(|l| !l.is_empty())
            .collect()),
        // 없는 달은 빈 것이지 오류가 아니다 — 아직 안 쓴 달을 물으면 자연히 여기로 온다.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("usage 로그 읽기 실패: {e}")),
    }
}

/// 있는 달 목록(내림차순)과 로그 디렉터리.
#[derive(serde::Serialize)]
pub struct UsageMonths {
    /// `YYYY-MM` 내림차순.
    pub months: Vec<String>,
    /// 사용자에게 보여줄 디렉터리 경로.
    pub dir: String,
    pub total_bytes: u64,
}

#[tauri::command]
pub fn usage_months(app: AppHandle) -> Result<UsageMonths, String> {
    let dir = usage_dir(&app)?;
    let mut months: Vec<String> = Vec::new();
    let mut total_bytes = 0u64;
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(stem) = name.strip_suffix(".jsonl") else {
                continue;
            };
            if stem.len() != 7 {
                continue;
            }
            total_bytes += entry.metadata().map(|m| m.len()).unwrap_or(0);
            months.push(stem.to_string());
        }
    }
    months.sort();
    months.reverse();
    Ok(UsageMonths {
        months,
        dir: to_ui(&dir),
        total_bytes,
    })
}

/// 로그를 전부 지운다. 설정의 "기록 지우기".
///
/// ⚠️ **디렉터리째 지우지 않는다.** `usage/` 아래에 다른 것이 생길 수 있고, 그때
/// 통째로 날리면 남의 것까지 간다. 우리가 만든 `YYYY-MM.jsonl` 만 지운다.
#[tauri::command]
pub fn usage_clear(app: AppHandle) -> Result<usize, String> {
    let dir = usage_dir(&app)?;
    let mut n = 0;
    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(stem) = name.strip_suffix(".jsonl") else {
                continue;
            };
            if stem.len() == 7 && fs::remove_file(entry.path()).is_ok() {
                n += 1;
            }
        }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::valid_month;

    #[test]
    fn accepts_a_month() {
        assert!(valid_month("2026-08"));
        assert!(valid_month("1999-12"));
    }

    /// ⚠️ 이 문자열이 그대로 파일명이 된다 — 경로 조립 전에 막지 못하면 usage 밖을 쓴다.
    #[test]
    fn rejects_anything_that_could_escape() {
        for bad in [
            "2026",
            "2026-1",
            "2026/01",
            "../etc",
            "2026-0a",
            "abcd-ef",
            "",
            "2026-08-01",
            "..\\etc",
            "2026-08 ",
        ] {
            assert!(!valid_month(bad), "{bad} 가 통과하면 안 된다");
        }
    }

    /// ⚠️ 멀티바이트가 섞이면 `month[..4]` 슬라이싱이 **패닉**한다. 길이 검사만으로는
    /// 못 막는다 — 바이트 길이 7 인 한글 두 글자가 있다.
    #[test]
    fn does_not_panic_on_multibyte() {
        for bad in ["가나-다", "２０２６-０８", "한글자7자야"] {
            assert!(!valid_month(bad), "{bad} 가 통과하면 안 된다");
        }
    }
}
