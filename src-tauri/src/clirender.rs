//! `lapis_render` 의 앱 쪽 절반 — 밖에서 시킨 렌더를 실행 중인 창이 해낸다.
//!
//! ## 왜 앱이 해야 하나
//!
//! 헤드리스(`headless.rs`)는 **창을 안 만들고 이벤트 루프도 안 돌린다.** 캐시 경로 규칙을
//! 한 벌로 유지하려는 것이 목적이라 그렇게 짜여 있고, 그래서 **캔버스가 없다.**
//!
//! mermaid 는 마운트 후 런타임에 `<svg>` 가 되고, PNG 는 그 SVG 를 캔버스에 그려 만든다.
//! 둘 다 살아 있는 WebView 가 있어야 한다 — 그건 실행 중인 GUI 앱뿐이다.
//!
//! ## 전달 수단은 `cliopen` 과 같다
//!
//! `tauri-plugin-single-instance` 가 argv 를 실행 중인 인스턴스로 넘긴다. 리스닝 포트가
//! 없으므로 **"네트워킹 코드는 없다"** 는 원칙이 그대로 지켜진다. 자세한 근거는
//! `cliopen.rs` 머리말에 있다.
//!
//! ## ⚠️ 결과를 어떻게 돌려주나 — 파일이다
//!
//! 두 번째 프로세스는 argv 를 넘긴 뒤 즉시 죽는다. 부른 쪽으로 값을 돌려줄 통로가 없다.
//! 그래서 앱이 `--render-out` 경로에 쓰고, 부른 쪽이 그 파일이 생기기를 상한을 두고
//! 기다린다. 헤드리스가 stdout 대신 파일을 쓰는 것과 같은 이유·같은 모양이다.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
// ⚠️ `try_state` 는 `Manager` 에 있다 — 안 가져오면 "메서드가 없다"로 나온다.
use tauri::{AppHandle, Emitter, Manager};

use crate::uipath::to_ui;

/// 밖에서 시킨 렌더 하나.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingRender {
    /// 렌더할 노트의 절대 경로(UI 정규형).
    pub path: String,
    /// 그 노트가 속한 vault 루트(UI 정규형). 어느 창이 받을지 이걸로 가른다.
    pub vault: String,
    /// 결과를 쓸 절대 경로.
    pub out: String,
    /// `html` — 앱 품질 자립 HTML(mermaid 가 SVG 로 박제된다).
    /// `png` — 본문 첫 mermaid 다이어그램을 PNG 로.
    pub format: String,
}

#[derive(Default)]
pub struct PendingRenderState {
    slot: Mutex<Option<PendingRender>>,
}

/// 이 형식들만 받는다.
///
/// ⚠️ **모르는 형식을 조용히 통과시키지 않는다.** 통과하면 프런트가 아무것도 안 하고,
/// 부른 쪽은 파일이 안 생겨 타임아웃으로만 안다 — 원인에서 한참 떨어진 신호다.
const FORMATS: [&str; 2] = ["html", "png"];

/// argv 에서 `--render <경로> --render-vault <루트> --render-out <파일> --render-format <형식>`.
///
/// ⚠️ 모르는 인자는 그냥 넘긴다 — `cliopen::parse_open` 과 같은 이유(OS·런처가 붙이는
/// 인자가 섞인다).
pub fn parse_render<I: Iterator<Item = String>>(args: I) -> Option<PendingRender> {
    let args: Vec<String> = args.collect();
    let mut path = None;
    let mut vault = None;
    let mut out = None;
    let mut format = None;
    for (i, a) in args.iter().enumerate() {
        match a.as_str() {
            "--render" => path = args.get(i + 1).cloned(),
            "--render-vault" => vault = args.get(i + 1).cloned(),
            "--render-out" => out = args.get(i + 1).cloned(),
            "--render-format" => format = args.get(i + 1).cloned(),
            _ => {}
        }
    }
    let format = format.unwrap_or_else(|| "html".to_string());
    if !FORMATS.contains(&format.as_str()) {
        eprintln!("[lapis/cli-render] 모르는 형식: {format}");
        return None;
    }
    // 넷 중 셋은 반드시 있어야 한다. vault 가 없으면 어느 창이 받을지 정할 수 없고,
    // out 이 없으면 결과를 돌려줄 방법이 없다.
    match (path, vault, out) {
        (Some(path), Some(vault), Some(out)) => Some(PendingRender {
            path: to_ui(std::path::Path::new(&path)),
            vault: to_ui(std::path::Path::new(&vault)),
            out: to_ui(std::path::Path::new(&out)),
            format,
        }),
        _ => None,
    }
}

/// 담아두고 모든 창에 알린다. 이미 담긴 게 있으면 덮어쓴다.
pub fn stage(app: &AppHandle, render: PendingRender) {
    let desc = format!("{} → {} ({})", render.path, render.out, render.format);
    if let Some(state) = app.try_state::<PendingRenderState>() {
        if let Ok(mut slot) = state.slot.lock() {
            *slot = Some(render);
        }
    }
    // ⚠️ 성공해도 실패해도 흔적이 없는 기능이라 로그를 남긴다 — `cliopen` 과 같은 이유.
    eprintln!("[lapis/cli-render] 담음: {desc}");
    if let Err(e) = app.emit("cli:render", ()) {
        eprintln!("[lapis/cli-render] 알림 실패: {e}");
    }
}

/// 자기 vault 의 요청이면 꺼내 간다.
///
/// ⚠️ 꺼내기는 **원자적**이다. 안 그러면 창 둘이 같은 렌더를 각자 하고 같은 파일에 쓴다.
#[tauri::command]
pub fn take_pending_render(
    state: tauri::State<'_, PendingRenderState>,
    vault: Option<String>,
) -> Option<PendingRender> {
    let mut slot = state.slot.lock().ok()?;
    let pending = slot.as_ref()?;
    let matches = vault
        .as_deref()
        .is_some_and(|v| to_ui(std::path::Path::new(v)) == pending.vault);
    if !matches {
        return None;
    }
    let taken = slot.take();
    if let Some(t) = &taken {
        eprintln!("[lapis/cli-render] 가져감: {} → {}", t.path, t.out);
    }
    taken
}

/// 렌더가 실패했을 때 부른 쪽에 알린다.
///
/// ## ⚠️ 실패도 파일로 낸다
///
/// 부른 쪽은 파일이 생기기를 기다린다. 실패했는데 아무것도 안 쓰면 **타임아웃으로만**
/// 안다 — "앱이 느린가"와 "렌더가 깨졌나"가 구별이 안 된다. 그래서 실패도 같은 경로에
/// JSON 한 줄로 쓴다.
#[tauri::command]
pub fn write_render_failure(out: String, message: String) -> Result<(), String> {
    let payload = serde_json::json!({ "ok": false, "error": message });
    std::fs::write(&out, payload.to_string()).map_err(|e| format!("실패 보고조차 못 썼다: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(v: &[&str]) -> std::vec::IntoIter<String> {
        v.iter()
            .map(|s| s.to_string())
            .collect::<Vec<_>>()
            .into_iter()
    }

    #[test]
    fn parses_all_four() {
        let r = parse_render(args(&[
            "--render",
            "/v/a.md",
            "--render-vault",
            "/v",
            "--render-out",
            "/tmp/a.png",
            "--render-format",
            "png",
        ]))
        .expect("파싱");
        assert_eq!(r.path, "/v/a.md");
        assert_eq!(r.vault, "/v");
        assert_eq!(r.format, "png");
    }

    /// 형식을 안 주면 html 이다 — 가장 흔한 쓰임.
    #[test]
    fn format_defaults_to_html() {
        let r = parse_render(args(&[
            "--render",
            "/v/a.md",
            "--render-vault",
            "/v",
            "--render-out",
            "/tmp/a.html",
        ]))
        .expect("파싱");
        assert_eq!(r.format, "html");
    }

    /// 🔴 모르는 형식을 통과시키면 프런트가 아무것도 안 하고 타임아웃으로만 알게 된다.
    #[test]
    fn rejects_unknown_format() {
        assert!(parse_render(args(&[
            "--render",
            "/v/a.md",
            "--render-vault",
            "/v",
            "--render-out",
            "/tmp/a.gif",
            "--render-format",
            "gif",
        ]))
        .is_none());
    }

    /// vault 가 없으면 어느 창이 받을지 정할 수 없다.
    #[test]
    fn needs_vault() {
        assert!(parse_render(args(&[
            "--render",
            "/v/a.md",
            "--render-out",
            "/tmp/a.html"
        ]))
        .is_none());
    }

    /// out 이 없으면 결과를 돌려줄 방법이 없다.
    #[test]
    fn needs_out() {
        assert!(parse_render(args(&["--render", "/v/a.md", "--render-vault", "/v"])).is_none());
    }

    /// ⚠️ 모르는 인자가 섞여도 통과한다 — OS·런처가 붙이는 것이 있다.
    #[test]
    fn ignores_unknown_args() {
        let r = parse_render(args(&[
            "-psn_0_12345",
            "--render",
            "/v/a.md",
            "--render-vault",
            "/v",
            "--render-out",
            "/tmp/a.html",
        ]));
        assert!(r.is_some());
    }
}
