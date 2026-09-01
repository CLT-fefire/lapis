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
    /// 이 요청을 위해 **방금 만든** 창의 라벨. 그 창만 vault 를 안 따지고 받아간다.
    ///
    /// 🔴 이게 없으면 **앱이 다른 vault 를 연 채일 때 요청이 영영 남는다.** 실측:
    /// 두 번째 프로세스는 코드 0(성공)으로 끝나고, 결과 파일도 실패 파일도 안 생기고,
    /// 부른 쪽은 타임아웃으로만 안다. `cliopen` 이 같은 문제를 같은 방법으로 푼다.
    cli_window: Mutex<Option<String>>,
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
        stage_into(&state, render);
    }
    // ⚠️ 성공해도 실패해도 흔적이 없는 기능이라 로그를 남긴다 — `cliopen` 과 같은 이유.
    eprintln!("[lapis/cli-render] 담음: {desc}");
    if let Err(e) = app.emit("cli:render", ()) {
        eprintln!("[lapis/cli-render] 알림 실패: {e}");
    }
}

/// 담기의 순수한 절반 — Tauri 없이 테스트할 수 있게 뗐다.
///
/// 🔴 **새 요청은 지난 창 표식을 무효로 만든다.**
///
/// 차가운 기동이 `main` 을 지목해 두는데(`lib.rs`), 그 표식을 안 지우면 그 뒤로 오는
/// 모든 렌더 요청을 `main` 이 **vault 와 무관하게** 가로챈다. 프런트는 요청받은 vault 를
/// 열게 돼 있으므로 사용자가 보던 창의 vault 가 통째로 바뀐다.
///
/// `cliopen::stage` 가 같은 이유로 이미 지운다. 렌더만 빠져 있었다.
fn stage_into(state: &PendingRenderState, render: PendingRender) {
    if let Ok(mut slot) = state.slot.lock() {
        *slot = Some(render);
    }
    if let Ok(mut w) = state.cli_window.lock() {
        *w = None;
    }
}

/// 자기 요청이면 꺼내 간다.
///
/// ⚠️ 꺼내기는 **원자적**이다. 안 그러면 창 둘이 같은 렌더를 각자 하고 같은 파일에 쓴다.
///
/// ⚠️ vault 가 안 맞아도 **슬롯을 비우지 않는다.** 비우면 뒤에 올 진짜 주인이 못 받는다.
#[tauri::command]
pub fn take_pending_render(
    window: tauri::Window,
    state: tauri::State<'_, PendingRenderState>,
    vault: Option<String>,
) -> Option<PendingRender> {
    claim(&state, window.label(), vault.as_deref())
}

/// 꺼내기의 순수한 절반 — Tauri 없이 테스트할 수 있게 뗐다.
///
/// 받아가는 조건은 **둘 중 하나**다:
/// - 이 요청을 위해 방금 만든 창이거나(`cli_window`),
/// - 자기 vault 의 요청이거나.
fn claim(state: &PendingRenderState, label: &str, vault: Option<&str>) -> Option<PendingRender> {
    let mine = state
        .cli_window
        .lock()
        .ok()
        .map(|w| w.as_deref() == Some(label))
        .unwrap_or(false);

    let mut slot = state.slot.lock().ok()?;
    let pending = slot.as_ref()?;
    let matches = vault.is_some_and(|v| to_ui(std::path::Path::new(v)) == pending.vault);
    if !mine && !matches {
        return None;
    }
    let taken = slot.take();
    if let Some(t) = &taken {
        eprintln!(
            "[lapis/cli-render] {label} 이(가) 가져감: {} → {}",
            t.path, t.out
        );
    }
    taken
}

/// 차가운 기동에서 `main` 을 지목해 둔다 — 그 창이 vault 를 안 따지고 받아간다.
///
/// ⚠️ 없으면 앱이 **마지막에 열었던 vault** 를 복원한 뒤 요청과 안 맞아 안 가져간다.
/// `cliopen` 이 같은 이유로 같은 표식을 쓴다.
pub fn mark_cli_window(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<PendingRenderState>() {
        if let Ok(mut w) = state.cli_window.lock() {
            *w = Some(label.to_string());
        }
    }
}

/// 아무 창도 안 받아가면 **새 창을 띄운다.**
///
/// ## 🔴 없으면 조용히 아무 일도 안 일어난다
///
/// 실측(v3.10.0 릴리스): 앱이 `C:\lapis-testvault` 를 연 채로 다른 vault 의 노트를
/// 렌더 요청했더니 두 번째 프로세스가 **코드 0(성공)** 으로 끝났고, 결과 파일도 실패
/// 파일도 안 생겼다. 부른 쪽은 타임아웃으로만 알고, 셸에서 `&&` 로 이으면 진행된다.
///
/// `cliopen::open_window_if_unclaimed` 과 **같은 방법**이다 — 새 창의 라벨을 기억해
/// 두면 그 창이 기동하며 물을 때 vault 를 안 따지고 받아간다.
///
/// ⚠️ 그러고도 안 받아가면 **실패 파일을 쓴다.** 창을 띄웠는데 그 창도 못 받는 상황이
/// 남으면 다시 조용한 타임아웃이 된다.
pub fn render_window_if_unclaimed(app: &AppHandle, wait_ms: u64, give_up_ms: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(wait_ms));
        let Some(state) = app.try_state::<PendingRenderState>() else {
            return;
        };
        let Some(out) = unclaimed_out(&state) else {
            return;
        };

        // ⚠️ 라벨을 창을 만들기 **전에** 기억할 수는 없다(라벨을 그때 정한다). 하지만
        // 창이 프런트를 띄우고 명령을 부르기까지는 늘 이 대입보다 늦으므로 경합이 없다.
        // `cliopen::open_window_if_unclaimed` 에 같은 근거가 적혀 있다 — 기제를 베낄 때
        // **근거도 같이** 베낀다. 안 그러면 다음 사람이 없는 경합을 고치려 든다.
        match crate::spawn_window(&app) {
            Ok(label) => {
                if let Ok(mut w) = state.cli_window.lock() {
                    *w = Some(label.clone());
                }
                eprintln!("[lapis/cli-render] 받아간 창이 없다 → 새 창 {label}");
            }
            Err(e) => {
                eprintln!("[lapis/cli-render] 새 창을 못 띄웠다: {e}");
                report_unclaimed(&out, "이 vault 를 연 창이 없고, 새 창도 못 띄웠다");
                return;
            }
        }

        // 새 창도 못 받으면 조용히 두지 않는다.
        std::thread::sleep(std::time::Duration::from_millis(give_up_ms));
        if let Some(out) = unclaimed_out(&state) {
            report_unclaimed(&out, "새 창을 띄웠는데도 아무도 이 요청을 받지 않았다");
        }
    });
}

/// 아직 안 가져간 요청의 결과 경로. 비어 있으면 `None`.
fn unclaimed_out(state: &PendingRenderState) -> Option<String> {
    state
        .slot
        .lock()
        .ok()
        .and_then(|slot| slot.as_ref().map(|p| p.out.clone()))
}

fn report_unclaimed(out: &str, message: &str) {
    eprintln!("[lapis/cli-render] 포기: {message}");
    if let Err(e) = write_render_failure(out.to_string(), message.to_string()) {
        eprintln!("[lapis/cli-render] 실패 보고도 못 썼다: {e}");
    }
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

#[cfg(test)]
mod unclaimed_tests {
    use super::*;

    /// 🔴 **아무도 안 가져가면 요청이 영원히 남는다.**
    ///
    /// 실측(v3.10.0 릴리스 빌드): 앱이 어떤 vault 를 연 채로 **그 앱이 안 연 다른 vault** 의
    /// 노트를 렌더 요청했더니 —
    ///
    /// ```text
    /// 두 번째 프로세스 종료: True (코드 0)   ← 성공이라고 답한다
    /// 결과 파일: 없음 — 실패 파일조차 없다
    /// ```
    ///
    /// 부른 쪽은 **타임아웃으로만** 알고, 셸에서 `&&` 로 이으면 그대로 진행된다.
    ///
    /// `cliopen` 은 이 경우를 이미 푼다 — `open_window_if_unclaimed` 가 새 창을 띄우고
    /// 그 라벨을 기억해, 그 창이 기동하며 물을 때 vault 를 안 따지고 받아가게 한다.
    /// 렌더에도 같은 짝이 필요하다.
    fn state_with(slot: Option<PendingRender>, cli_window: Option<&str>) -> PendingRenderState {
        PendingRenderState {
            slot: Mutex::new(slot),
            cli_window: Mutex::new(cli_window.map(|s| s.to_string())),
        }
    }

    fn pending(vault: &str) -> PendingRender {
        PendingRender {
            path: format!("{vault}/n.md"),
            vault: vault.to_string(),
            out: "C:/out/n.png".to_string(),
            format: "png".to_string(),
        }
    }

    #[test]
    fn claims_when_vault_matches() {
        let s = state_with(Some(pending("C:/v")), None);
        assert!(claim(&s, "main", Some("C:/v")).is_some());
        // 가져간 뒤에는 비어 있어야 한다 — 창 둘이 같은 파일에 쓰면 안 된다.
        assert!(claim(&s, "main", Some("C:/v")).is_none());
    }

    /// ⚠️ vault 가 다르면 **비우지 않는다.** 비우면 뒤에 올 진짜 주인이 못 받는다.
    #[test]
    fn keeps_slot_when_vault_differs() {
        let s = state_with(Some(pending("C:/v")), None);
        assert!(claim(&s, "main", Some("C:/other")).is_none());
        assert!(s.slot.lock().unwrap().is_some(), "슬롯이 비었다");
    }

    /// 🔴 이 요청을 위해 **방금 만든 창**은 vault 를 안 따지고 받아간다.
    #[test]
    fn designated_window_claims_regardless_of_vault() {
        let s = state_with(Some(pending("C:/v")), Some("w2"));
        assert!(
            claim(&s, "w2", Some("C:/completely-other")).is_some(),
            "지목된 창이 못 받았다"
        );
    }

    /// ⚠️ 지목되지 않은 창은 여전히 vault 를 따진다 — 아니면 아무 창이나 낚아챈다.
    #[test]
    fn other_windows_still_need_the_vault() {
        let s = state_with(Some(pending("C:/v")), Some("w2"));
        assert!(claim(&s, "main", Some("C:/other")).is_none());
    }

    /// 창이 vault 를 아직 안 열었을 때(`None`) — 지목됐으면 받고, 아니면 안 받는다.
    #[test]
    fn null_vault_only_for_designated() {
        let designated = state_with(Some(pending("C:/v")), Some("w2"));
        assert!(claim(&designated, "w2", None).is_some());

        let plain = state_with(Some(pending("C:/v")), None);
        assert!(claim(&plain, "main", None).is_none());
    }
}

#[cfg(test)]
mod stage_reset_tests {
    use super::*;

    /// 🔴 **새 요청은 지난 창 표식을 무효로 만든다.**
    ///
    /// 차가운 기동이 `main` 을 지목해 두는데(`lib.rs`), 그 표식을 안 지우면 **그 뒤로
    /// 오는 모든 렌더 요청을 `main` 이 vault 와 무관하게 가로챈다.** 프런트는 요청받은
    /// vault 를 열게 돼 있으므로, 사용자가 보던 창의 vault 가 통째로 바뀐다.
    ///
    /// `cliopen::stage` 는 같은 이유로 이미 지운다("새 요청이 왔으니 지난 요청의 창
    /// 표식은 무효다"). 렌더만 빠져 있었다.
    fn pending(vault: &str) -> PendingRender {
        PendingRender {
            path: format!("{vault}/n.md"),
            vault: vault.to_string(),
            out: "C:/out/n.png".to_string(),
            format: "png".to_string(),
        }
    }

    #[test]
    fn new_request_clears_the_window_mark() {
        let state = PendingRenderState {
            slot: Mutex::new(None),
            // 차가운 기동이 남겨 둔 표식.
            cli_window: Mutex::new(Some("main".to_string())),
        };

        stage_into(&state, pending("C:/other-vault"));

        assert_eq!(
            *state.cli_window.lock().unwrap(),
            None,
            "지난 창 표식이 남아 main 이 남의 vault 요청을 가로챈다"
        );
        // 표식이 없으니 vault 가 다른 창은 못 받는다.
        assert!(claim(&state, "main", Some("C:/my-vault")).is_none());
    }

    /// ⚠️ 표식을 지운 **뒤에** 새로 지목하는 순서여야 한다 — 반대면 방금 띄운 창이 못 받는다.
    #[test]
    fn marking_after_stage_still_works() {
        let state = PendingRenderState {
            slot: Mutex::new(None),
            cli_window: Mutex::new(Some("main".to_string())),
        };
        stage_into(&state, pending("C:/other-vault"));
        *state.cli_window.lock().unwrap() = Some("w2".to_string());
        assert!(claim(&state, "w2", None).is_some());
    }
}
