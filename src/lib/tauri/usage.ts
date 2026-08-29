import { invoke } from "$lib/tauri/invoke";

/**
 * 사용 로그 Rust 커맨드의 타입드 래퍼.
 *
 * ⚠️ `invoke` 를 직접 부르지 않고 이 층을 지난다 — `src/lib/tauri/` 의 규약이다.
 * 인자 이름이 Rust 쪽과 갈리면 **런타임에야** 드러나므로 한 곳에 모은다.
 */

export interface UsageMonths {
  /** `YYYY-MM` 내림차순. */
  months: string[];
  dir: string;
  total_bytes: number;
}

export function usageMonths(): Promise<UsageMonths> {
  return invoke<UsageMonths>("usage_months");
}

export function usageRead(month: string): Promise<string[]> {
  return invoke<string[]>("usage_read", { month });
}

/** 지운 파일 수. */
export function usageClear(): Promise<number> {
  return invoke<number>("usage_clear");
}

/**
 * 분석 문서를 로그 폴더에 쓴다. 반환값은 쓴 경로.
 *
 * ⚠️ **사용자가 누르는 버튼이 없다.** 기동할 때 앱이 알아서 부른다 — 통계를 보고 싶은
 * 사람에게 저장 형식을 고르게 할 이유가 없다. 필요하면 폴더에서 꺼내 간다.
 */
export function usageWriteReport(text: string): Promise<string> {
  return invoke<string>("usage_write_report", { text });
}
