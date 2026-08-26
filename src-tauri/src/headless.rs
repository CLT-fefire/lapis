//! 창 없이 도는 실행 경로 — CLI(`lapis index`)의 **Rust 절반**.
//!
//! ## 왜 별도 바이너리가 아닌가
//!
//! 후보는 `[[bin]] lapis-index`였다. 안 쓴 이유:
//!
//! - Tauri 전체를 다시 링크한 **두 번째 큰 실행파일**을 설치본에 얹게 된다.
//! - 그건 사이드카 번들 설정을 늘린다.
//! - 무엇보다 CLI가 찾아야 할 실행파일이 둘이 된다.
//!
//! 이미 설치돼 있는 앱 실행파일에 플래그 하나를 더하는 쪽이 배포·발견 양쪽에서 싸다.
//!
//! ## ⚠️ 왜 `AppHandle`이 꼭 필요한가 — 캐시 디렉터리
//!
//! 캐시 위치는 `paths::app_data_root(app)`가 정하고, 그건 `app_data_dir()`에 의존한다.
//! Node나 헤드리스 코드가 그 규칙(플랫폼별 디렉터리 + identifier + dev 접미사)을 **다시
//! 구현하면** 앱이 안 읽는 곳에 인덱스를 쓰게 된다. 조용히 틀리는 부류다.
//!
//! 그래서 헤드리스도 Tauri 앱을 **짓기는 한다**(`build()`). 다만 설정에서 창 목록을
//! 비워 창을 만들지 않고, 이벤트 루프를 돌리지 않는다(`run()`을 안 부른다). 그러면
//! `app_data_dir()`이 GUI와 **같은 값**을 낸다 — 규칙이 한 벌뿐이다.
//!
//! ## ⚠️ 결과를 stdout이 아니라 파일로 낸다
//!
//! Windows 릴리즈 빌드는 `windows_subsystem = "windows"`다(콘솔 창이 뜨는 걸 막는다).
//! 그 실행파일은 부모 터미널의 stdout에 **쓸 수 없다.** 그래서 `--out`으로 받은 경로에
//! 쓴다. 성공이든 실패든 항상 JSON 한 덩이가 거기 생긴다:
//!
//! - 성공 `{"ok": true, ...}`
//! - 실패 `{"ok": false, "error": "..."}` + exit 1
//!
//! 부수적으로 이게 더 낫기도 하다 — 큰 vault의 export는 수십 MB고, 그만한 걸 파이프로
//! 흘리는 것보다 파일이 낫다.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::search_cache::{
    cache_root, vault_key, write_meta_inner, write_shard_inner, write_stats_inner, CACHE_VERSION,
    MAX_SHARDS,
};
use crate::uipath::to_ui;
use crate::vault::{
    read_vault_bundle_inner, vault_file_stats_inner, FileStat, LinkInfo, NoteContent,
};

/// 인자 맨 앞에 오는 표식. 이게 없으면 평범한 GUI 기동이다.
const SENTINEL: &str = "--headless";

#[derive(Debug)]
pub enum Job {
    /// vault를 훑어 Node가 인덱스를 만들 원자료를 낸다.
    ExportIndex { vault: String, out: PathBuf },
    /// Node가 만든 인덱스를 캐시에 커밋한다.
    ImportIndex {
        vault: String,
        input: PathBuf,
        out: PathBuf,
    },
    /// 캐시 위치와 키만. vault를 훑지 않는다(`lapis doctor`용).
    CacheInfo { vault: String, out: PathBuf },
}

impl Job {
    fn out(&self) -> &PathBuf {
        match self {
            Job::ExportIndex { out, .. }
            | Job::ImportIndex { out, .. }
            | Job::CacheInfo { out, .. } => out,
        }
    }
}

/// 인자를 읽는다. `--headless`가 없으면 `Ok(None)` — GUI로 간다.
///
/// ⚠️ 모르는 옵션은 **거부한다**. 오타를 조용히 무시하면 "왜 아무 일도 안 일어나지"가
/// 된다. CLI(`cli/args.ts`)가 같은 규율을 쓴다.
pub fn parse<I: Iterator<Item = String>>(args: I) -> Result<Option<Job>, String> {
    let args: Vec<String> = args.collect();
    if args.first().map(String::as_str) != Some(SENTINEL) {
        return Ok(None);
    }
    let verb = args
        .get(1)
        .ok_or_else(|| format!("{SENTINEL} 다음에 작업 이름이 필요하다"))?
        .clone();

    let mut vault = None;
    let mut out = None;
    let mut input = None;
    let mut i = 2;
    while i < args.len() {
        let key = args[i].as_str();
        let val = args
            .get(i + 1)
            .ok_or_else(|| format!("{key} 에 값이 없다"))?
            .clone();
        match key {
            "--vault" => vault = Some(val),
            "--out" => out = Some(PathBuf::from(val)),
            "--in" => input = Some(PathBuf::from(val)),
            other => return Err(format!("모르는 옵션: {other}")),
        }
        i += 2;
    }

    let vault = vault.ok_or_else(|| "--vault 가 필요하다".to_string())?;
    let out = out.ok_or_else(|| "--out 이 필요하다".to_string())?;
    match verb.as_str() {
        "export-index" => Ok(Some(Job::ExportIndex { vault, out })),
        "import-index" => Ok(Some(Job::ImportIndex {
            vault,
            input: input.ok_or_else(|| "import-index 에는 --in 이 필요하다".to_string())?,
            out,
        })),
        "cache-info" => Ok(Some(Job::CacheInfo { vault, out })),
        other => Err(format!("모르는 작업: {other}")),
    }
}

// ─── export ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct ExportPayload {
    ok: bool,
    cache_version: u32,
    cache_dir: String,
    cache_key: String,
    vault_root: String,
    fingerprint: String,
    max_shards: u32,
    link_infos: Vec<LinkInfo>,
    contents: Vec<NoteContent>,
    files: Vec<FileStat>,
}

fn export_index(app: &AppHandle, vault: &str) -> Result<ExportPayload, String> {
    // ⚠️ fingerprint와 파일 목록은 **같은 walk**에서 나와야 한다. 따로 부르면 두 walk
    // 사이에 vault가 바뀌어 목록과 해시가 어긋난 스냅샷을 커밋하게 된다.
    let stats = vault_file_stats_inner(vault)?;
    let bundle = read_vault_bundle_inner(vault)?;

    // 두 호출 사이에 vault가 바뀌었을 수 있다. 파일 수가 다르면 스냅샷이 찢어진 것이므로
    // 커밋하지 않는다 — 어긋난 캐시는 조용히 틀린 답을 낸다.
    if bundle.links.len() != stats.files.len() {
        return Err(format!(
            "스캔 도중 vault가 바뀌었다 (links {} vs files {}). 다시 실행하라.",
            bundle.links.len(),
            stats.files.len()
        ));
    }

    Ok(ExportPayload {
        ok: true,
        cache_version: CACHE_VERSION,
        cache_dir: to_ui(cache_root(app)?),
        cache_key: vault_key(vault),
        vault_root: to_ui(std::path::Path::new(vault)),
        fingerprint: stats.fingerprint,
        max_shards: MAX_SHARDS,
        link_infos: bundle.links,
        contents: bundle.contents,
        files: stats.files,
    })
}

// ─── import ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ShardIn {
    shard_id: u32,
    minisearch_json: String,
}

#[derive(Deserialize)]
struct ImportInput {
    fingerprint: String,
    link_infos: Vec<LinkInfo>,
    files: Vec<FileStat>,
    shards: Vec<ShardIn>,
}

#[derive(Serialize)]
struct ImportPayload {
    ok: bool,
    cache_dir: String,
    cache_key: String,
    shard_count: u32,
    note_count: usize,
}

/// Node가 만든 인덱스를 캐시에 커밋한다.
///
/// ## ⚠️ 쓰는 순서가 계약이다 — shard → stats → **meta 맨 마지막**
///
/// meta가 커밋 지점이다. 중간에 죽으면 옛 meta가 남고, 옛 meta의 fingerprint는 새로 쓴
/// shard·stats와 어긋나 읽는 쪽이 전부 거부한다(= 풀 빌드). 그건 **안전한** 실패다.
///
/// 순서를 뒤집으면 meta가 먼저 커밋되고 shard가 없거나 낡은 상태가 되는데, 그때는
/// **fingerprint가 맞아떨어져서** 읽는 쪽이 낡은 본문을 정상으로 받아들인다. 조용히
/// 틀린 검색 결과가 나온다 — 캐시 미스보다 나쁘다.
///
/// 그래서 이 순서를 문서가 아니라 **코드 한 곳**에 가둔다.
fn import_index(app: &AppHandle, vault: &str, input: &PathBuf) -> Result<ImportPayload, String> {
    let raw = std::fs::read_to_string(input).map_err(|e| format!("입력 파일 읽기: {e}"))?;
    let data: ImportInput = serde_json::from_str(&raw).map_err(|e| format!("입력 파싱: {e}"))?;

    let shard_count = u32::try_from(data.shards.len()).map_err(|_| "shard가 너무 많다")?;
    if shard_count > MAX_SHARDS {
        return Err(format!(
            "shard {shard_count}개는 상한 {MAX_SHARDS}을 넘는다"
        ));
    }
    // link_infos와 files가 어긋나면 export 시점의 스냅샷이 아니다.
    if data.link_infos.len() != data.files.len() {
        return Err(format!(
            "찢어진 입력 (links {} vs files {})",
            data.link_infos.len(),
            data.files.len()
        ));
    }

    for shard in &data.shards {
        write_shard_inner(
            app,
            vault,
            shard.shard_id,
            data.fingerprint.clone(),
            shard.minisearch_json.clone(),
        )?;
    }
    write_stats_inner(app, vault, data.fingerprint.clone(), data.files)?;
    let note_count = data.link_infos.len();
    write_meta_inner(app, vault, data.fingerprint, data.link_infos, shard_count)?;

    Ok(ImportPayload {
        ok: true,
        cache_dir: to_ui(cache_root(app)?),
        cache_key: vault_key(vault),
        shard_count,
        note_count,
    })
}

// ─── 실행 ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
struct CacheInfoPayload {
    ok: bool,
    cache_version: u32,
    cache_dir: String,
    cache_key: String,
    max_shards: u32,
}

#[derive(Serialize)]
struct Failure {
    ok: bool,
    error: String,
}

/// 작업을 하고 결과 JSON을 `--out`에 쓴다. 반환값은 프로세스 exit code.
pub fn execute(app: &AppHandle, job: Job) -> i32 {
    let out = job.out().clone();
    let body = match run_job(app, job) {
        Ok(json) => json,
        Err(e) => {
            // Windows GUI 서브시스템에선 이 stderr가 아무 데도 안 보인다. 그래서 파일에도
            // 쓴다 — 저기가 CLI가 실제로 읽는 곳이다.
            eprintln!("[lapis headless] {e}");
            let body = serde_json::to_string(&Failure {
                ok: false,
                error: e,
            })
            .unwrap_or_else(|_| FALLBACK_FAILURE.to_string());
            report_failure(&out, &body);
            return 1;
        }
    };
    if let Err(e) = write_result(&out, &body) {
        eprintln!("[lapis headless] 결과 쓰기 실패: {e}");
        return 1;
    }
    0
}

/// 오류 메시지 직렬화조차 실패했을 때의 최후 응답. CLI가 파싱은 할 수 있어야 한다.
const FALLBACK_FAILURE: &str = r#"{"ok":false,"error":"직렬화 실패"}"#;

fn run_job(app: &AppHandle, job: Job) -> Result<String, String> {
    match job {
        Job::ExportIndex { vault, .. } => {
            let p = export_index(app, &vault)?;
            serde_json::to_string(&p).map_err(|e| format!("export 직렬화: {e}"))
        }
        Job::ImportIndex { vault, input, .. } => {
            let p = import_index(app, &vault, &input)?;
            serde_json::to_string(&p).map_err(|e| format!("import 직렬화: {e}"))
        }
        Job::CacheInfo { vault, .. } => {
            let p = CacheInfoPayload {
                ok: true,
                cache_version: CACHE_VERSION,
                cache_dir: to_ui(cache_root(app)?),
                cache_key: vault_key(&vault),
                max_shards: MAX_SHARDS,
            };
            serde_json::to_string(&p).map_err(|e| format!("cache-info 직렬화: {e}"))
        }
    }
}

fn write_result(out: &PathBuf, body: &str) -> Result<(), String> {
    if let Some(parent) = out.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| format!("out 디렉터리: {e}"))?;
        }
    }
    std::fs::write(out, body).map_err(|e| format!("out 쓰기: {e}"))
}

/// 실패 경로 전용 — 여기서 또 실패하면 할 수 있는 게 없다(exit code만 남는다).
fn report_failure(out: &PathBuf, body: &str) {
    if let Err(e) = write_result(out, body) {
        eprintln!("[lapis headless] 실패 보고조차 못 썼다: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 표식이_없으면_gui다() {
        assert!(parse(v(&[]).into_iter()).unwrap().is_none());
        assert!(parse(v(&["--flag"]).into_iter()).unwrap().is_none());
    }

    #[test]
    fn export를_읽는다() {
        let job =
            parse(v(&["--headless", "export-index", "--vault", "/v", "--out", "/o"]).into_iter())
                .unwrap()
                .expect("job");
        match job {
            Job::ExportIndex { vault, out } => {
                assert_eq!(vault, "/v");
                assert_eq!(out, PathBuf::from("/o"));
            }
            _ => panic!("export여야 한다"),
        }
    }

    #[test]
    fn import는_in이_필요하다() {
        let e =
            parse(v(&["--headless", "import-index", "--vault", "/v", "--out", "/o"]).into_iter())
                .unwrap_err();
        assert!(e.contains("--in"), "e={e}");
    }

    /// 오타를 조용히 무시하면 "왜 아무 일도 안 일어나지"가 된다.
    #[test]
    fn 모르는_옵션은_거부한다() {
        let e =
            parse(v(&["--headless", "export-index", "--vualt", "/v", "--out", "/o"]).into_iter())
                .unwrap_err();
        assert!(e.contains("모르는 옵션"), "e={e}");
    }

    #[test]
    fn 값_없는_옵션은_거부한다() {
        let e = parse(v(&["--headless", "export-index", "--vault"]).into_iter()).unwrap_err();
        assert!(e.contains("값이 없다"), "e={e}");
    }

    #[test]
    fn 모르는_작업은_거부한다() {
        let e = parse(v(&["--headless", "nope", "--vault", "/v", "--out", "/o"]).into_iter())
            .unwrap_err();
        assert!(e.contains("모르는 작업"), "e={e}");
    }
}
