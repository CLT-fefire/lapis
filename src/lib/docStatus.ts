/**
 * `status` 낱말 규약 — **이 규칙이 사는 유일한 자리.**
 *
 * ## 🔴 왜 모았나
 *
 * vault 의 `status` 53건이 아홉 갈래였고, 그중 **다섯이 같은 자리**를 뜻했다
 * (2026-08-30 실측, `.lapis/` 백업 제외):
 *
 * ```
 * 반영됨 21 · 완료 15 · 진행 중 10 · 미착수 2 · 해결됨 1 · 닫힘 1 · 이전됨 1
 * "끝 (PR #2) — …"  1        ← 값이 아니라 문장
 * "8건 전부 완료 (v0.21.0 · PR #3)"  1
 * ```
 *
 * doc_kind 마다 말이 달랐던 것이다 — `adr`·`plans` 는 `반영됨`, `solutions` 는 `해결됨`,
 * `todos` 는 `닫힘`. 사람에게는 자연스럽지만 **코드에게는 다섯 개의 다른 문자열**이라,
 * "끝난 것"을 물으려면 호출부마다 목록을 손으로 적어야 했다. 실제로 그렇게 적혀 있었다:
 *
 * ```
 * core/query.ts    `{ status: ["완료", "반영됨"] }`     ← 다섯 중 둘
 * cli/handlers.ts  `--props status=완료 --props status=반영됨`
 * ```
 *
 * ⚠️ 그렇게 물으면 53건 중 36건만 잡히고 **에러는 안 난다.** 부패 감사를 짜다 이걸
 * 밟았다 — 손으로 적은 첫 목록이 `반영됨` 21건을 통째로 빠뜨렸다.
 *
 * ## ⚠️ 추론이 아니라 선언이다
 *
 * `vaultAudit.ts` 의 판정은 그대로 산다:
 *
 * > 동의어라고 말하지 않는다. 그건 **기계가 정할 수 없고**, 이 기능의 원칙은
 * > "판단하지 않는다"다.
 *
 * 그 말이 맞다. `반영됨` 과 `해결됨` 이 같은 뜻인지는 문자열에서 나오지 않는다. 그래서
 * 감사는 지금도 동의어를 말하지 않고, **사람이 아래 표에 적는다.** 감사가 추측하게
 * 만드는 것과, 사람이 선언한 것을 코드가 읽는 것은 다른 일이다.
 *
 * ## ⚠️ 관대하지 않다
 *
 * `tagMatch` 는 관대하다 — 태그는 손으로 쓰고 계층이 있다. 여기는 반대다.
 * **정확히 일치할 때만** 안다. `진행중`·`구현 완료`·`완료 — #232` 는 전부 `null` 이다.
 *
 * 접두사로 삼키면 `완료 — #232` 가 조용히 done 이 되고, 그러면 vault 진단의
 * "축이 안 굳었다" 신호가 **꺼진다.** 모르는 것은 모른다고 두어야 감사가 말을 한다.
 */

/** 이 규약이 붙는 frontmatter 필드. 다른 축에는 갈래가 없다. */
export const STATUS_FIELD = "status";

/** 세 갈래. 어떤 낱말을 쓰든 결국 여기로 접힌다. */
export type StatusLifecycle = "done" | "active" | "todo";

/**
 * 낱말 → 갈래. **이 표가 규약이다.**
 *
 * ⚠️ 낱말을 지우지 말고 늘려라. 지우면 그 낱말을 쓴 옛 노트가 조용히 `null` 이 된다.
 * ⚠️ `열림` 은 `todos` 가 닫히기 전에 쓰던 값이다(`mcp-gate-issues-20260827.md` 의
 *    링크 갱신 백업에 남아 있다). 지금 vault 에는 0건이지만 규약에서 빼지 않는다 —
 *    빼는 순간 그 값으로 돌아간 노트가 안 잡힌다.
 */
const VOCABULARY: ReadonlyMap<string, StatusLifecycle> = new Map([
  // 끝남 — 다섯 낱말이 같은 자리다
  ["완료", "done"],
  ["반영됨", "done"],
  ["해결됨", "done"],
  ["닫힘", "done"],
  ["이전됨", "done"],
  // 진행
  ["진행 중", "active"],
  // 아직
  ["미착수", "todo"],
  ["열림", "todo"],
] as const);

/**
 * 비교용 정규형. **화면에 쓰지 말 것** — 표시 값은 노트에 적힌 그대로다.
 *
 * ⚠️ 공백 런은 접지만 **없애지는 않는다.** 붙여넣기로 생긴 두 칸은 같은 값으로 보되,
 * `진행중` 은 다른 문자열로 남긴다. 없애면 오타가 조용히 통과한다.
 */
export function normStatus(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * 이 값이 어느 갈래인가 — **모르면 `null`.**
 *
 * 🔴 `null` 을 기본값으로 접지 말 것. 모르는 값을 `todo` 로 두면 분모가 조용히 틀린다.
 * 부르는 쪽은 "모르는 값이 N개"를 **세어서 같이 내야** 한다.
 */
export function statusLifecycle(raw: string | undefined | null): StatusLifecycle | null {
  if (!raw) return null;
  return VOCABULARY.get(normStatus(raw)) ?? null;
}

/** 규약에 있는 값 전부. 정렬은 표에 적은 순서 — 끝남 · 진행 · 아직. */
export const KNOWN_STATUS_VALUES: readonly string[] = [...VOCABULARY.keys()];

/**
 * 질의에서 갈래를 부르는 이름.
 *
 * ⚠️ **`@` 는 예약이다.** vault 의 `status` 값이 `@` 로 시작할 일은 없고, 그래서 리터럴
 * 값과 헷갈리지 않는다. 이 사글이 없으면 `--props status=done` 이 "done 이라고 적힌
 * 노트"인지 "끝난 노트"인지 부르는 쪽도 읽는 쪽도 모른다.
 */
export const STATUS_GROUPS = ["@done", "@active", "@todo"] as const;

export type StatusGroup = (typeof STATUS_GROUPS)[number];

/** `@` 로 시작하는 **아는** 이름인가. 모르는 `@foo` 는 거짓이다. */
export function isStatusGroup(value: string): value is StatusGroup {
  return (STATUS_GROUPS as readonly string[]).includes(normStatus(value));
}

/**
 * 갈래 하나를 낱말들로 펼친다 — **손으로 적던 그 목록.**
 *
 * ⚠️ 모르는 이름은 `null` 이다. 빈 배열로 두면 오타 난 질의가 **0건을 정답처럼** 낸다.
 */
export function expandStatusGroup(name: string): string[] | null {
  const n = normStatus(name);
  if (!isStatusGroup(n)) return null;
  const want = n.slice(1) as StatusLifecycle;
  return [...VOCABULARY].filter(([, life]) => life === want).map(([value]) => value);
}
