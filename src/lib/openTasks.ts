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

/** `- [ ] 할 일` · `* [x] 끝` — 앞의 들여쓰기까지 본다. */
const TASK_LINE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;

/**
 * ⚠️ **코드 펜스 안은 안 센다.** 이 vault 는 코드블록이 63노트에 있고, 셸 예시에
 * `- [ ]` 가 들어가는 일이 있다. 세면 있지도 않은 할 일이 목록에 뜬다.
 */
export function findOpenTasks(path: string, body: string): OpenTaskGroup {
  const open: OpenTask[] = [];
  let done = 0;
  let inFence = false;
  let fence = "";

  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!inFence) {
        inFence = true;
        fence = f[1][0];
      } else if (f[1][0] === fence) {
        inFence = false;
      }
      continue;
    }
    if (inFence) continue;

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
