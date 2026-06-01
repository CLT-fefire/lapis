# Lapis

> Personal Markdown Knowledge Workbench — 로컬 마크다운을 백링크·태그·검색으로 항해하는 개인용 지식 도구 (macOS)

## 현재 상태

🎉 **v0.9.0 released** — [Releases](https://github.com/CLT-fefire/lapis/releases) (dmg 다운로드, Apple Silicon).

로컬 파일시스템의 `.md`만 다룹니다. 외부 동기화·클라우드 전송은 일절 없습니다.

## 주요 기능

- **에디터/프리뷰 3분할** — CodeMirror 6 편집 + markdown-it 실시간 렌더 + Properties 패널
- **테마** — 라이트 / 다크 / 시스템 3-way (설정에서 전환, 시스템은 macOS 외관 추종)
- **위키링크 & 백링크** — `[[노트]]` 점프 + 역참조 패널
- **태그** — 본문 `#tag` 인덱싱 + 사이드바 태그 탐색
- **검색** — 파일명 fuzzy(⌘P) + 전문 검색(⌘⇧F, tantivy + 한국어 형태소 lindera) + 문서 내 검색(⌘F, regex/대소문자/단어)
- **다이어그램** — Mermaid 코드블록 렌더(라이트/다크 적응) + hover ⬇PNG 내보내기
- **코드 하이라이팅** — 프리뷰 코드블록 구문 강조(Swift/Objective-C 포함 20개 언어)
- **기타** — 사이드바 트리 필터(⌘⇧E)·접기(⌘B), 노트 경로 복사(⌘⇧C), 링크 자동 갱신(dry-run 미리보기 + 백업), claude-mem 메모리 통합(옵션)

## 설치 (사용자)

1. [Releases](https://github.com/CLT-fefire/lapis/releases)에서 최신 `Lapis_x.y.z_aarch64.dmg` 다운로드 (Apple Silicon · macOS 11+)
2. dmg를 열고 `Lapis.app`을 `/Applications`로 드래그
3. **첫 실행만** `Lapis.app` **우클릭 → 열기** → **열기** (Apple Developer ID 서명 빌드, 공증 전 단계라 최초 1회만 필요)

## 개발

```bash
npm install
npm run setup:lindera   # 한국어 형태소 사전 cache (최초 1회 ~50MB)
npm run tauri dev       # 데스크톱 앱 실행 (개발 모드)
```

검증:
```bash
npm run check                  # Frontend 타입 체크 (svelte-check)
cd src-tauri && cargo check    # Rust 타입 체크
npm run tauri build            # 배포 dmg 빌드
```

> `setup:lindera`는 `lindera-ko-dic`가 빌드 시 다운로드하는 mecab-ko-dic 사전을 사전 cache로 박제 — 네트워크 차단 환경(CI/firewall)에서도 `cargo build`가 통과하도록 함.

## 기술 스택

| 구분 | 스택 |
|---|---|
| 앱 | Tauri 2 (macOS 데스크톱, Apple Silicon) |
| Frontend | SvelteKit 2 + Svelte 5 (룬) + TypeScript 5 + Vite 6 |
| Backend | Rust (std::fs/std::path 중심, 외부 crate 최소) |
| 에디터 | CodeMirror 6 |
| 마크다운 | markdown-it 14 + js-yaml + 자체 wikilink 룰 + highlight.js |
| 검색 | tantivy + lindera(ko-dic) · MiniSearch(보조) |
| 다이어그램 | Mermaid |

## 디렉토리 구조

```text
Lapis/
├── src/              # SvelteKit 프론트엔드
│   ├── lib/          # 컴포넌트 + stores/ + markdown/검색/링크 인덱스
│   ├── app.css       # 디자인 토큰 (테마 SOT)
│   └── routes/       # +page.svelte (3분할 워크스페이스)
├── src-tauri/        # Rust 백엔드 (Tauri host)
│   └── src/vault.rs  # list/read/write_note, scan_links, read_vault_bundle …
├── docs/             # 프로젝트 문서 (STATE/PLAN/plans/solutions/adr …)
└── README.md
```

## 문서 · 링크

- [GitHub Releases](https://github.com/CLT-fefire/lapis/releases)
- [팀 Confluence 가이드](https://everysing.atlassian.net/wiki/spaces/IMA/pages/4435017752/Lapis) — 설치·사용·FAQ
- `docs/STATE.md` — 개발 진행 상태 (Source of Truth)

## 라이선스

개인용 / 미정.
