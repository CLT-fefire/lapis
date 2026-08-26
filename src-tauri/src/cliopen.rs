//! `lapis open <노트>` 의 앱 쪽 절반 — CLI가 지목한 노트를 여는 경로.
//!
//! ## 전달 수단이 왜 argv인가
//!
//! README 설계 원칙이 **"네트워킹 코드는 없다"** 이다. 실행 중인 앱을 조작하려면 IPC가
//! 필요한데 localhost 서버를 열면 그 원칙이 깨지고, 더 나쁘게는 **로컬의 아무 프로세스나**
//! vault를 조작할 수 있는 표면이 생긴다. MCP를 기본 OFF로 두고 "앱이 정할 수 있는 건
//! 질의를 받아줄지뿐"이라고 못박은 태도와 정면으로 어긋난다.
//!
//! `tauri-plugin-single-instance`는 리스닝 포트 없이 그걸 한다 — 앱을 다시 실행하면
//! **argv가 실행 중인 인스턴스로 전달되고** 두 번째 프로세스는 그대로 죽는다.
//!
//! ## ⚠️ 그 플러그인을 아무 데나 켜면 안 되는 이유 둘
//!
//! ### ① 헤드리스를 통째로 삼킨다
//!
//! 두 번째 인스턴스는 argv를 넘긴 뒤 **`std::process::exit(0)`** 한다. 앱이 떠 있는 동안
//! `lapis.exe --headless export-index`를 부르면 결과 파일을 **쓰지도 않고 성공(0)으로
//! 끝난다.** CLI 입장에서는 "왜 결과가 없지"가 되고, 원인은 어디에도 안 남는다.
//!
//! → 그래서 `lib.rs`가 **헤드리스가 아닐 때만** 플러그인을 등록한다.
//!
//! ### ② dev와 릴리즈가 서로를 죽인다
//!
//! 잠금 키는 `app.config().identifier` 하나에서 나온다(Windows에서는 `{id}-sim` 뮤텍스).
//! **커스터마이즈 지점이 없다.** Lapis는 dev와 릴리즈가 identifier를 공유하므로
//! (`paths.rs` 참고 — 릴리즈 경로를 못 바꾸니 dev만 접미사를 붙였다), 플러그인을 양쪽에
//! 켜면 **릴리즈가 떠 있을 때 dev 앱이 안 뜬다.** 둘을 동시에 띄워 쓰는 게 이 프로젝트의
//! 개발 방식이라 그건 회귀다.
//!
//! → 그래서 `lib.rs`가 **릴리즈 빌드에서만** 등록한다.
//!
//! ## 창이 여럿일 때 누가 여나 — 창이 스스로 고른다
//!
//! Rust는 어느 창이 어느 vault를 열었는지 모른다(그건 창별 localStorage다). 그래서
//! 묻지 않고 **꺼내가게** 한다:
//!
//! 1. Rust가 열 것을 `PendingOpen`에 담는다.
//! 2. 모든 창에 `cli:open`을 알린다.
//! 3. 각 창이 **자기 vault를 인자로** `take_pending_open`을 부른다. vault가 맞는 창만
//!    받아간다. 꺼내기는 원자적이라 둘이 동시에 받는 일이 없다.
//! 4. 아무도 안 가져갔으면 그 vault를 연 창이 없다는 뜻이다 → 새 창을 띄우고, 그 창이
//!    `vault: None`으로 물어 무엇이든 받아간다.
//!
//! **차가운 기동도 같은 경로다.** 앱이 꺼져 있었으면 2번이 아무에게도 안 닿고, 첫 창이
//! 뜨면서 4번의 질문을 던져 받아간다. 타이밍 경합이 없다 — 창이 준비됐을 때 묻기 때문이다.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::uipath::to_ui;

/// CLI가 지목한 열 것. 아직 아무 창도 가져가지 않은 상태로 여기 머문다.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingOpen {
    /// 노트 절대 경로(UI 정규형).
    pub path: String,
    /// 그 노트가 속한 vault 루트(UI 정규형). 어느 창이 받을지 이걸로 가른다.
    pub vault: String,
}

#[derive(Default)]
pub struct PendingOpenState {
    slot: Mutex<Option<PendingOpen>>,
    /// 이 요청을 위해 **방금 만든** 창의 라벨. 그 창만 vault를 안 따지고 받아간다.
    ///
    /// ## ⚠️ 표식을 URL로 넘기려다 실패했다
    ///
    /// 처음엔 새 창을 `index.html?cli-open=1`로 열고 프론트가 `location.search`를 보게
    /// 했다. **동작하지 않는다** — `WebviewUrl::App`은 `PathBuf`를 받아서 `?`가 쿼리가
    /// 아니라 **경로의 일부로 인코딩된다.** 창은 뜨는데 표식이 안 보여 아무도 안 받아갔다
    /// (실측: 로그에 "새 창 w2"만 남고 "가져감"이 없었다).
    ///
    /// 애초에 넘길 이유가 없었다. **창을 만든 게 Rust이므로 라벨을 이미 안다.** 프로세스
    /// 경계를 건너는 문자열이 하나 줄고, 그만큼 어긋날 자리도 줄었다.
    cli_window: Mutex<Option<String>>,
}

/// argv에서 `--open <경로> --open-vault <루트>`를 읽는다.
///
/// ⚠️ 모르는 인자는 **그냥 넘긴다**(헤드리스와 다르다). 여기 오는 argv는 사용자가 친 게
/// 아니라 OS·런처가 붙인 것도 섞인다 — macOS의 `-psn_…`처럼. 거기서 까다롭게 굴면
/// 평범한 실행이 실패한다.
pub fn parse_open<I: Iterator<Item = String>>(args: I) -> Option<PendingOpen> {
    let args: Vec<String> = args.collect();
    let mut path = None;
    let mut vault = None;
    for (i, a) in args.iter().enumerate() {
        match a.as_str() {
            "--open" => path = args.get(i + 1).cloned(),
            "--open-vault" => vault = args.get(i + 1).cloned(),
            _ => {}
        }
    }
    // 둘 다 있어야 한다. vault 없이 경로만 오면 어느 창이 받을지 정할 수 없다.
    match (path, vault) {
        (Some(path), Some(vault)) => Some(PendingOpen {
            path: to_ui(std::path::Path::new(&path)),
            vault: to_ui(std::path::Path::new(&vault)),
        }),
        _ => None,
    }
}

/// 열 것을 담아두고 모든 창에 알린다.
///
/// 이미 담긴 게 있으면 **덮어쓴다** — 마지막에 친 명령이 사용자의 의도다.
pub fn stage(app: &AppHandle, open: PendingOpen) {
    let open_desc = format!("{} (vault {})", open.path, open.vault);
    if let Some(state) = app.try_state::<PendingOpenState>() {
        if let Ok(mut slot) = state.slot.lock() {
            *slot = Some(open);
        }
        // 새 요청이 왔으니 지난 요청의 창 표식은 무효다.
        if let Ok(mut w) = state.cli_window.lock() {
            *w = None;
        }
    }
    // ⚠️ 이 계열 로그를 남기는 이유 — **성공해도 실패해도 흔적이 없는 기능이다.**
    // 인자가 안 맞으면 앱은 그냥 평범하게 켜지고(모르는 인자는 일부러 넘긴다), 사용자
    // 눈에는 "노트가 안 열렸다"만 보인다. 드물게 일어나는 일이라 로그가 시끄럽지도 않다.
    eprintln!("[lapis/cli-open] 담음: {}", open_desc);
    // 실패해도 앱을 세우지 않는다 — 창이 없을 수도 있고(차가운 기동), 그때는 첫 창이
    // 뜨면서 스스로 물어본다.
    if let Err(e) = app.emit("cli:open", ()) {
        eprintln!("[lapis/cli-open] 알림 실패: {e}");
    }
}

/// 이 창을 "CLI가 열게 한 창"으로 표시한다 — vault를 안 따지고 받아가게 된다.
///
/// ⚠️ **차가운 기동에 필요하다.** 앱이 꺼져 있을 때 `lapis open`이 불렀다면 `main` 창은
/// 바로 그 요청 때문에 뜬 것이다. 표시하지 않으면 main은 자기가 마지막에 열었던 vault로
/// 묻고, 노트가 **다른 vault**에 있으면 아무도 안 받아간다. 그리고 그 경우엔 아무도
/// 안 받아갔을 때 새 창을 띄우는 타이머도 안 돈다(그건 앱이 이미 떠 있을 때만 건다).
pub fn mark_cli_window(app: &AppHandle, label: &str) {
    if let Some(state) = app.try_state::<PendingOpenState>() {
        if let Ok(mut w) = state.cli_window.lock() {
            *w = Some(label.to_string());
        }
    }
}

/// 창이 "내 것이면 달라"고 묻는다.
///
/// 주는 조건은 둘 중 하나다:
///
/// - **이 요청을 위해 만든 창**이다(라벨로 판정). vault를 안 따진다 — 그러라고 만들었다.
/// - `vault`가 담긴 것과 **정확히 일치**한다.
///
/// ⚠️ `vault: None`은 "무엇이든 달라"가 **아니다.** 그렇게 두면 vault를 아직 안 연 창이
/// 남을 위한 노트를 가로챈다. 기동 직후 모든 창의 vault가 `None`이라 실제로 일어난다.
///
/// ⚠️ 꺼내기는 **원자적**이다(`take`). 안 그러면 창 둘이 같은 노트를 각자 열고 둘 다
/// 자기가 포커스를 가져간다.
#[tauri::command]
pub fn take_pending_open(
    window: tauri::Window,
    state: tauri::State<'_, PendingOpenState>,
    vault: Option<String>,
) -> Option<PendingOpen> {
    let mine = state
        .cli_window
        .lock()
        .ok()
        .map(|w| w.as_deref() == Some(window.label()))
        .unwrap_or(false);

    let mut slot = state.slot.lock().ok()?;
    let pending = slot.as_ref()?;
    let matches = vault
        .as_deref()
        .is_some_and(|v| to_ui(std::path::Path::new(v)) == pending.vault);
    if !mine && !matches {
        return None;
    }
    let taken = slot.take();
    if let Some(t) = &taken {
        eprintln!(
            "[lapis/cli-open] {} 이(가) 가져감: {}",
            window.label(),
            t.path
        );
    }
    taken
}

/// 아무 창도 안 가져갔으면 새 창을 띄운다.
///
/// ⚠️ 알림을 보낸 **직후**에 확인하면 안 된다. 프론트가 이벤트를 받고 명령을 되부를
/// 시간이 필요하다. 그래서 짧게 기다린다 — 못 기다리면 vault를 이미 연 창이 있는데도
/// 창을 하나 더 띄우게 된다.
pub fn open_window_if_unclaimed(app: &AppHandle, wait_ms: u64) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(wait_ms));
        let Some(state) = app.try_state::<PendingOpenState>() else {
            return;
        };
        let unclaimed = state
            .slot
            .lock()
            .ok()
            .map(|slot| slot.is_some())
            .unwrap_or(false);
        if !unclaimed {
            return;
        }
        // 그 vault를 연 창이 없다. 새 창을 띄우고 **그 라벨을 기억해** 두면, 그 창이
        // 기동하면서 묻는 순간 vault를 안 따지고 받아간다.
        //
        // ⚠️ 라벨을 창을 만들기 **전에** 기억할 수는 없다(라벨을 그때 정한다). 하지만
        // 창이 프론트를 띄우고 명령을 부르기까지는 늘 이 대입보다 늦으므로 경합이 없다.
        match crate::spawn_window(&app) {
            Ok(label) => {
                if let Ok(mut w) = state.cli_window.lock() {
                    *w = Some(label.clone());
                }
                eprintln!("[lapis/cli-open] 받아간 창이 없다 → 새 창 {label}");
            }
            Err(e) => eprintln!("[lapis/cli-open] 새 창 실패: {e}"),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn 경로와_vault를_읽는다() {
        let got = parse_open(v(&["--open", "/v/a.md", "--open-vault", "/v"]).into_iter());
        assert_eq!(
            got,
            Some(PendingOpen {
                path: "/v/a.md".into(),
                vault: "/v".into()
            })
        );
    }

    /// vault 없이 경로만 오면 어느 창이 받을지 정할 수 없다.
    #[test]
    fn 짝이_안_맞으면_없다() {
        assert!(parse_open(v(&["--open", "/v/a.md"]).into_iter()).is_none());
        assert!(parse_open(v(&["--open-vault", "/v"]).into_iter()).is_none());
    }

    /// ⚠️ 평범한 기동의 argv에는 OS가 붙인 것도 섞인다. 까다롭게 굴면 앱이 안 뜬다.
    #[test]
    fn 모르는_인자는_넘긴다() {
        let got = parse_open(
            v(&[
                "-psn_0_12345",
                "--open",
                "/v/a.md",
                "--flag",
                "--open-vault",
                "/v",
            ])
            .into_iter(),
        );
        assert!(got.is_some());
        assert!(parse_open(v(&["-psn_0_12345"]).into_iter()).is_none());
    }

    #[test]
    fn 인자가_없으면_없다() {
        assert!(parse_open(v(&[]).into_iter()).is_none());
    }

    /// Windows에서 CLI가 넘긴 역슬래시 경로가 프론트의 `/` 정규형과 맞아야 vault 비교가
    /// 성립한다. 안 그러면 **일치하는 창이 있는데도 아무도 안 받아가** 창이 하나 더 뜬다.
    #[cfg(windows)]
    #[test]
    fn windows_경로를_정규화한다() {
        let got = parse_open(v(&["--open", r"C:\v\a.md", "--open-vault", r"C:\v"]).into_iter())
            .expect("읽어야 한다");
        assert_eq!(got.path, "C:/v/a.md");
        assert_eq!(got.vault, "C:/v");
    }
}
