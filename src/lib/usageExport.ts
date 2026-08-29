/**
 * 사용 로그 **원본 내보내기**(JSONL).
 *
 * ## 🔴 다시 직렬화하지 않는다
 *
 * 파싱해서 다시 쓰면 **파서가 못 읽은 줄이 조용히 사라진다.** 그러면 내보낸 파일이
 * 디스크의 진실과 달라지고, 분석하는 쪽은 그 사실을 알 방법이 없다. 줄을 그대로 잇는다 —
 * 파일 복사는 거짓말을 할 수 없다.
 *
 * ⚠️ `usage_read` 는 빈 줄만 뺀다(정보가 없는 줄). 그 외에는 파일 그대로다.
 *
 * ## ⚠️ 여기엔 가림이 없다
 *
 * 가리려면 파싱해야 하고, 파싱한 순간 원본이 아니다. **원본이 필요하니까 원본을 낸다.**
 * 가린 것이 필요하면 마크다운 리포트 쪽을 쓴다 — 화면이 그 사실을 말한다.
 */

export interface MonthLines {
  month: string;
  lines: readonly string[];
}

/**
 * 달별 줄 → 한 덩어리 JSONL.
 *
 * ⚠️ **오래된 달이 먼저 온다.** 로그는 시간순으로 읽는 것이 자연스럽고, 뒤섞여 있으면
 * 읽는 쪽이 정렬을 다시 해야 한다. `usage_months` 는 내림차순으로 주므로 뒤집는다.
 */
export function buildUsageJsonl(months: readonly MonthLines[]): string {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const out: string[] = [];
  for (const m of sorted) out.push(...m.lines);
  // 끝에 개행 하나 — 줄 단위 도구(`jq`·`wc -l`)가 마지막 줄을 세려면 필요하다.
  return out.length === 0 ? "" : `${out.join("\n")}\n`;
}

/** 저장 대화상자의 기본 이름. */
export function suggestUsageFileName(months: readonly string[], ext: "md" | "jsonl"): string {
  const sorted = [...months].sort();
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first) return `lapis-usage.${ext}`;
  const span = first === last ? first : `${first}_${last}`;
  return `lapis-usage-${span}.${ext}`;
}
