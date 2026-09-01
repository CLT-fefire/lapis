/**
 * vault 전체의 **미완 작업**.
 *
 * ## ⚠️ 왜 감사 가족인가
 *
 * 2026-08-28 실측: 미완 **90건**이 **5노트**에 흩어져 있다. 그 노트를 열기 전에는
 * 남은 일이 몇 개인지 알 방법이 없었다 — 링크가 안 걸린 것처럼, 있는데 안 보이는 상태다.
 *
 * 다른 다섯 감사와 같은 자리에 둔다: **찾아서 보여줄 뿐 고치지 않는다.**
 *
 * ## ⚠️ 본문을 읽는다
 *
 * `unlinked`(안 걸린 언급)와 같은 부류다 — 인덱스로는 안 되고 본문을 봐야 한다.
 * 그래서 `audit: all` 이 없는 것과 같은 이유로 이것도 **부를 때만** 돈다.
 */

import { codeBlockLines } from "$lib/codeLines";

export interface OpenTask {
  path: string;
  /** 노트 안 0-based 줄 번호. 열었을 때 그 줄로 갈 수 있게. */
  line: number;
  /** 체크박스를 걷어낸 본문. */
  text: string;
  /** 중첩 깊이(들여쓰기 2칸당 1). 부모-자식 관계를 화면이 그릴 수 있게. */
  depth: number;
}

export interface OpenTaskGroup {
  path: string;
  /** 이 노트의 미완. */
  open: OpenTask[];
  /** 이 노트의 완료 수 — 진행도를 보여주려면 분모가 필요하다. */
  done: number;
}

/**
 * `- [ ] 할 일` · `* [x] 끝` · `+ [ ] …` · `1. [ ] …` — 앞의 들여쓰기까지 본다.
 *
 * 🔴 **그리는 쪽과 같은 것을 봐야 한다.** 불릿을 `[-*]` 로만 받던 때가 있었는데,
 * 렌더러는 markdown-it 위에 있어 CommonMark 불릿 셋(`- * +`)과 번호 목록을 다 받았다.
 * 그래서 `+ [ ] 할 일` 은 **앱에 체크박스로 보이는데 감사는 안 셌다** — 화면에는 남은
 * 일이 있는데 도구는 "미완 작업이 없다"고 답하는 상태다.
 *
 * 두 규칙을 `taskRuleAgreement.test.ts` 가 묶어 둔다. 파서와 줄 스캐너라 합칠 수는
 * 없으니, 어긋나는 것을 실패로 만든다.
 *
 * ⚠️ 이 vault 에서 새던 것은 **0건**이었다(127 노트 162건). 보험이지 성과가 아니다.
 */
const TASK_LINE = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+\[([ xX])\]\s+(.*)$/;

/**
 * ⚠️ **코드 블록 안은 안 센다.** 이 vault 는 코드블록이 63노트에 있고, 셸 예시에
 * `- [ ]` 가 들어가는 일이 있다. 세면 있지도 않은 할 일이 목록에 뜬다.
 *
 * 🔴 판정은 `$lib/codeLines` 가 한다. 예전엔 여기 줄 단위 토글이 있었는데
 * **들여쓴 코드블록을 놓쳤다** — 4칸 들여쓴 `- [ ]` 가 할 일로 세어졌다.
 * 정규식으로는 못 고친다: 중첩 할 일도 4칸이라 "4칸이면 코드"로 두면 `depth` 가 죽는다.
 *
 * ⚠️ **후보가 없으면 파스하지 않는다.** 전량 파스는 실측 18배다(1.6ms → 29.3ms).
 * 체크박스처럼 생긴 줄이 하나라도 있는 노트만 파서를 태운다(실측 6%).
 */
export function findOpenTasks(path: string, body: string): OpenTaskGroup {
  const open: OpenTask[] = [];
  let done = 0;

  const lines = body.split("\n");
  if (!lines.some((l) => TASK_LINE.test(l))) return { path, open, done };

  const code = codeBlockLines(body);
  for (let i = 0; i < lines.length; i++) {
    if (code.has(i)) continue;
    const line = lines[i];

    const m = TASK_LINE.exec(line);
    if (!m) continue;
    if (m[2] === " ") {
      open.push({
        path,
        line: i,
        text: m[3].trim(),
        // 탭은 4칸으로 친다 — 섞여 있으면 깊이가 뒤집힌다.
        depth: Math.floor(m[1].replace(/\t/g, "    ").length / 2),
      });
    } else {
      done++;
    }
  }
  return { path, open, done };
}

/**
 * 여러 노트 → 미완이 있는 것만, 많은 순.
 *
 * ⚠️ **미완이 0인 노트는 뺀다.** 전부 끝낸 노트를 목록에 남기면 "할 일 목록"이 아니라
 * "체크박스가 있는 노트 목록"이 되고, 그러면 아무 질문에도 답하지 않는다.
 */
export function collectOpenTasks(
  notes: Iterable<{ path: string; body: string }>,
): OpenTaskGroup[] {
  const out: OpenTaskGroup[] = [];
  for (const n of notes) {
    const g = findOpenTasks(n.path, n.body);
    if (g.open.length > 0) out.push(g);
  }
  return out.sort((a, b) => b.open.length - a.open.length || a.path.localeCompare(b.path));
}

/** 총계 — 화면 머리에 쓴다. */
export function countOpenTasks(groups: readonly OpenTaskGroup[]): { open: number; done: number } {
  let open = 0;
  let done = 0;
  for (const g of groups) {
    open += g.open.length;
    done += g.done;
  }
  return { open, done };
}

/** 미완 작업이 어디에 몰렸나 — `top` 은 미완이 가장 많은 노트. */
export interface TaskConcentration {
  /** 미완 총수. `countOpenTasks().open` 과 같다. */
  total: number;
  /** 미완이 하나라도 있는 노트 수. */
  notes: number;
  top: { path: string; open: number; share: number } | null;
}

/**
 * 🔴 **맨숫자 하나는 어디에 몰렸는지를 감춘다.**
 *
 * 실측: 이 vault 의 미완 89건 중 **67건이 한 파일**(수동 테스트 체크리스트)이었다.
 * "할 일 90개"의 75%가 실제 할 일이 아니었는데, `lapis_stats` 는 그냥 90 을 냈다.
 * 틀린 값은 아니지만 답으로 쓰면 틀린다.
 *
 * ## ⚠️ 설정을 새로 만들지 않는다
 *
 * 고아 노트 때 같은 갈림길에서 이렇게 정했다 — "나가는 링크 수를 같이 보고한다.
 * 프론트매터 표식도 `exclude` 설정도 새로 만들지 않는다. 두 숫자를 나란히 보여주면
 * 사람이 바로 구분한다." 여기서도 같다. **무엇을 빼야 할지 앱이 정하지 않는다.**
 *
 * ⚠️ 미완이 0이면 `top` 은 `null` 이다. 0으로 나눈 `NaN` 이 JSON 에서 `null` 이 되면
 * 소비자가 "몰림 없음"으로 읽는다 — 그건 다른 말이다.
 */
export function taskConcentration(groups: readonly OpenTaskGroup[]): TaskConcentration {
  let total = 0;
  let notes = 0;
  let top: { path: string; open: number } | null = null;

  for (const g of groups) {
    const open = g.open.length;
    if (open === 0) continue;
    total += open;
    notes++;
    // 동점은 경로 순 — 같은 입력에 같은 답이 나와야 한다.
    if (!top || open > top.open || (open === top.open && g.path < top.path)) {
      top = { path: g.path, open };
    }
  }

  return {
    total,
    notes,
    top: top ? { ...top, share: top.open / total } : null,
  };
}
