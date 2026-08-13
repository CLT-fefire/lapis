/**
 * vault를 아직 고르지 않았을 때 프리뷰에 띄우는 안내 문서.
 *
 * 코드가 아니라 **콘텐츠**다. `+page.svelte` 안에 있으면 단축키 하나 바꿀 때마다
 * 페이지 로직 파일을 열게 되고(⌘G 제거 때 실제로 그랬다), diff에서 로직 변경과
 * 문안 수정이 섞인다.
 *
 * ⚠️ 여기 적힌 단축키는 `keymap.ts`와 손으로 맞춰야 한다 — 자동 동기화가 없다.
 */
export const WELCOME_DOC = `---
title: Lapis 시작하기
status: welcome
tags: [welcome, getting-started]
---

# Lapis에 오신 것을 환영합니다

**Lapis**는 로컬 마크다운 파일을 백링크 · 태그 · 그래프로 항해하는 개인용 워크벤치입니다.
모든 노트는 로컬 파일시스템에만 저장되며, 외부 동기화는 일절 일어나지 않습니다.

## 시작하기

좌측 사이드바 상단의 **Vault 열기…** 버튼으로 마크다운이 들어 있는 폴더를 선택하세요.
선택 후 트리에서 노트를 클릭하면 이 영역에 본문이, 우측에 렌더링이 표시됩니다.

### 추천 vault 경로

- 개인 노트: \`~/Documents/Notes\`
- 프로젝트 문서: \`/Users/Shared/Source/<프로젝트>/docs\`
- 빈 폴더를 새로 만들어도 됩니다 — 첫 노트는 사이드바의 "Welcome 샘플 만들기" 버튼으로 만들 수 있어요.

## 핵심 단축키

| 단축키 | 동작 |
|---|---|
| \`⌘K\` | Command Palette — 모든 명령 검색 |
| \`⌘P\` | Quick File Open — 파일명 fuzzy 검색 |
| \`⌘⇧F\` | Full-text 검색 (BM25 + 한글 bigram) |
| \`⌘F\` | 현재 노트 내 검색 |
| \`⌘N\` | 새 노트 만들기 |
| \`⌘S\` | 즉시 저장 (편집 시 2초마다 자동 저장됨) |
| \`F2\` | 현재 노트 이름 변경 *(Mac 매직 키보드 기본은 F2가 밝기 — \`Fn+F2\` 또는 키보드 설정에서 "F1, F2를 표준 기능 키로" 켜기. 안 되면 \`⌘K\` → "Rename")* |
| \`⌘⌫\` | 현재 노트 휴지통으로 |

## 자세한 가이드

설치 · 사용 · FAQ는 [팀 Confluence 페이지](https://github.com/eren0315/lapis)에 정리되어 있습니다.

GitHub: <https://github.com/CLT-fefire/lapis>
`;
