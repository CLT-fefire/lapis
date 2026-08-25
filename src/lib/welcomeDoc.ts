/**
 * vault를 아직 고르지 않았을 때 프리뷰에 띄우는 안내 문서 + 빈 vault용 샘플 노트.
 *
 * 코드가 아니라 **콘텐츠**다. `+page.svelte` 안에 있으면 단축키 하나 바꿀 때마다
 * 페이지 로직 파일을 열게 되고(⌘G 제거 때 실제로 그랬다), diff에서 로직 변경과
 * 문안 수정이 섞인다.
 *
 * ⚠️ 여기 적힌 단축키는 `keymap.ts`와 손으로 맞춰야 한다 — 자동 동기화가 없다.
 *
 * ⚠️ **Paraglide 메시지로 넣지 않는다.** 이건 UI 라벨이 아니라 마크다운 문서다.
 * 수십 줄짜리 본문을 JSON 한 줄에 `\n`으로 밀어넣으면 리뷰도 편집도 못 한다.
 * 로케일별 템플릿을 나란히 두고 **호출 시점에** 고른다(모듈 상수로 굳히면
 * 로케일 변경을 못 따라온다 — `lens.ts`에서 겪은 것과 같은 함정).
 */

import { getLocale } from "$lib/paraglide/runtime.js";
import { localizeShortcutsInMarkdown } from "$lib/shortcutLabel";

const WELCOME_DOC_EN = `---
title: Getting started with Lapis
status: welcome
tags: [welcome, getting-started]
---

# Welcome to Lapis

**Lapis** is a personal workbench for navigating local Markdown files through backlinks, tags, and graphs.
Every note stays on your local filesystem — nothing is ever synced anywhere.

## Getting started

Use the **Open vault…** button at the top of the sidebar to pick a folder that contains Markdown.
Once you click a note in the tree, its source appears here and the rendered view on the right.

### Suggested vault paths

- Personal notes: \`~/Documents/Notes\`
- Project docs: \`~/Source/<project>/docs\`
- A brand-new empty folder works too — create your first note with the sidebar's "Create Welcome sample" button.

## Essential shortcuts

| Shortcut | Action |
|---|---|
| \`⌘K\` | Command Palette — search every command |
| \`⌘P\` | Quick File Open — fuzzy search by file name |
| \`⌘⇧F\` | Full-text search (BM25 + Korean bigram) |
| \`⌘F\` | Search inside the current note |
| \`⌘N\` | New note |
| \`⌘S\` | Save now (edits autosave every 2s) |
| \`F2\` | Rename the current note *(on a Mac Magic Keyboard F2 is brightness by default — use \`Fn+F2\`, or enable "Use F1, F2, etc. keys as standard function keys". Otherwise \`⌘K\` → "Rename")* |
| \`⌘⌫\` | Move the current note to the Trash |

## Learn more

Installation, the full shortcut list, and the FAQ live in the repository README.

GitHub: <https://github.com/eren0315/lapis>
`;

const WELCOME_DOC_KO = `---
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
- 프로젝트 문서: \`~/Source/<프로젝트>/docs\`
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

## 더 알아보기

설치 · 단축키 전체 · FAQ는 저장소 README에 정리되어 있습니다.

GitHub: <https://github.com/eren0315/lapis>
`;

const WELCOME_NOTE_EN = `---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to Lapis

This note is a sample for learning your way around Lapis. Edit or delete it freely.

## Wikilink examples

Link to another note with \`[[NoteName]]\`. Aliases work too: \`[[Welcome|Intro]]\`.
If the target does not exist yet it shows as a grey dashed link (for example [[not-yet-written]]).

## Tags

Write \`#tagname\` in the body and it is collected automatically. For example: #welcome #intro.
The sidebar **Tags** tab lists every tag.

## Mermaid diagrams

Set \`mermaid\` as the language of a code fence and the preview renders it automatically.

\`\`\`mermaid
graph LR
  A[Write a note] --> B[Link with wikilinks]
  B --> C[Explore the graph]
  C --> D[Organize knowledge]
\`\`\`

## Shortcuts

| Shortcut | Action |
|---|---|
| \`⌘K\` | Command Palette |
| \`⌘P\` | Quick File Open |
| \`⌘⇧F\` | Full-text search |
| \`⌘F\` | Search in note |
| \`⌘N\` | New note |
| \`⌘S\` | Save now |
| \`F2\` | Rename note *(on a Mac Magic Keyboard use \`Fn+F2\`, or \`⌘K\` → "Rename")* |
| \`⌘⌫\` | Move note to Trash |

## Next steps

1. Press \`⌘N\` and write your first note
2. Add \`[[Welcome]]\` to its body so it points here, then check **Backlinks** at the bottom of the sidebar
3. Open the graph to visualize how your notes connect
`;

const WELCOME_NOTE_KO = `---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to Lapis

이 노트는 Lapis 사용법을 익히기 위한 샘플입니다. 자유롭게 편집하거나 삭제하세요.

## Wikilink 예제

다른 노트로의 링크는 \`[[노트이름]]\`으로 작성합니다. 별칭도 가능: \`[[Welcome|환영]]\`.
대상 노트가 없으면 회색 점선으로 표시됩니다 (예: [[아직-없는-노트]]).

## 태그

본문에 \`#태그명\` 형식으로 작성하면 자동 수집됩니다. 예: #welcome #intro.
사이드바 **Tags** 탭에서 모든 태그를 확인할 수 있습니다.

## Mermaid 다이어그램

코드 펜스에 \`mermaid\` 언어를 지정하면 미리보기에서 자동 렌더링됩니다.

\`\`\`mermaid
graph LR
  A[노트 작성] --> B[wikilink 연결]
  B --> C[그래프 탐색]
  C --> D[지식 정리]
\`\`\`

## 단축키 모음

| 단축키 | 동작 |
|---|---|
| \`⌘K\` | Command Palette |
| \`⌘P\` | Quick File Open |
| \`⌘⇧F\` | Full-text 검색 |
| \`⌘F\` | 노트 내 검색 |
| \`⌘N\` | 새 노트 |
| \`⌘S\` | 즉시 저장 |
| \`F2\` | 노트 이름 변경 *(Mac 매직 키보드는 \`Fn+F2\` 또는 \`⌘K\` → "Rename")* |
| \`⌘⌫\` | 노트 휴지통으로 |

## 다음 단계

1. \`⌘N\`으로 첫 노트를 만들어보세요
2. 본문에 \`[[Welcome]]\`을 적어 이 노트를 가리키게 한 뒤, 사이드바 하단 **Backlinks**를 확인하세요
3. 그래프를 열어 노트 연결을 시각화해보세요
`;

/** vault 미선택 시 프리뷰에 띄우는 안내 문서. 호출 시점 로케일로 고른다. */
export function welcomeDoc(): string {
  return localizeShortcutsInMarkdown(getLocale() === "ko" ? WELCOME_DOC_KO : WELCOME_DOC_EN);
}

/**
 * 빈 vault에서 "Welcome 샘플 만들기"가 실제로 **디스크에 쓰는** 노트 본문.
 *
 * ⚠️ UI 문구와 달리 이건 파일이 된다 — 만든 뒤 로케일을 바꿔도 이미 쓰인 파일은
 * 그대로다. 만들 때의 언어로 남는 게 맞다(사용자 문서를 앱이 나중에 바꾸면 안 된다).
 */
export function welcomeNote(): string {
  return localizeShortcutsInMarkdown(getLocale() === "ko" ? WELCOME_NOTE_KO : WELCOME_NOTE_EN);
}
