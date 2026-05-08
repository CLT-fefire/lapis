---
project: Lapis
version: v0.1
date: 2026-05-08
author: 정철화 (fefire@dearu.com)
status: inception
type: personal-tool
parent_concept: Obsidian
purpose: 바이브 코딩 셋업 보강
tags: [knowledge-management, markdown, vibe-coding, side-project, obsidian-alternative]
---

# Lapis — 프로젝트 계획서 v0.1

> "당장 적용하지 않아도 사용하는 데 전혀 문제가 없는 게 내 바이브 코딩 셋팅이니까."

---

## 0. TL;DR

**Lapis**는 Obsidian에서 영감을 받아 직접 만드는 **1인용 마크다운 지식 워크벤치**다. 이미 `Lysn_Epic/docs`에 축적된 306개+ 마크다운 자산(plans, brainstorms, solutions, todos, diagrams)을 백링크·태그·그래프 뷰로 항해하기 위한 도구이며, **즉시 도입보다 배움과 통제권 확보가 1차 목표**다.

- **본업 영향도**: 0 (기존 워크플로 그대로, 별개 사이드 프로젝트)
- **시간 투자**: 주말/저녁 단위 점진 개발
- **성공 기준**: 1인 사용자가 Obsidian 핵심 5개 기능을 자기 손으로 만들어 일상에 사용 가능
- **기술 스택 1순위 후보**: **Tauri + SvelteKit + Rust** (대안: macOS 네이티브 SwiftUI)

---

## 1. 배경 (Context)

### 1.1 왜 이걸 만드는가

| 동기 | 설명 |
|---|---|
| **학습** | Obsidian 내부 동작(파서, 백링크 인덱서, 그래프 알고리즘, 플러그인 호스팅)을 직접 구현하며 이해 |
| **통제권** | 마크다운 + frontmatter는 Lysn_Epic 워크플로의 핵심 자산. 외부 도구 의존도 최소화 |
| **재미** | iOS 본업과 다른 스택(Rust/Web/Native macOS)으로 전환되는 학습 회로 |
| **바이브 코딩 정합성** | Claude Code 기반 자율 워크플로(`/lfg`, `/workflows:plan` 등)의 산출물을 잘 보여주는 도구가 필요 |

### 1.2 왜 Obsidian을 그냥 안 쓰고

Obsidian은 1순위 도구로 **여전히 권장**된다. Lapis는 그것을 대체하기 위함이 아니라:
- Obsidian이 채워주지 않는 **Lysn_Epic 특화 통합** 가능성을 확보 (예: STATE.md 자동 갱신, claude-mem 연동, `/diagram` 산출물 자동 인덱싱)
- **에디터 내부**가 어떻게 돌아가는지 알면, 향후 Obsidian 플러그인을 직접 만들 때도 유리
- 사이드 프로젝트로서 단순한 정량적 만족감

### 1.3 비목표 (Non-Goals)

- ❌ Obsidian과의 기능 동등성 (커뮤니티 플러그인 2,000개를 따라잡지 않음)
- ❌ 상용화·배포·다인 협업
- ❌ iOS/Android 모바일 (옵션, 매우 후순위)
- ❌ 실시간 동기화 (git이 사실상 sync 역할)
- ❌ WYSIWYG 마크다운 에디터의 완벽한 구현 (CodeMirror로 충분)

---

## 2. 사용자 시나리오

### 2.1 1차 사용자: 정철화 본인

```text
시나리오 A — 채팅방 버그 분석 중 과거 솔루션 검색
1. Cmd+P로 빠른 스위처 열기
2. "chatroom retain"으로 fuzzy 검색
3. 기존 chatroom-issues/* 솔루션 노트 즉시 점프
4. 백링크 패널에서 그 솔루션을 인용한 plan, brainstorm 자동 표시

시나리오 B — STATE.md 항상 옆에 두기
1. STATE.md 핀 고정
2. 우측 사이드바에 최근 7일 수정된 solutions 동적 목록 (Dataview 유사)
3. 새 solution 추가 시 인덱스 자동 갱신

시나리오 C — 다이어그램 검토
1. .mmd 파일 열면 인라인 Mermaid 렌더
2. 같은 폴더의 svg/png 발행물 자동 매칭하여 사이드바 미리보기
```

### 2.2 2차 사용자: AI 어시스턴트(간접)

Lapis는 마크다운 vault를 **변형하지 않는다**. Claude Code가 평소처럼 grep/Read로 접근. Lapis는 인간이 **항해하는 도구**다.

---

## 3. 스코프

### 3.1 MVP (Iteration 1)

| # | 기능 | 우선순위 | 비고 |
|---|---|---|---|
| 1 | Vault(루트 폴더) 열기 | P0 | 폴더 트리 사이드바 |
| 2 | 마크다운 렌더링 (read 모드) | P0 | GFM, frontmatter 파싱, mermaid 코드블록 렌더 |
| 3 | 마크다운 편집 (CodeMirror 기반) | P0 | source 모드만, 라이브 프리뷰 후순위 |
| 4 | Wikilink `[[...]]` 인식 + 클릭 점프 | P0 | alias `[[file\|alias]]` 지원 |
| 5 | 백링크 패널 | P0 | 현재 노트를 가리키는 모든 wikilink 역참조 |
| 6 | 풀텍스트 검색 (제목 + 본문) | P0 | 한국어 형태소 분석은 후순위 |
| 7 | Quick Switcher (Cmd+P) | P0 | fuzzy 매칭 |
| 8 | Frontmatter Properties 패널 | P1 | YAML 파싱, 키별 값 표시 |
| 9 | 태그 인덱스 | P1 | `#tag` 및 frontmatter `tags:` 통합 |
| 10 | 그래프 뷰 (force-directed) | P1 | wikilink 기반, MVP는 정적 SVG도 OK |

### 3.2 Iteration 2

| # | 기능 | 비고 |
|---|---|---|
| 11 | 라이브 프리뷰 (편집 + 렌더 동시) | CodeMirror 6 decoration |
| 12 | Mermaid 인라인 렌더 (read 모드) | mermaid.js |
| 13 | 다크/라이트 테마 | CSS variables |
| 14 | 일일 노트 (Daily Notes) | 템플릿 기반 |
| 15 | 템플릿 시스템 | frontmatter 자동 채움 (Lysn_Epic 명명 규칙) |
| 16 | Dataview 유사 쿼리 블록 | ` ```lapis-query` 코드블록 → 테이블 |

### 3.3 Iteration 3 (Stretch)

| # | 기능 | 비고 |
|---|---|---|
| 17 | 플러그인 시스템 (JS sandbox) | API surface 최소화 |
| 18 | claude-mem 연동 | observation을 노트로 흡수 |
| 19 | STATE.md 자동 갱신 hook | 파일 시스템 감지 → STATE 정합성 유지 |
| 20 | Excalidraw 유사 캔버스 | 매우 stretch |

### 3.4 명시적 제외

- 모바일 (iOS/Android)
- 실시간 다인 협업
- 클라우드 동기화 서비스
- 결제·계정 시스템
- 마켓플레이스

---

## 4. 기술 스택 결정

### 4.1 후보 비교

| 후보 | 장점 | 단점 | 적합도 |
|---|---|---|---|
| **Tauri + SvelteKit + Rust** | 5–10MB 바이너리, 빠른 파일 I/O, 모던 학습, 크로스 플랫폼 | Rust 학습 곡선, Svelte 5 룬 신문법 | ⭐⭐⭐⭐⭐ |
| Electron + React | 가장 큰 생태계, Obsidian과 동일 스택 | 100MB+ 바이너리, 메모리 사용량 | ⭐⭐⭐ |
| macOS 네이티브 SwiftUI | iOS 본업 스킬 즉시 활용, 최고의 네이티브 UX | macOS 전용, 크로스 플랫폼 포기 | ⭐⭐⭐⭐ |
| VS Code 익스텐션 | 가장 빠른 개발, 마크다운 도구 다수 기존 | "내 앱"이라는 만족감 부재, UI 자유도 낮음 | ⭐⭐ |

### 4.2 1순위 권장: Tauri + SvelteKit

**선정 사유**

1. **바이너리 크기·메모리 효율**: "vibe" 도구는 가벼워야 함. Electron 대비 1/10
2. **Rust 백엔드의 파일 I/O 성능**: 큰 vault(1만 노트+) 인덱싱 시 결정적 차이
3. **iOS와 다른 스택 학습**: 본업과 분리된 두뇌 회로 자극
4. **WebView 기반의 자유도**: 그래프 뷰, 마크다운 렌더 등 웹 라이브러리 활용
5. **Sveltekit의 단순성**: React보다 보일러플레이트 적음, 1인 프로젝트에 적합

### 4.3 2순위 (대안): macOS SwiftUI

**선정 사유** (만약 Tauri가 너무 무겁게 느껴진다면)

1. iOS 본업 스킬 직접 전이 (Swift, Combine, async/await)
2. 네이티브 macOS UX의 최고 수준
3. Apple 플랫폼 한정 → 단순화

**채택 시 트레이드오프**: 크로스 플랫폼 포기, Windows/Linux 사용자(없음) 손절

### 4.4 핵심 라이브러리 (Tauri 기준)

| 영역 | 라이브러리 | 비고 |
|---|---|---|
| 마크다운 파서 | `markdown-it` (JS) 또는 `pulldown-cmark` (Rust) | GFM 지원 |
| Frontmatter | `gray-matter` (JS) 또는 `serde_yaml` (Rust) | YAML 1.1 |
| 에디터 | CodeMirror 6 | 마크다운 모드, 단축키 자유도 |
| 검색 인덱스 | `MiniSearch` (JS) 또는 `tantivy` (Rust) | 풀텍스트 |
| 그래프 시각화 | `cytoscape.js` 또는 `d3-force` | force-directed |
| 파일 감시 | `notify` (Rust) | 외부 변경 자동 반영 |
| Mermaid | `mermaid.js` | 코드블록 렌더 |
| YAML 쿼리 | 자체 미니 DSL | Dataview 영감 |

---

## 5. 아키텍처 개요

### 5.1 모듈 분할

```text
┌─────────────────────────────────────────────────────┐
│                   Frontend (Svelte)                 │
│  - Sidebar (file tree)    - Editor (CodeMirror)     │
│  - Graph view             - Backlink panel          │
│  - Quick switcher         - Properties panel        │
│  - Tag index                                        │
└─────────────────────────────────────────────────────┘
                         ↕ Tauri IPC
┌─────────────────────────────────────────────────────┐
│                  Rust Core (Backend)                │
│  - VaultLoader        - LinkResolver                │
│  - FileWatcher        - Indexer (search + tags)     │
│  - FrontmatterParser  - GraphBuilder                │
└─────────────────────────────────────────────────────┘
                         ↕ FS
┌─────────────────────────────────────────────────────┐
│              Vault (사용자 마크다운 폴더)           │
│  /Users/Shared/Source/SharedDocs/Lysn_Epic 등       │
└─────────────────────────────────────────────────────┘
```

### 5.2 데이터 모델

```rust
struct Note {
    path: PathBuf,
    title: String,
    frontmatter: HashMap<String, Value>,  // YAML
    body: String,                          // 본문 (마크다운)
    aliases: Vec<String>,
    tags: HashSet<String>,
    outbound_links: Vec<WikiLink>,         // 이 노트가 가리키는 노트
    last_modified: SystemTime,
}

struct VaultIndex {
    notes: HashMap<PathBuf, Note>,
    backlinks: HashMap<PathBuf, Vec<PathBuf>>,  // 역참조
    tag_index: HashMap<String, Vec<PathBuf>>,
    full_text: SearchIndex,
}
```

### 5.3 핵심 알고리즘

| 영역 | 접근법 |
|---|---|
| **백링크 계산** | 풀스캔 + 증분. 신규/수정 노트만 재파싱 후 인덱스 패치 |
| **wikilink 해석** | 1) alias 매칭 → 2) 정확한 파일명 → 3) fuzzy fallback |
| **그래프 레이아웃** | d3-force 시뮬레이션, 노드 1만개 이하에서 충분 |
| **검색** | MiniSearch (in-memory). 한국어는 character n-gram fallback |

### 5.4 위협 모델 / 안전성

- **사용자 vault에 쓰기**: 항상 atomic write (`temp file → rename`). 절대 부분 쓰기 금지
- **외부 파일 변경 감지**: `notify` crate로 OS 레벨 이벤트 → 인덱스만 갱신, 사용자 편집 중인 파일은 충돌 경고
- **실수로 vault 외부 접근**: 모든 path를 vault root에 confine

---

## 6. 로드맵 (점진 개발)

### Phase 0: 사전 학습 (1–2주)

- [ ] Tauri quick start 튜토리얼 완주
- [ ] CodeMirror 6 기본 통합 PoC
- [ ] markdown-it + frontmatter 파싱 PoC
- [ ] **결정 게이트**: Tauri 가도 vs SwiftUI 전환

### Phase 1: MVP — 읽기 전용 vault 뷰어 (3–4주)

목표: **Lysn_Epic/docs 폴더를 읽기 전용으로 항해 가능**

- [ ] Vault 열기 (폴더 선택 다이얼로그)
- [ ] 파일 트리 사이드바 + 노트 렌더링
- [ ] Wikilink 클릭 점프
- [ ] 백링크 패널
- [ ] 풀텍스트 검색
- [ ] Quick Switcher (Cmd+P)

### Phase 2: 편집 + 인덱싱 (3–4주)

목표: **CodeMirror로 편집 가능, 저장 시 인덱스 갱신**

- [ ] CodeMirror 통합 + 저장
- [ ] FileWatcher 기반 외부 변경 감지
- [ ] Frontmatter Properties 패널
- [ ] 태그 인덱스
- [ ] 충돌 경고 (외부 변경 + 내부 편집 동시 발생)

### Phase 3: 그래프 + 시각화 (2–3주)

목표: **그래프 뷰 + Mermaid 인라인 렌더**

- [ ] 그래프 뷰 (cytoscape.js)
- [ ] Mermaid 코드블록 렌더
- [ ] 다크/라이트 테마

### Phase 4: 워크플로 통합 (가변)

목표: **Lysn_Epic 워크플로 특화 가치 추가**

- [ ] Daily Note + 템플릿 시스템
- [ ] STATE.md pin + 자동 인덱스 블록
- [ ] Lysn_Epic 명명 규칙 자동 적용 템플릿
- [ ] (검토) claude-mem observation 흡수
- [ ] (검토) `/diagram` 산출물 자동 매칭

### Phase 5: 플러그인 시스템 (Stretch)

목표: **JS API 노출**

- [ ] 플러그인 manifest 스펙
- [ ] Sandboxed 실행 (Web Worker)
- [ ] 플러그인 API surface 최소화 (DOM 직접 접근 금지, IPC 통한 명령만)

---

## 7. 위험 (Risks)

| 위험 | 가능성 | 영향 | 완화책 |
|---|---|---|---|
| Rust 학습 곡선으로 진척 정체 | 중 | 중 | Phase 0에서 명확한 결정 게이트, SwiftUI로 전환 가능 |
| 본업(Lysn_Epic)에서 시간을 빼앗김 | 중 | 고 | 주말·저녁만 / 절대 평일 본업 시간 침범 금지 |
| YAGNI: 안 쓰는 기능 만듦 | 고 | 중 | MVP 스코프(P0 10개) 외 진행 시 의식적 정지 |
| 한국어 검색 품질 부족 | 중 | 저 | 초기엔 character n-gram, 나중에 한국어 형태소 라이브러리 |
| Mermaid 렌더 성능 (큰 다이어그램) | 저 | 저 | 가시 영역만 렌더, lazy load |
| 1인 동기 부족으로 중단 | 중 | 저 | "당장 필요 없음" → 중단해도 Obsidian으로 즉시 회귀 가능 |

---

## 8. 성공 기준

### 8.1 MVP (Phase 1) 성공 조건

- [ ] `/Users/Shared/Source/SharedDocs/Lysn_Epic` 을 vault로 열고 5초 이내 트리 표시
- [ ] 임의 노트의 wikilink 클릭 → 점프 정상 동작
- [ ] "chatroom"으로 검색 → 관련 노트 10개 이내 1초 내 표시
- [ ] 백링크 패널에서 STATE.md를 가리키는 노트들 표시

### 8.2 도구 자립 성공 조건 (Phase 4 이후)

- [ ] 1주일간 Obsidian 없이 Lapis만으로 Lysn_Epic 문서 작업 가능
- [ ] Phase 4 통합 기능 중 최소 1개가 Obsidian보다 명확히 우월

### 8.3 학습 성공 조건 (어떤 Phase에서 멈추든)

- [ ] 마크다운 파서 동작 원리 이해
- [ ] 백링크 인덱싱 알고리즘 이해
- [ ] 그래프 레이아웃 알고리즘(force-directed) 이해
- [ ] Tauri 또는 SwiftUI 둘 중 하나의 데스크톱 앱 개발 흐름 체득

---

## 9. 작업 방식

### 9.1 Lysn_Epic 워크플로 적용

| 산출물 | 위치 |
|---|---|
| 계획서 (이 문서) | `Lapis/docs/PLAN.md` |
| 하위 설계서 (Phase별) | `Lapis/docs/phases/phase-{N}-{topic}.md` |
| 결정 기록 (ADR) | `Lapis/docs/adr/{NNN}-{topic}.md` |
| 다이어그램 | `Lapis/docs/diagrams/{topic}.mmd` (Mermaid 우선, fireworks 변환은 발행 시) |
| Confluence 미러 | 정철화 개인 스페이스 → Common → Lapis |

### 9.2 커밋 규칙

- Lysn_Epic 컨벤션 차용: `[Phase-N] feat: 백링크 인덱서 1차 구현`
- 작은 단위로 자주 (1인 프로젝트라도 회고용)

### 9.3 Confluence 동기화

- 주요 결정사항·Phase 완료 보고만 Confluence에 mirroring
- 매 작업 단위 mirror 의무 없음 (오버헤드 회피)

---

## 10. 다음 단계 (Immediate Next Steps)

1. ✅ 프로젝트 폴더 생성 (이 문서 작성과 함께 완료)
2. ✅ Confluence Common 폴더에 "Lapis" 부모 페이지 + 계획서 미러링
3. ⏳ 사용자 검토·피드백
4. ⏳ Phase 0 시작 결정 (Tauri 튜토리얼 vs SwiftUI 전환)
5. ⏳ 첫 PoC 커밋

---

## 부록 A — 용어

| 용어 | 정의 |
|---|---|
| **Vault** | 마크다운 파일들을 담은 사용자 폴더(=프로젝트 단위) |
| **Note** | 단일 마크다운 파일 (`.md`) |
| **Wikilink** | `[[파일명]]` 또는 `[[파일명\|별칭]]` 형식의 내부 링크 |
| **Backlink** | 현재 노트를 wikilink로 가리키는 다른 노트들의 역참조 |
| **Frontmatter** | 노트 상단의 YAML 블록 (`---` 사이) |
| **Properties** | Frontmatter를 UI에서 편집·조회하는 패널 |
| **Daily Note** | 날짜 기반 자동 생성 노트 |

---

## 부록 B — Obsidian 비교 (참고용)

| 영역 | Obsidian | Lapis (목표) |
|---|---|---|
| 가격 | 개인 무료 | 본인 시간 ∞ |
| 바이너리 크기 | ~150MB (Electron) | <20MB (Tauri) |
| 플러그인 | 2,000+ 커뮤니티 | 자체 구현, Phase 5 stretch |
| 모바일 | iOS/Android (유료 sync) | 미지원 |
| 그래프 뷰 | 화려, 클러스터링 | 기본 force-directed |
| Properties | UI + Dataview | UI + 미니 DSL |
| LiveSync | 유료 | 미지원 (git으로 대체) |

---

## 부록 C — 참고 자료

- Obsidian: https://obsidian.md
- Tauri: https://tauri.app
- CodeMirror 6: https://codemirror.net/
- markdown-it: https://github.com/markdown-it/markdown-it
- cytoscape.js: https://js.cytoscape.org/
- Foam (VS Code 대안): https://foambubble.github.io/foam/
- Logseq (오픈소스 대안): https://logseq.com/
- Zettelkasten 개념: https://en.wikipedia.org/wiki/Zettelkasten

---

**문서 종료**
