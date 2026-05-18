# Lapis

> Personal Markdown Knowledge Workbench — Obsidian에 영감을 받은 1인 바이브 코딩용 지식 도구

## 한 줄 소개

`docs/` 폴더의 마크다운 자산(plans, brainstorms, solutions, todos, diagrams)을 백링크·태그·그래프 뷰로 항해하기 위한 개인용 도구. 즉시 적용보다 **배움과 통제권 확보**가 1차 목표.

## 현재 상태

🌱 **Phase 0** — 사전 학습 / PoC 단계.

- [x] 프로젝트 폴더 생성
- [x] 계획서 작성 ([docs/PLAN.md](docs/PLAN.md))
- [x] 기술 스택 확정 — **Tauri 2 + SvelteKit + TypeScript + Rust**
- [x] Tauri 앱 스캐폴딩 (`npm create tauri-app`, svelte-ts 템플릿)
- [ ] `npm run tauri dev` 첫 실행
- [ ] CodeMirror 6 통합 PoC
- [ ] markdown-it + frontmatter 파싱 PoC

## 빠른 시작

```bash
cd /Users/Shared/Source/Lapis
npm install
npm run setup:lindera   # 한국어 형태소 사전 cache 셋업 (최초 1회 ~50MB 다운로드)
npm run tauri dev       # 데스크톱 앱 실행 (개발 모드)
```

> `setup:lindera`는 `lindera-ko-dic` build script가 build 시점에 mecab-ko-dic을
> 다운로드하는 동작을 사전에 cache로 박제한다. 네트워크가 차단된 환경
> (sandbox/CI/enterprise firewall)에서도 `cargo build`가 통과하도록 함.

## 디렉토리 구조

```text
Lapis/
├── src/              # SvelteKit 프론트엔드 (TypeScript)
├── src-tauri/        # Rust 백엔드 (Tauri)
│   ├── src/
│   │   ├── main.rs
│   │   └── lib.rs    # tauri::Builder + #[tauri::command]
│   ├── Cargo.toml
│   └── tauri.conf.json
├── static/           # 정적 자산
├── docs/             # 프로젝트 문서 (PLAN, ADR 등)
├── assets/           # 이미지·아이콘 등 디자인 자산
└── README.md
```

## 문서

- [PLAN.md](docs/PLAN.md) — 프로젝트 계획서 (한국어, Source of Truth)
- Confluence 미러: 정철화 개인 스페이스 → Common → Lapis (생성 예정)

## 라이선스

개인용 / 미정.
