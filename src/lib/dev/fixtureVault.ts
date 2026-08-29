/**
 * dev 전용 **픽스처 vault** — 브라우저에서 앱 전체를 돌리기 위한 것.
 *
 * ## ⚠️ 왜 필요했나
 *
 * Tauri 밖(브라우저 프리뷰)에서는 `invoke` 가 없어 vault 를 못 연다. 그래서 이 세션에서
 * **필터 패널 · 표 · 진단 모달 · 새 노트 모달을 한 번도 화면으로 못 봤고**, 그 결과
 * 칩 활성 표시가 빠진 채로 두 릴리스가 나갔다(폴더 축 v3.1.0 · 임의 축 v3.3.0).
 *
 * 순수 함수 테스트도 배선 가드도 그것을 못 잡았다 — `class:active` 는 제대로 걸려
 * 있었고 **CSS 규칙만 없었다.**
 *
 * ## ⚠️ 이것은 진짜 vault 가 아니다
 *
 * 실제 Rust 백엔드가 하는 것(원자적 쓰기 · 경로 이탈 검사 · 감시자 · 캐시)을 흉내내지
 * 않는다. 여기서 되는 것이 실물에서 된다는 보장은 **없다.** 이 픽스처가 답하는 질문은
 * 하나다 — **"화면이 제대로 그려지나."**
 *
 * 그래서 화면에 픽스처라는 표시를 남긴다. 표시가 없으면 프리뷰에서 본 것을 실물로
 * 착각하게 되고, 그게 이 도구가 만들 수 있는 최악의 실수다.
 */

import { TEMPLATE_DIR } from "$lib/noteTemplate";

export const DEV_VAULT = "/dev-vault";

/** 저장하면 가짜가 거부하는 경로 — 실패 배너를 화면에서 보기 위한 것. */
export const FIXTURE_READONLY = `${DEV_VAULT}/lapis/reference/읽기전용.md`;

/**
 * 가짜 git 이력. 실제 git 은 없다 — **되돌아보기 화면이 그려지는지**만 답한다.
 *
 * ⚠️ `timestamp` 는 epoch **초**다(ms 아님). 밀리초를 넣으면 화면이 서기 5만년을 그린다.
 */
export const FIXTURE_COMMITS = [
  {
    hash: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    short: "a1b2c3d",
    author: "lapis",
    timestamp: 1787900000,
    subject: "표 예시에 빈 칸 행을 넣었다",
  },
  {
    hash: "b2c3d4e5f60718293a4b5c6d7e8f901234567890",
    short: "b2c3d4e",
    author: "lapis",
    timestamp: 1787810000,
    subject: "작업 목록 — 코드 블록 안은 세지 않는다",
  },
  {
    hash: "c3d4e5f60718293a4b5c6d7e8f90123456789012",
    short: "c3d4e5f",
    author: "lapis",
    timestamp: 1787720000,
    subject: "slate 계획 status 를 완료로",
  },
];

export interface FixtureNote {
  rel: string;
  body: string;
}

/**
 * 기능마다 물 것이 있게 짠다 — 실측 vault 의 모양을 본떴다.
 *
 * - `status` 가 갈려 있다(완료 · 구현 완료 · 진행 중 · 미착수) → 임의 축 필터 · props 감사
 * - 표 · 코드블록 · 작업 목록 → 본문 상호작용
 * - 같은 이름 노트 둘(`STATE`) → 모호한 이름 감사
 * - 3단계 태그 · 정확 태그를 겸한 접두사 → 태그 트리
 * - 끊긴 링크 · 아무도 안 가리키는 노트 → 진단 넷
 */
export const FIXTURE_NOTES: FixtureNote[] = [
  {
    rel: "HOME.md",
    body: `---
title: 시작점
doc_kind: state
topic: overview
tags: [dev]
status: 진행 중
date: 2026-08-01
---

# 시작점

여기서 갈라진다 — [[lapis-계획]] · [[slate-계획]] · [[표-예시]] · [[작업-목록]].

⚠️ [[STATE]] 는 **일부러 모호하다** — lapis 와 slate 양쪽에 같은 이름이 있다.
읽는 자리에서 모호한 링크가 어떻게 보이는지 확인하기 위한 것이다.

아무도 이 노트를 가리키지 않는다(진입점이라 당연하다).
`,
  },
  {
    rel: "lapis/plans/lapis-계획.md",
    body: `---
title: lapis 계획
doc_kind: plan
topic: search
tags: [lapis, subject/search]
status: 진행 중
date: 2026-08-20
---

# lapis 계획

[[표-예시]] 를 참고한다. [[없는-노트]] 는 끊긴 링크다.
`,
  },
  {
    rel: "lapis/reference/STATE.md",
    body: `---
title: lapis 상태
doc_kind: state
topic: overview
tags: [lapis]
status: 완료
date: 2026-08-28
---

# lapis 상태

이름이 겹치는 노트가 하나 더 있다.
`,
  },
  {
    rel: "slate/plans/slate-계획.md",
    body: `---
title: slate 계획
doc_kind: plan
topic: cards
tags: [slate, subject/cards, subject/cards/review]
status: 완료
date: 2026-08-10
---

# slate 계획

lapis 와 같은 \`doc_kind\` 를 쓴다 — 그래서 폴더 축이 필요하다.
`,
  },
  {
    rel: "slate/reference/STATE.md",
    body: `---
title: slate 상태
doc_kind: state
topic: overview
tags: [slate]
status: 완료
date: 2026-08-27
---

# slate 상태

\`lapis/reference/STATE.md\` 와 **파일 이름이 같다** — 모호한 이름.
`,
  },
  {
    rel: "lapis/reference/표-예시.md",
    body: `---
title: 표 예시
doc_kind: reference
topic: ui
tags: [lapis, subject/ui]
status: 진행 중
date: 2026-08-25
---

# 표 예시

머리글을 눌러 정렬해 본다. 숫자 열이 문자열로 정렬되면 10 이 9 앞에 온다.

| 이름 | 수 | 비고 |
|---|---|---|
| 나 | 2 | 가운데 |
| 가 | 10 | 가장 큼 |
| 다 | 1 | 가장 작음 |
| 라 |  | 빈 칸은 뒤로 |

\`\`\`bash
# 코드블록 — 복사 버튼이 붙는다
npm run check && npm test
\`\`\`

\`\`\`ts
const x: number = 1;
\`\`\`
`,
  },
  {
    rel: "lapis/todos/작업-목록.md",
    body: `---
title: 작업 목록
doc_kind: todos
topic: overview
tags: [lapis]
status: 진행 중
date: 2026-08-28
---

# 작업 목록

- [ ] 체크박스가 글자가 아니라 상자로 보인다
- [x] 끝난 것은 흐리게
- [ ] 부모
  - [ ] 자식 — 들여쓰기가 유지된다
- [ ] [[표-예시]] 안의 링크도 살아 있다

\`\`\`bash
# ⚠️ 코드 블록 안은 세지 않는다
- [ ] 이건 예시일 뿐
\`\`\`
`,
  },
  {
    // ⚠️ **쓰기가 실패하는 경로.** 실패 배너는 되돌릴 수 없는 쓰기가 깨졌을 때만 뜨는데,
    //    가짜 백엔드가 항상 성공하면 그 화면을 **한 번도 못 본다.**
    //
    // ⚠️ `status: 구현 완료` 는 **오타가 아니다.** 다른 노트들은 `완료` 라, vault 진단의
    //    "속성" 탭(값이 갈린 축)이 이 한 건으로 켜진다. 통일하면 그 화면이 다시 빈다.
    //
    // ⚠️ `완료됨` 으로 두면 **안 잡힌다.** 감사의 경계 규칙이 접두·접미 뒤에 글자가
    //    오면 다른 낱말로 보기 때문이다(`완료`/`미완료` 오보 방지). 공백 경계가 있어야 한다.
    rel: "lapis/reference/읽기전용.md",
    body: `---
title: 저장이 실패하는 노트
doc_kind: reference
topic: ui
tags: [lapis]
status: 구현 완료
date: 2026-08-26
---

# 저장이 실패하는 노트

이 노트를 저장하면 가짜 백엔드가 **거부한다**. 실패 배너가 어떻게 보이는지 확인하는 용도다.

⚠️ [[표-예시]] 로 나가는 링크가 **일부러** 있다. 그 노트의 이름을 바꾸면 링크 재작성이
이 노트에서 실패하고, 그게 실패 배너가 뜨는 실제 경로다 — 배너는 되돌릴 수 없는 쓰기가
깨졌을 때만 뜬다.
`,
  },
  {
    rel: TEMPLATE_DIR + "/계획.md",
    body: `---
doc_kind: plan
topic:
status: 미착수
---

# {{title}}

## 무엇을

## 왜

## 안 하는 것
`,
  },
  {
    rel: TEMPLATE_DIR + "/회고.md",
    body: `---
doc_kind: reference
topic:
status: 완료
---

# {{title}}

## 잘 된 것

## 다음에 다르게
`,
  },
  {
    rel: "slate/reference/미착수.md",
    body: `---
title: 아직 안 한 것
doc_kind: reference
topic: cards
tags: [slate]
status: 미착수
date: 2026-08-05
---

# 아직 안 한 것

아무도 안 가리키고 나가는 링크도 없다 — 진짜 외딴 노트.
`,
  },
];
